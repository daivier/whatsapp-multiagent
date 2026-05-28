const express = require('express');
const router = express.Router();
const db = require('../db/schema');
const { authMiddleware, ownerOnly } = require('../middleware/auth');

router.use(authMiddleware);

// GET /faq — lista todos (qualquer auth pode ver para autocomplete/preview)
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT f.*, d.name AS department_name, d.color AS department_color
    FROM faq_items f
    LEFT JOIN departments d ON d.id = f.department_id
    ORDER BY f.hit_count DESC, f.id DESC
  `).all();
  res.json(rows);
});

// POST /faq — owner cria item
router.post('/', ownerOnly, (req, res) => {
  const { question, answer, variations, department_id, active } = req.body;
  if (!question?.trim()) return res.status(400).json({ error: 'question obrigatório' });
  if (!answer?.trim()) return res.status(400).json({ error: 'answer obrigatório' });
  const r = db.prepare(
    'INSERT INTO faq_items (question, answer, variations, department_id, active) VALUES (?, ?, ?, ?, ?)'
  ).run(question.trim(), answer.trim(), variations?.trim() || null, department_id || null, active === false ? 0 : 1);
  const item = db.prepare('SELECT * FROM faq_items WHERE id = ?').get(r.lastInsertRowid);
  res.status(201).json(item);
});

// PATCH /faq/:id
router.patch('/:id', ownerOnly, (req, res) => {
  const { question, answer, variations, department_id, active } = req.body;
  const fields = [];
  const params = [];
  if (question !== undefined) { fields.push('question = ?'); params.push(question.trim()); }
  if (answer !== undefined) { fields.push('answer = ?'); params.push(answer.trim()); }
  if (variations !== undefined) { fields.push('variations = ?'); params.push(variations?.trim() || null); }
  if (department_id !== undefined) { fields.push('department_id = ?'); params.push(department_id || null); }
  if (active !== undefined) { fields.push('active = ?'); params.push(active ? 1 : 0); }
  if (fields.length === 0) return res.status(400).json({ error: 'Nada para actualizar' });
  fields.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id);
  db.prepare(`UPDATE faq_items SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  const item = db.prepare('SELECT * FROM faq_items WHERE id = ?').get(req.params.id);
  res.json(item);
});

// DELETE /faq/:id
router.delete('/:id', ownerOnly, (req, res) => {
  db.prepare('DELETE FROM faq_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// GET /faq/stats — totais globais e top items
router.get('/stats', ownerOnly, (req, res) => {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total_items,
      COUNT(CASE WHEN active = 1 THEN 1 END) AS active_items,
      COALESCE(SUM(hit_count), 0) AS total_hits
    FROM faq_items
  `).get();
  const top = db.prepare(`
    SELECT id, question, hit_count
    FROM faq_items
    WHERE active = 1
    ORDER BY hit_count DESC
    LIMIT 10
  `).all();
  res.json({ totals, top });
});

module.exports = router;
