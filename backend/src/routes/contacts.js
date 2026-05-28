const express = require('express');
const router = express.Router();
const db = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');
const { runLidMerge, getProfilePictureUrl, getDefaultLineId } = require('../whatsapp/client');
const ioInstance = require('../io-instance');

router.use(authMiddleware);

// Criar contacto individual
router.post('/', (req, res) => {
  const { phone, name } = req.body;
  if (!phone?.trim()) return res.status(400).json({ error: 'Número obrigatório' });
  const cleanPhone = phone.trim().replace(/[\s\-().]/g, '');
  const existing = db.prepare('SELECT id FROM contacts WHERE phone = ?').get(cleanPhone);
  if (existing) return res.status(409).json({ error: 'Contacto já existe', id: existing.id });
  db.prepare('INSERT INTO contacts (phone, name) VALUES (?, ?)').run(cleanPhone, name?.trim() || cleanPhone);
  const contact = db.prepare('SELECT * FROM contacts WHERE phone = ?').get(cleanPhone);
  // Verificar se há LID pendente para este número e fundir imediatamente
  setTimeout(runLidMerge, 200);
  res.json(contact);
});

// Listar contactos com info da última conversa
router.get('/', (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : null;
  const rows = db.prepare(`
    SELECT
      c.id, c.phone, c.name, c.wa_id, c.notes, c.email, c.created_at,
      COUNT(DISTINCT conv.id) as conversation_count,
      MAX(conv.updated_at) as last_contact
    FROM contacts c
    LEFT JOIN conversations conv ON conv.contact_id = c.id
    ${q ? "WHERE c.name LIKE ? OR c.phone LIKE ? OR c.notes LIKE ?" : ""}
    GROUP BY c.id
    ORDER BY last_contact DESC NULLS LAST, c.created_at DESC
    LIMIT 200
  `).all(...(q ? [q, q, q] : []));
  res.json(rows);
});

// Eliminar contacto (e todas as suas conversas e mensagens)
router.delete('/:id', (req, res) => {
  const id = req.params.id;
  // Apagar mensagens de todas as conversas deste contacto
  db.prepare(`
    DELETE FROM messages WHERE conversation_id IN (
      SELECT id FROM conversations WHERE contact_id = ?
    )
  `).run(id);
  // Apagar tags das conversas
  db.prepare(`
    DELETE FROM conversation_tags WHERE conversation_id IN (
      SELECT id FROM conversations WHERE contact_id = ?
    )
  `).run(id);
  // Apagar mensagens agendadas
  db.prepare(`
    DELETE FROM scheduled_messages WHERE conversation_id IN (
      SELECT id FROM conversations WHERE contact_id = ?
    )
  `).run(id);
  db.prepare('DELETE FROM conversations WHERE contact_id = ?').run(id);
  db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Limpar contactos inválidos (grupos, broadcast, newsletter) sem conversas
router.delete('/cleanup/invalid', (req, res) => {
  const result = db.prepare(`
    DELETE FROM contacts
    WHERE (
      wa_id LIKE '%@g.us' OR
      wa_id LIKE '%@newsletter' OR
      wa_id = 'status@broadcast' OR
      phone LIKE '%@g.us' OR
      phone LIKE '%@newsletter' OR
      phone = 'status@broadcast'
    ) AND id NOT IN (SELECT contact_id FROM conversations)
  `).run();
  res.json({ deleted: result.changes });
});

// Histórico 360 do contacto — stats agregadas + conversas anteriores.
// Usado pelo painel lateral do ChatWindow para o atendente ter contexto.
router.get('/:id/history', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const contact = db.prepare('SELECT id, name, phone, email, notes, created_at FROM contacts WHERE id = ?').get(id);
  if (!contact) return res.status(404).json({ error: 'Contacto não encontrado' });

  const stats = db.prepare(`
    SELECT
      COUNT(DISTINCT conv.id) AS total_conversations,
      COUNT(CASE WHEN conv.status = 'closed' THEN 1 END) AS closed_conversations,
      COUNT(CASE WHEN conv.status != 'closed' THEN 1 END) AS active_conversations,
      (SELECT COUNT(*) FROM messages m INNER JOIN conversations c2 ON c2.id = m.conversation_id WHERE c2.contact_id = ?) AS total_messages,
      MIN(conv.created_at) AS first_contact_at,
      MAX(conv.updated_at) AS last_contact_at
    FROM conversations conv
    WHERE conv.contact_id = ?
  `).get(id, id);

  const ratings = db.prepare(`
    SELECT COUNT(*) AS total, ROUND(AVG(score), 2) AS avg_score,
      MAX(score) AS best, MIN(score) AS worst
    FROM ratings WHERE contact_id = ?
  `).get(id);

  // Últimas 10 conversas (mais recentes primeiro) para drill-down
  const conversations = db.prepare(`
    SELECT conv.id, conv.status, conv.created_at, conv.updated_at,
      u.name AS attendant_name,
      d.name AS department_name, d.color AS department_color,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = conv.id) AS message_count,
      (SELECT body FROM messages WHERE conversation_id = conv.id ORDER BY id DESC LIMIT 1) AS last_message,
      (SELECT score FROM ratings WHERE conversation_id = conv.id ORDER BY id DESC LIMIT 1) AS rating
    FROM conversations conv
    LEFT JOIN users u ON u.id = conv.assigned_to
    LEFT JOIN departments d ON d.id = conv.department_id
    WHERE conv.contact_id = ?
    ORDER BY conv.updated_at DESC
    LIMIT 10
  `).all(id);

  const tags = db.prepare(`
    SELECT DISTINCT t.id, t.name, t.color
    FROM tags t
    INNER JOIN conversation_tags ct ON ct.tag_id = t.id
    INNER JOIN conversations conv ON conv.id = ct.conversation_id
    WHERE conv.contact_id = ?
  `).all(id);

  res.json({ contact, stats, ratings, conversations, tags });
});

// Actualizar contacto (nome, notas, email)
router.patch('/:id', (req, res) => {
  const { name, notes, email } = req.body;
  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (notes !== undefined) { fields.push('notes = ?'); values.push(notes); }
  if (email !== undefined) { fields.push('email = ?'); values.push(email); }
  if (fields.length === 0) return res.status(400).json({ error: 'Nada para actualizar' });
  values.push(req.params.id);
  db.prepare(`UPDATE contacts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  ioInstance.get()?.emit('contact:updated', updated);
  res.json(updated);
});

// GET /contacts/:id/avatar — devolve { url: string|null } com a foto de
// perfil do contacto no WhatsApp. Usa cache em memória (TTL 6h). Apanha a
// linha mais recente onde o contacto tem conversa, ou cai na default.
router.get('/:id/avatar', async (req, res) => {
  const contact = db.prepare('SELECT phone, wa_id FROM contacts WHERE id = ?').get(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Contacto não encontrado' });
  const lineRow = db.prepare(`
    SELECT line_id FROM conversations WHERE contact_id = ? ORDER BY id DESC LIMIT 1
  `).get(req.params.id);
  const lineId = lineRow?.line_id || getDefaultLineId();
  if (!lineId) return res.json({ url: null });
  // Usar phone (número real) — wa_id pode ser '...@lid' (WhatsApp Business)
  // que aponta para um identificador anónimo, não para o telefone real.
  // profilePictureUrl precisa do JID em '...@s.whatsapp.net' com o número real.
  const url = await getProfilePictureUrl(lineId, contact.phone);
  res.json({ url });
});

module.exports = router;
