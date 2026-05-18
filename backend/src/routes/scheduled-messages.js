const express = require('express');
const router = express.Router();
const db = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// Listar agendamentos pendentes
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT sm.*, con.phone, con.name as contact_name, u.name as created_by_name
    FROM scheduled_messages sm
    LEFT JOIN conversations cv ON cv.id = sm.conversation_id
    LEFT JOIN contacts con ON con.id = cv.contact_id
    LEFT JOIN users u ON u.id = sm.created_by
    WHERE sm.sent_at IS NULL AND sm.cancelled = 0
    ORDER BY sm.scheduled_at ASC
  `).all();
  res.json(rows);
});

// Criar agendamento
router.post('/', (req, res) => {
  const { conversation_id, wa_id, body, scheduled_at } = req.body;
  if (!wa_id || !body || !scheduled_at) return res.status(400).json({ error: 'Campos obrigatórios em falta' });
  const r = db.prepare(
    'INSERT INTO scheduled_messages (conversation_id, wa_id, body, scheduled_at, created_by) VALUES (?, ?, ?, ?, ?)'
  ).run(conversation_id || null, wa_id, body, scheduled_at, req.user.id);
  const row = db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(r.lastInsertRowid);
  res.json(row);
});

// Cancelar agendamento
router.delete('/:id', (req, res) => {
  db.prepare('UPDATE scheduled_messages SET cancelled = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
