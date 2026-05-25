const express = require('express');
const router = express.Router();
const db = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// Listar agendamentos (atendente vê só os seus; owner/admin vê todos)
router.get('/', (req, res) => {
  const { show_cancelled } = req.query;
  const conditions = [];
  const params = [];

  if (req.user.role === 'attendant') {
    conditions.push('sm.created_by = ?');
    params.push(req.user.id);
  }
  if (show_cancelled !== '1') {
    conditions.push('sm.cancelled = 0');
  }
  // Por defeito só mostra pendentes (não enviadas); ?show_sent=1 para incluir enviadas
  if (req.query.show_sent !== '1') {
    conditions.push('sm.sent_at IS NULL');
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT sm.*, con.phone, con.name as contact_name, u.name as created_by_name
    FROM scheduled_messages sm
    LEFT JOIN conversations cv ON cv.id = sm.conversation_id
    LEFT JOIN contacts con ON con.id = cv.contact_id
    LEFT JOIN users u ON u.id = sm.created_by
    ${where}
    ORDER BY sm.scheduled_at ASC
  `).all(...params);
  res.json(rows);
});

// Criar agendamento
router.post('/', (req, res) => {
  const { conversation_id, wa_id, body, scheduled_at } = req.body;
  if (!wa_id || !body || !scheduled_at) return res.status(400).json({ error: 'Campos obrigatórios em falta' });
  // Validar que a data é no futuro (scheduled_at vem como hora local sem timezone)
  const isPast = db.prepare(
    `SELECT replace(?, 'T', ' ') < datetime('now', 'localtime', '-1 minute') AS result`
  ).get(scheduled_at)?.result;
  if (isPast) return res.status(400).json({ error: 'Não é possível agendar para o passado' });
  const r = db.prepare(
    'INSERT INTO scheduled_messages (conversation_id, wa_id, body, scheduled_at, created_by) VALUES (?, ?, ?, ?, ?)'
  ).run(conversation_id || null, wa_id, body, scheduled_at, req.user.id);
  const row = db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(r.lastInsertRowid);
  res.json(row);
});

// Editar agendamento (só se ainda não foi enviado)
router.patch('/:id', (req, res) => {
  const { body, scheduled_at } = req.body;
  const sm = db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(req.params.id);
  if (!sm) return res.status(404).json({ error: 'Agendamento não encontrado' });
  if (sm.sent_at) return res.status(400).json({ error: 'Mensagem já enviada, não é possível editar' });
  if (sm.cancelled) return res.status(400).json({ error: 'Agendamento cancelado, não é possível editar' });
  if (req.user.role === 'attendant' && sm.created_by !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });

  const newBody = body?.trim() || sm.body;
  const newAt = scheduled_at || sm.scheduled_at;
  // Validar que a nova data é no futuro (só se foi enviada uma nova data)
  if (scheduled_at) {
    const isPast = db.prepare(
      `SELECT replace(?, 'T', ' ') < datetime('now', 'localtime', '-1 minute') AS result`
    ).get(scheduled_at)?.result;
    if (isPast) return res.status(400).json({ error: 'Não é possível agendar para o passado' });
  }
  db.prepare('UPDATE scheduled_messages SET body = ?, scheduled_at = ? WHERE id = ?').run(newBody, newAt, sm.id);
  const updated = db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(sm.id);
  res.json(updated);
});

// Cancelar agendamento
router.delete('/:id', (req, res) => {
  const sm = db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(req.params.id);
  if (!sm) return res.status(404).json({ error: 'Agendamento não encontrado' });
  if (req.user.role === 'attendant' && sm.created_by !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });
  db.prepare('UPDATE scheduled_messages SET cancelled = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
