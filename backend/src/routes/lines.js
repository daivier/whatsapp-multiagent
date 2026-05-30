const express = require('express');
const path = require('path');
const db = require('../db/schema');
const { authMiddleware, ownerOnly } = require('../middleware/auth');
const ioInstance = require('../io-instance');
const wa = require('../whatsapp/client');
const { getLimit } = require('../plan');

const router = express.Router();

// GET / — lista de linhas activas com contagens + estado WhatsApp ao vivo
router.get('/', authMiddleware, (req, res) => {
  let lines;
  if (req.user.role === 'owner') {
    // owner vê todas as linhas (administração)
    lines = db.prepare(`
      SELECT lines.id, lines.name, lines.color, lines.is_default, lines.active, lines.created_at, lines.session_path,
        lines.department_id, d.name AS department_name, d.color AS department_color,
        (SELECT COUNT(*) FROM conversations c WHERE c.line_id = lines.id AND c.status != 'closed') AS active_conversations,
        (SELECT COUNT(*) FROM conversations c WHERE c.line_id = lines.id) AS total_conversations
      FROM lines
      LEFT JOIN departments d ON d.id = lines.department_id
      WHERE lines.active = 1
      ORDER BY lines.is_default DESC, lines.id ASC
    `).all();
  } else {
    // supervisor e attendant: apenas linhas do(s) seu(s) departamento(s),
    // ou linhas sem departamento (administrativas/globais)
    lines = db.prepare(`
      SELECT lines.id, lines.name, lines.color, lines.is_default, lines.active, lines.created_at, lines.session_path,
        lines.department_id, d.name AS department_name, d.color AS department_color,
        (SELECT COUNT(*) FROM conversations c WHERE c.line_id = lines.id AND c.status != 'closed') AS active_conversations,
        (SELECT COUNT(*) FROM conversations c WHERE c.line_id = lines.id) AS total_conversations
      FROM lines
      LEFT JOIN departments d ON d.id = lines.department_id
      WHERE lines.active = 1
        AND (
          lines.department_id IS NULL
          OR lines.department_id IN (
            SELECT department_id FROM user_departments WHERE user_id = ?
          )
        )
      ORDER BY lines.is_default DESC, lines.id ASC
    `).all(req.user.id);
  }
  // Enriquecer com estado WhatsApp em memória (ready/qr)
  const enriched = lines.map(l => {
    const s = wa.getStatus(l.id);
    return { ...l, wa_ready: !!s.isReady, has_qr: !!s.hasQr };
  });
  res.json(enriched);
});

// GET /:id/qr — QR code actual da linha (data URL); 404 se já conectada ou sem QR
router.get('/:id/qr', authMiddleware, ownerOnly, (req, res) => {
  const status = wa.getStatus(parseInt(req.params.id, 10));
  if (status.isReady) return res.status(409).json({ error: 'Linha já conectada' });
  if (!status.hasQr) return res.status(404).json({ error: 'QR ainda não disponível — aguarda alguns segundos' });
  res.json({ qr: status.qrCode });
});

// POST / — criar linha (owner)
router.post('/', authMiddleware, ownerOnly, async (req, res) => {
  const { name, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name obrigatório' });

  // Enforcement de plano: limite de linhas WhatsApp.
  const maxLinhas = getLimit('maxLinhas');
  if (Number.isFinite(maxLinhas)) {
    const count = db.prepare("SELECT COUNT(*) AS c FROM lines WHERE active = 1").get().c;
    if (count >= maxLinhas) return res.status(403).json({ error: `Limite de ${maxLinhas} linha(s) do seu plano atingido.`, feature: 'maxLinhas', upgrade: true });
  }

  // session_path: gerado a partir do base WA_SESSION_PATH + nome do tenant
  const base = process.env.WA_SESSION_PATH || path.join(__dirname, '../../baileys-session');
  // Para linhas adicionais, criar subpasta line-<slug>
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const sessionPath = path.join(path.dirname(base), `${path.basename(base)}-${slug}-${Date.now()}`);

  try {
    const created = db.transaction(() => {
      const r = db.prepare("INSERT INTO lines (name, color, session_path, is_default) VALUES (?, ?, ?, 0)")
        .run(name.trim(), color || '#25D366', sessionPath);
      return db.prepare("SELECT * FROM lines WHERE id = ?").get(r.lastInsertRowid);
    })();
    // Tentar arrancar a nova linha — gerará QR
    try { await wa.startLine(created.id); }
    catch (err) { console.error(`[lines] arrancar linha ${created.id} falhou: ${err.message}`); }

    ioInstance.get()?.emit('line:created', created);
    res.status(201).json(created);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Já existe uma linha com esse nome' });
    }
    throw err;
  }
});

// PUT /:id — actualizar nome/cor/departamento (owner). session_path não muda.
router.put('/:id', authMiddleware, ownerOnly, (req, res) => {
  const { name, color, is_default, department_id } = req.body;
  const existing = db.prepare("SELECT * FROM lines WHERE id = ? AND active = 1").get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Linha não encontrada' });

  try {
    db.transaction(() => {
      if (is_default) db.prepare("UPDATE lines SET is_default = 0").run();
      const fields = [], params = [];
      if (name?.trim()) { fields.push("name = ?"); params.push(name.trim()); }
      if (color) { fields.push("color = ?"); params.push(color); }
      if (is_default !== undefined) { fields.push("is_default = ?"); params.push(is_default ? 1 : 0); }
      // department_id: null para remover associação, número para definir departamento
      if (department_id !== undefined) { fields.push("department_id = ?"); params.push(department_id || null); }
      if (fields.length) { params.push(req.params.id); db.prepare(`UPDATE lines SET ${fields.join(', ')} WHERE id = ?`).run(...params); }
    })();
    const updated = db.prepare("SELECT * FROM lines WHERE id = ?").get(req.params.id);
    ioInstance.get()?.emit('line:updated', updated);
    res.json(updated);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Já existe uma linha com esse nome' });
    throw err;
  }
});

// DELETE /:id — soft delete + desliga Baileys. Bloqueia se houver conversas abertas
// a não ser que se passe ?reassign_to=<line_id>
router.delete('/:id', authMiddleware, ownerOnly, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const reassignTo = req.query.reassign_to ? parseInt(req.query.reassign_to, 10) : null;
  const line = db.prepare("SELECT * FROM lines WHERE id = ?").get(id);
  if (!line) return res.status(404).json({ error: 'Linha não encontrada' });
  if (line.is_default && !reassignTo) {
    return res.status(409).json({ error: 'Não é possível arquivar a linha padrão. Marca outra como padrão primeiro.' });
  }

  const openCount = db.prepare("SELECT COUNT(*) AS c FROM conversations WHERE line_id = ? AND status != 'closed'").get(id).c;
  if (openCount > 0 && !reassignTo) {
    return res.status(409).json({ error: `${openCount} conversa(s) abertas nesta linha`, open_count: openCount, hint: 'Passe ?reassign_to=<line_id> para migrar antes de arquivar' });
  }
  if (reassignTo) {
    const target = db.prepare("SELECT id FROM lines WHERE id = ? AND active = 1").get(reassignTo);
    if (!target) return res.status(400).json({ error: 'Linha de destino inválida' });
    if (target.id === id) return res.status(400).json({ error: 'reassign_to não pode ser a própria linha' });
  }

  // Desligar Baileys primeiro
  try { await wa.stopLine(id); } catch (err) { console.error(`[lines] stopLine ${id}: ${err.message}`); }

  db.transaction(() => {
    if (reassignTo) db.prepare("UPDATE conversations SET line_id = ? WHERE line_id = ?").run(reassignTo, id);
    db.prepare("UPDATE lines SET active = 0, is_default = 0 WHERE id = ?").run(id);
  })();

  ioInstance.get()?.emit('line:deleted', { id });
  res.json({ ok: true });
});

// POST /:id/connect — re-tenta arrancar a linha (útil se falhou no boot)
router.post('/:id/connect', authMiddleware, ownerOnly, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try { await wa.startLine(id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /:id/disconnect — desliga apenas esta linha
router.post('/:id/disconnect', authMiddleware, ownerOnly, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try { await wa.stopLine(id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});


// GET /lines/:id/bot — bot settings for a specific line
router.get('/:id/bot', authMiddleware, ownerOnly, (req, res) => {
  const lineId = parseInt(req.params.id, 10);
  let row = db.prepare('SELECT * FROM line_bot_settings WHERE line_id = ?').get(lineId);
  if (!row) {
    // Return defaults if not configured yet
    row = {
      line_id: lineId, enabled: 0, message: '',
      hours_0: 'closed', hours_1: '07:00-18:00', hours_2: '07:00-18:00',
      hours_3: '07:00-18:00', hours_4: '07:00-18:00', hours_5: '07:00-18:00',
      hours_6: '07:00-12:00'
    };
  }
  res.json(row);
});

// POST /lines/:id/bot — save bot settings for a specific line
router.post('/:id/bot', authMiddleware, ownerOnly, (req, res) => {
  const lineId = parseInt(req.params.id, 10);
  const { enabled, message, hours_0, hours_1, hours_2, hours_3, hours_4, hours_5, hours_6 } = req.body;
  db.prepare(`INSERT INTO line_bot_settings
    (line_id, enabled, message, hours_0, hours_1, hours_2, hours_3, hours_4, hours_5, hours_6)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(line_id) DO UPDATE SET
      enabled=excluded.enabled, message=excluded.message,
      hours_0=excluded.hours_0, hours_1=excluded.hours_1, hours_2=excluded.hours_2,
      hours_3=excluded.hours_3, hours_4=excluded.hours_4, hours_5=excluded.hours_5,
      hours_6=excluded.hours_6
  `).run(lineId, enabled ? 1 : 0, message || '',
    hours_0 || 'closed', hours_1 || 'closed', hours_2 || 'closed',
    hours_3 || 'closed', hours_4 || 'closed', hours_5 || 'closed', hours_6 || 'closed');
  res.json({ ok: true });
});

module.exports = router;
