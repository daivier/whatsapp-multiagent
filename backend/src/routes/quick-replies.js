const express = require('express');
const db = require('../db/schema');
const { authMiddleware, ownerOnly } = require('../middleware/auth');

const router = express.Router();

// SELECT helper — junta info do dono para a UI mostrar "Global" vs "atendente X"
const SELECT_WITH_OWNER = `
  SELECT qr.*, u.name AS owner_name
  FROM quick_replies qr
  LEFT JOIN users u ON u.id = qr.owner_user_id
`;

// GET — visibilidade:
//   - Owner/Supervisor: TODOS (globais + pessoais de todos os atendentes) — gestão
//   - Atendente: globais + os seus próprios
router.get('/', authMiddleware, (req, res) => {
  const isAdmin = req.user.role === 'owner' || req.user.role === 'supervisor';
  const rows = isAdmin
    ? db.prepare(`${SELECT_WITH_OWNER} ORDER BY qr.category ASC, qr.shortcut ASC`).all()
    : db.prepare(`
        ${SELECT_WITH_OWNER}
        WHERE qr.owner_user_id IS NULL OR qr.owner_user_id = ?
        ORDER BY qr.category ASC, qr.shortcut ASC
      `).all(req.user.id);
  res.json(rows);
});

// POST — body { shortcut, body, category, is_personal? }
// - Owner: is_personal=false (default) cria global; is_personal=true cria privado dele
// - Atendente: sempre cria privado (is_personal forçado a true)
router.post('/', authMiddleware, (req, res) => {
  const { shortcut, body, category, is_personal } = req.body;
  if (!shortcut || !body) return res.status(400).json({ error: 'shortcut e body obrigatórios' });

  const cleanShortcut = shortcut.replace(/^\//, '');
  const ownerId = req.user.role === 'owner'
    ? (is_personal ? req.user.id : null)
    : req.user.id;

  try {
    const result = db.prepare('INSERT INTO quick_replies (shortcut, body, category, owner_user_id) VALUES (?, ?, ?, ?)')
      .run(cleanShortcut, body, category || null, ownerId);
    res.json(db.prepare(`${SELECT_WITH_OWNER} WHERE qr.id = ?`).get(result.lastInsertRowid));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: `Atalho "/${cleanShortcut}" já existe. Escolhe outro nome (os atalhos são únicos globalmente entre todos os utilizadores).` });
    }
    throw err;
  }
});

// PATCH — pode editar:
// - próprio (owner_user_id = req.user.id), ou
// - qualquer um se for owner (gestão administrativa — inclui pessoais de outros)
router.patch('/:id', authMiddleware, (req, res) => {
  const { shortcut, body, category } = req.body;
  const qr = db.prepare('SELECT * FROM quick_replies WHERE id = ?').get(req.params.id);
  if (!qr) return res.status(404).json({ error: 'Não encontrado' });

  const isOwn = qr.owner_user_id === req.user.id;
  const isOwner = req.user.role === 'owner';
  if (!isOwn && !isOwner) {
    return res.status(403).json({ error: 'Sem permissão para editar este atalho' });
  }

  try {
    db.prepare('UPDATE quick_replies SET shortcut = ?, body = ?, category = ? WHERE id = ?').run(
      shortcut ? shortcut.replace(/^\//, '') : qr.shortcut,
      body || qr.body,
      category !== undefined ? (category || null) : qr.category,
      req.params.id,
    );
    res.json(db.prepare(`${SELECT_WITH_OWNER} WHERE qr.id = ?`).get(req.params.id));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Atalho já existe' });
    throw err;
  }
});

// DELETE — mesmas regras do PATCH (owner pode tudo, user só os seus)
router.delete('/:id', authMiddleware, (req, res) => {
  const qr = db.prepare('SELECT owner_user_id FROM quick_replies WHERE id = ?').get(req.params.id);
  if (!qr) return res.status(404).json({ error: 'Não encontrado' });
  const isOwn = qr.owner_user_id === req.user.id;
  const isOwner = req.user.role === 'owner';
  if (!isOwn && !isOwner) {
    return res.status(403).json({ error: 'Sem permissão para eliminar este atalho' });
  }
  db.prepare('DELETE FROM quick_replies WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
