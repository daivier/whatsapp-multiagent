const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/schema');
const { authMiddleware, ownerOnly } = require('../middleware/auth');

const router = express.Router();

// GET /users/team — lista básica para @menções (qualquer utilizador autenticado)
router.get('/team', authMiddleware, (req, res) => {
  const users = db.prepare('SELECT id, name FROM users WHERE active = 1 ORDER BY name ASC').all();
  res.json(users);
});

// GET /users/available — atendentes disponíveis para transferência (online/turno, excluindo o próprio)
router.get('/available', authMiddleware, (req, res) => {
  const users = db.prepare(
    `SELECT id, name, status FROM users
     WHERE active = 1 AND role = 'attendant' AND status != 'offline' AND on_shift = 1 AND id != ?
     ORDER BY name ASC`
  ).all(req.user.id);
  res.json(users);
});

// GET /users — listar atendentes (owner only)
router.get('/', authMiddleware, ownerOnly, (req, res) => {
  const users = db
    .prepare('SELECT id, name, email, role, status, active, on_shift, created_at FROM users ORDER BY role DESC, name ASC')
    .all();
  res.json(users);
});

// POST /users — criar atendente (owner only)
router.post('/', authMiddleware, ownerOnly, (req, res) => {
  const { name, email, password, role = 'attendant' } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email e password obrigatórios' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email já existe' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(name, email, hash, role);
  const user = db.prepare('SELECT id, name, email, role, status, active FROM users WHERE id = ?').get(result.lastInsertRowid);

  res.status(201).json(user);
});

// PATCH /users/:id — ativar/desativar ou alterar dados (owner only)
router.patch('/:id', authMiddleware, ownerOnly, (req, res) => {
  const { id } = req.params;
  const { active, name } = req.body;

  if (active !== undefined) {
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  }
  if (name) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, id);
  }

  const user = db.prepare('SELECT id, name, email, role, status, active FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Utilizador não encontrado' });

  res.json(user);
});

// PATCH /users/me/shift — atendente togla o próprio turno
router.patch('/me/shift', authMiddleware, (req, res) => {
  const { on_shift } = req.body;
  db.prepare('UPDATE users SET on_shift = ? WHERE id = ?').run(on_shift ? 1 : 0, req.user.id);
  const user = db.prepare('SELECT id, name, email, role, status, active, on_shift FROM users WHERE id = ?').get(req.user.id);
  // Notifica todos via io-instance (para admin ver em tempo real)
  const ioInstance = require('../io-instance');
  ioInstance.get()?.emit('user:shift', { userId: req.user.id, on_shift: user.on_shift });
  res.json(user);
});

// PATCH /users/:id/shift — owner pode alterar turno de qualquer utilizador
router.patch('/:id/shift', authMiddleware, ownerOnly, (req, res) => {
  const { on_shift } = req.body;
  db.prepare('UPDATE users SET on_shift = ? WHERE id = ?').run(on_shift ? 1 : 0, req.params.id);
  const user = db.prepare('SELECT id, name, email, role, status, active, on_shift FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilizador não encontrado' });
  const ioInstance = require('../io-instance');
  ioInstance.get()?.emit('user:shift', { userId: user.id, on_shift: user.on_shift });
  res.json(user);
});

// GET /users/stats — métricas por atendente (owner only)
router.get('/stats', authMiddleware, ownerOnly, (req, res) => {
  const stats = db
    .prepare(`
      SELECT
        u.id, u.name, u.status,
        COUNT(CASE WHEN c.status = 'open' THEN 1 END) as open_conversations,
        COUNT(CASE WHEN c.status = 'closed' THEN 1 END) as closed_conversations,
        COUNT(c.id) as total_conversations
      FROM users u
      LEFT JOIN conversations c ON c.assigned_to = u.id
      WHERE u.role = 'attendant'
      GROUP BY u.id
    `)
    .all();
  res.json(stats);
});

module.exports = router;
