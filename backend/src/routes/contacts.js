const express = require('express');
const router = express.Router();
const db = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');
const { runLidMerge } = require('../whatsapp/client');

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
