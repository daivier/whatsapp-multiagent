const express = require('express');
const db = require('../db/schema');
const { authMiddleware, ownerOnly } = require('../middleware/auth');
const ioInstance = require('../io-instance');

const router = express.Router();

function emitTagsUpdated(convId) {
  const io = ioInstance.get();
  if (!io) return;
  const tags = db.prepare(`
    SELECT t.* FROM tags t
    JOIN conversation_tags ct ON ct.tag_id = t.id
    WHERE ct.conversation_id = ?
  `).all(convId);
  io.emit('conversation:tags_updated', { conversation_id: parseInt(convId, 10), tags });
}

router.get('/', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM tags ORDER BY name ASC').all());
});

router.post('/', authMiddleware, ownerOnly, (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'name obrigatório' });
  const result = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(name, color || '#6b7280');
  res.json(db.prepare('SELECT * FROM tags WHERE id = ?').get(result.lastInsertRowid));
});

router.delete('/:id', authMiddleware, ownerOnly, (req, res) => {
  db.prepare('DELETE FROM tags WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Atribuir tag a conversa
router.post('/conversations/:convId', authMiddleware, (req, res) => {
  const { tag_id } = req.body;
  db.prepare('INSERT OR IGNORE INTO conversation_tags (conversation_id, tag_id) VALUES (?, ?)').run(req.params.convId, tag_id);
  emitTagsUpdated(req.params.convId);
  res.json({ ok: true });
});

// Remover tag de conversa
router.delete('/conversations/:convId/:tagId', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM conversation_tags WHERE conversation_id = ? AND tag_id = ?').run(req.params.convId, req.params.tagId);
  emitTagsUpdated(req.params.convId);
  res.json({ ok: true });
});

// Tags de uma conversa
router.get('/conversations/:convId', authMiddleware, (req, res) => {
  const tags = db.prepare(`
    SELECT t.* FROM tags t
    JOIN conversation_tags ct ON ct.tag_id = t.id
    WHERE ct.conversation_id = ?
  `).all(req.params.convId);
  res.json(tags);
});

module.exports = router;
