const express = require('express');
const router = express.Router();
const db = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

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
  res.json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id));
});

module.exports = router;
