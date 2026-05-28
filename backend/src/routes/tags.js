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
  if (req.user.role === 'owner') {
    // Owner vê todas as tags — filtro opcional por dept
    const deptFilter = req.query.dept ? parseInt(req.query.dept, 10) : null;
    if (deptFilter) {
      return res.json(db.prepare('SELECT * FROM tags WHERE department_id IS NULL OR department_id = ? ORDER BY name ASC').all(deptFilter));
    }
    return res.json(db.prepare('SELECT * FROM tags ORDER BY name ASC').all());
  }
  // Não-owner: globais + etiquetas dos departamentos do utilizador
  const userDepts = db.prepare('SELECT department_id FROM user_departments WHERE user_id = ?').all(req.user.id).map(r => r.department_id);
  if (userDepts.length === 0) {
    return res.json(db.prepare('SELECT * FROM tags WHERE department_id IS NULL ORDER BY name ASC').all());
  }
  const placeholders = userDepts.map(() => '?').join(',');
  res.json(db.prepare(`SELECT * FROM tags WHERE department_id IS NULL OR department_id IN (${placeholders}) ORDER BY name ASC`).all(...userDepts));
});

router.post('/', authMiddleware, (req, res) => {
  const { name, color, department_id } = req.body;
  if (!name) return res.status(400).json({ error: 'name obrigatório' });
  // Owner pode criar global ou para qualquer dept; supervisor só para o seu dept
  let deptId = null;
  if (department_id) {
    deptId = parseInt(department_id, 10);
    if (req.user.role !== 'owner') {
      // Verificar se o supervisor pertence ao departamento
      const belongs = db.prepare('SELECT 1 FROM user_departments WHERE user_id = ? AND department_id = ?').get(req.user.id, deptId);
      if (!belongs) return res.status(403).json({ error: 'Não pertences a este departamento' });
    }
  } else if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Indica o departamento da etiqueta' });
  }
  const result = db.prepare('INSERT INTO tags (name, color, department_id) VALUES (?, ?, ?)').run(name, color || '#6b7280', deptId);
  res.json(db.prepare('SELECT * FROM tags WHERE id = ?').get(result.lastInsertRowid));
});

router.delete('/:id', authMiddleware, (req, res) => {
  const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
  if (!tag) return res.status(404).json({ error: 'Etiqueta não encontrada' });
  if (req.user.role !== 'owner') {
    if (!tag.department_id) return res.status(403).json({ error: 'Sem permissão' });
    const belongs = db.prepare('SELECT 1 FROM user_departments WHERE user_id = ? AND department_id = ?').get(req.user.id, tag.department_id);
    if (!belongs) return res.status(403).json({ error: 'Sem permissão' });
  }
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
