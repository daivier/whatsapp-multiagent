const express = require('express');
const db = require('../db/schema');
const { authMiddleware, ownerOnly } = require('../middleware/auth');

const router = express.Router();

function conversationQuery(extraWhere = '') {
  return `
    SELECT conv.*, con.phone, con.name as contact_name, u.name as attendant_name
    FROM conversations conv
    JOIN contacts con ON con.id = conv.contact_id
    LEFT JOIN users u ON u.id = conv.assigned_to
    ${extraWhere}
    ORDER BY conv.updated_at DESC
  `;
}

// GET /conversations — atendente vê as suas; owner vê todas
router.get('/', authMiddleware, (req, res) => {
  const { status } = req.query;
  let where = '';
  const params = [];

  if (req.user.role === 'attendant') {
    where = 'WHERE conv.assigned_to = ?';
    params.push(req.user.id);
    if (status) { where += ' AND conv.status = ?'; params.push(status); }
  } else {
    if (status) { where = 'WHERE conv.status = ?'; params.push(status); }
  }

  const conversations = db.prepare(conversationQuery(where)).all(...params);
  res.json(conversations);
});

// GET /conversations/:id/messages
router.get('/:id/messages', authMiddleware, (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });

  if (req.user.role === 'attendant' && conv.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  const messages = db
    .prepare(`
      SELECT m.*, u.name as sender_name
      FROM messages m
      LEFT JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = ?
      ORDER BY m.timestamp ASC
    `)
    .all(req.params.id);

  // Mark as read
  db.prepare('UPDATE messages SET read = 1 WHERE conversation_id = ? AND from_me = 0').run(req.params.id);

  res.json(messages);
});

// POST /conversations/:id/transfer — owner transfere conversa
router.post('/:id/transfer', authMiddleware, ownerOnly, (req, res) => {
  const { attendant_id } = req.body;
  if (!attendant_id) return res.status(400).json({ error: 'attendant_id obrigatório' });

  const attendant = db.prepare('SELECT id FROM users WHERE id = ? AND role = ? AND active = 1').get(attendant_id, 'attendant');
  if (!attendant) return res.status(404).json({ error: 'Atendente não encontrado' });

  db.prepare(`UPDATE conversations SET assigned_to = ?, status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(attendant_id, req.params.id);

  const conv = db.prepare(conversationQuery('WHERE conv.id = ?')).get(req.params.id);
  res.json(conv);
});

// PATCH /conversations/:id/close — fechar conversa
router.patch('/:id/close', authMiddleware, (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });

  if (req.user.role === 'attendant' && conv.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  db.prepare(`UPDATE conversations SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// GET /conversations/metrics — resumo geral (owner only)
router.get('/metrics', authMiddleware, ownerOnly, (req, res) => {
  const metrics = db.prepare(`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN status = 'waiting' THEN 1 END) as waiting,
      COUNT(CASE WHEN status = 'open' THEN 1 END) as open,
      COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed
    FROM conversations
  `).get();
  res.json(metrics);
});

module.exports = router;
