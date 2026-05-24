const express = require('express');
const db = require('../db/schema');
const { authMiddleware, ownerOnly } = require('../middleware/auth');

const router = express.Router();

// Helper: SELECT com info do departamento e da tag (LEFT JOINs, ambos opcionais)
const SELECT_WITH_DEPT = `
  SELECT kr.*,
    d.name AS department_name, d.color AS department_color,
    t.name AS tag_name, t.color AS tag_color
  FROM keyword_rules kr
  LEFT JOIN departments d ON d.id = kr.department_id
  LEFT JOIN tags t ON t.id = kr.tag_id
`;

// GET /keyword-rules — ordenado por priority (menor = ganha primeiro), depois alfabético
router.get('/', authMiddleware, ownerOnly, (req, res) => {
  res.json(db.prepare(`${SELECT_WITH_DEPT} ORDER BY kr.priority ASC, kr.keyword ASC`).all());
});

// POST /keyword-rules — `response` agora é opcional (regra pode ser pure-routing
// ou pure-tagging). Pelo menos uma acção (response, department_id ou tag_id) tem
// de estar configurada — senão a regra não faz nada.
router.post('/', authMiddleware, ownerOnly, (req, res) => {
  const { keyword, response, department_id, tag_id, priority } = req.body;
  if (!keyword?.trim()) return res.status(400).json({ error: 'keyword obrigatório' });

  const hasResponse = response?.trim();
  const hasDept = department_id != null;
  const hasTag = tag_id != null;
  if (!hasResponse && !hasDept && !hasTag) {
    return res.status(400).json({ error: 'Indique uma resposta, departamento ou etiqueta (pelo menos um)' });
  }

  if (hasDept) {
    const dept = db.prepare('SELECT id FROM departments WHERE id = ? AND active = 1').get(department_id);
    if (!dept) return res.status(400).json({ error: 'Departamento inválido' });
  }
  if (hasTag) {
    const tag = db.prepare('SELECT id FROM tags WHERE id = ?').get(tag_id);
    if (!tag) return res.status(400).json({ error: 'Etiqueta inválida' });
  }

  const result = db.prepare(
    'INSERT INTO keyword_rules (keyword, response, department_id, tag_id, priority) VALUES (?, ?, ?, ?, ?)'
  ).run(
    keyword.trim(),
    hasResponse ? response.trim() : '',
    hasDept ? department_id : null,
    hasTag ? tag_id : null,
    Number.isInteger(priority) ? priority : 100,
  );
  res.json(db.prepare(`${SELECT_WITH_DEPT} WHERE kr.id = ?`).get(result.lastInsertRowid));
});

// PATCH /keyword-rules/:id — toggle active ou actualizar qualquer campo.
// Para desassociar dept ou tag, passar explicitamente null no body.
router.patch('/:id', authMiddleware, ownerOnly, (req, res) => {
  const { keyword, response, active, department_id, tag_id, priority } = req.body;
  const rule = db.prepare('SELECT * FROM keyword_rules WHERE id = ?').get(req.params.id);
  if (!rule) return res.status(404).json({ error: 'Regra não encontrada' });

  let nextDeptId = rule.department_id;
  if (department_id !== undefined) {
    if (department_id === null) {
      nextDeptId = null;
    } else {
      const dept = db.prepare('SELECT id FROM departments WHERE id = ? AND active = 1').get(department_id);
      if (!dept) return res.status(400).json({ error: 'Departamento inválido' });
      nextDeptId = department_id;
    }
  }

  let nextTagId = rule.tag_id;
  if (tag_id !== undefined) {
    if (tag_id === null) {
      nextTagId = null;
    } else {
      const tag = db.prepare('SELECT id FROM tags WHERE id = ?').get(tag_id);
      if (!tag) return res.status(400).json({ error: 'Etiqueta inválida' });
      nextTagId = tag_id;
    }
  }

  db.prepare(
    'UPDATE keyword_rules SET keyword = ?, response = ?, active = ?, department_id = ?, tag_id = ?, priority = ? WHERE id = ?'
  ).run(
    keyword ?? rule.keyword,
    response ?? rule.response,
    active !== undefined ? (active ? 1 : 0) : rule.active,
    nextDeptId,
    nextTagId,
    Number.isInteger(priority) ? priority : rule.priority,
    req.params.id,
  );
  res.json(db.prepare(`${SELECT_WITH_DEPT} WHERE kr.id = ?`).get(req.params.id));
});

// DELETE /keyword-rules/:id
router.delete('/:id', authMiddleware, ownerOnly, (req, res) => {
  db.prepare('DELETE FROM keyword_rules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
