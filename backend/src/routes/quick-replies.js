const express = require('express');
const db = require('../db/schema');
const { authMiddleware, ownerOnly } = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM quick_replies ORDER BY category ASC, shortcut ASC').all());
});

router.post('/', authMiddleware, ownerOnly, (req, res) => {
  const { shortcut, body, category } = req.body;
  if (!shortcut || !body) return res.status(400).json({ error: 'shortcut e body obrigatórios' });
  const result = db.prepare('INSERT INTO quick_replies (shortcut, body, category) VALUES (?, ?, ?)')
    .run(shortcut.replace(/^\//, ''), body, category || null);
  res.json(db.prepare('SELECT * FROM quick_replies WHERE id = ?').get(result.lastInsertRowid));
});

router.patch('/:id', authMiddleware, ownerOnly, (req, res) => {
  const { shortcut, body, category } = req.body;
  const qr = db.prepare('SELECT * FROM quick_replies WHERE id = ?').get(req.params.id);
  if (!qr) return res.status(404).json({ error: 'Não encontrado' });
  db.prepare('UPDATE quick_replies SET shortcut = ?, body = ?, category = ? WHERE id = ?')
    .run(shortcut || qr.shortcut, body || qr.body, category !== undefined ? (category || null) : qr.category, req.params.id);
  res.json(db.prepare('SELECT * FROM quick_replies WHERE id = ?').get(req.params.id));
});

router.delete('/:id', authMiddleware, ownerOnly, (req, res) => {
  db.prepare('DELETE FROM quick_replies WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
