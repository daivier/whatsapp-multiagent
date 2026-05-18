const express = require('express');
const db = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');
const { sendMessage } = require('../whatsapp/client');

const router = express.Router();

// POST /messages — atendente envia mensagem
router.post('/', authMiddleware, async (req, res) => {
  const { conversation_id, body } = req.body;
  if (!conversation_id || !body) return res.status(400).json({ error: 'conversation_id e body obrigatórios' });

  const conv = db
    .prepare(`
      SELECT conv.*, con.phone FROM conversations conv
      JOIN contacts con ON con.id = conv.contact_id
      WHERE conv.id = ?
    `)
    .get(conversation_id);

  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });

  if (req.user.role === 'attendant' && conv.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  try {
    await sendMessage(conv.phone, body);
  } catch (err) {
    return res.status(503).json({ error: 'WhatsApp não está conectado' });
  }

  const result = db
    .prepare('INSERT INTO messages (conversation_id, from_me, sender_id, body) VALUES (?, 1, ?, ?)')
    .run(conversation_id, req.user.id, body);

  db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversation_id);

  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(message);
});

module.exports = router;
