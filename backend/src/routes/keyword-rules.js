const express = require('express');
const db = require('../db/schema');
const { authMiddleware, ownerOnly } = require('../middleware/auth');

const router = express.Router();

// GET /keyword-rules
router.get('/', authMiddleware, ownerOnly, (req, res) => {
  res.json(db.prepare('SELECT * FROM keyword_rules ORDER BY keyword ASC').all());
});

// POST /keyword-rules
router.post('/', authMiddleware, ownerOnly, (req, res) => {
  const { keyword, response } = req.body;
  if (!keyword?.trim() || !response?.trim()) return res.status(400).json({ error: 'keyword e response obrigatórios' });
  const result = db.prepare('INSERT INTO keyword_rules (keyword, response) VALUES (?, ?)').run(keyword.trim(), response.trim());
  res.json(db.prepare('SELECT * FROM keyword_rules WHERE id = ?').get(result.lastInsertRowid));
});

// PATCH /keyword-rules/:id — toggle active ou actualizar
router.patch('/:id', authMiddleware, ownerOnly, (req, res) => {
  const { keyword, response, active } = req.body;
  const rule = db.prepare('SELECT * FROM keyword_rules WHERE id = ?').get(req.params.id);
  if (!rule) return res.status(404).json({ error: 'Regra não encontrada' });
  db.prepare('UPDATE keyword_rules SET keyword = ?, response = ?, active = ? WHERE id = ?').run(
    keyword ?? rule.keyword,
    response ?? rule.response,
    active !== undefined ? (active ? 1 : 0) : rule.active,
    req.params.id,
  );
  res.json(db.prepare('SELECT * FROM keyword_rules WHERE id = ?').get(req.params.id));
});

// DELETE /keyword-rules/:id
router.delete('/:id', authMiddleware, ownerOnly, (req, res) => {
  db.prepare('DELETE FROM keyword_rules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
