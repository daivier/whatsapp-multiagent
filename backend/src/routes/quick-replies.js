const express = require('express');
const db = require('../db/schema');
const { authMiddleware, ownerOnly } = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM quick_replies ORDER BY shortcut ASC').all());
});

router.post('/', authMiddleware, ownerOnly, (req, res) => {
  const { shortcut, body } = req.body;
  if (!shortcut || !body) return res.status(400).json({ error: 'shortcut e body obrigatórios' });
  const result = db.prepare('INSERT INTO quick_replies (shortcut, body) VALUES (?, ?)').run(shortcut.replace(/^\//, ''), body);
  res.json(db.prepare('SELECT * FROM quick_replies WHERE id = ?').get(result.lastInsertRowid));
});

router.delete('/:id', authMiddleware, ownerOnly, (req, res) => {
  db.prepare('DELETE FROM quick_replies WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
