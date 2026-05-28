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

// Helper: lê departamentos de cada user (uma query, agrupa em JS)
function attachDepartments(users) {
  if (users.length === 0) return users;
  const memberships = db.prepare(`
    SELECT ud.user_id, d.id, d.name, d.color
    FROM user_departments ud
    INNER JOIN departments d ON d.id = ud.department_id
    WHERE d.active = 1
  `).all();
  const byUser = new Map();
  for (const m of memberships) {
    if (!byUser.has(m.user_id)) byUser.set(m.user_id, []);
    byUser.get(m.user_id).push({ id: m.id, name: m.name, color: m.color });
  }
  return users.map(u => ({ ...u, departments: byUser.get(u.id) || [] }));
}

// Substitui a lista de departamentos de um user (apaga + reinsere). Aceita
// silenciosamente IDs inválidos para não rebentar transacções com erros parciais.
function replaceUserDepartments(userId, deptIds) {
  if (!Array.isArray(deptIds)) return;
  db.transaction(() => {
    db.prepare('DELETE FROM user_departments WHERE user_id = ?').run(userId);
    const ins = db.prepare('INSERT INTO user_departments (user_id, department_id) VALUES (?, ?)');
    for (const did of deptIds) {
      const d = db.prepare('SELECT id FROM departments WHERE id = ? AND active = 1').get(did);
      if (d) ins.run(userId, did);
    }
  })();
}

// GET /users — listar atendentes (owner only)
router.get('/', authMiddleware, ownerOnly, (req, res) => {
  const users = db
    .prepare('SELECT id, name, email, role, status, active, on_shift, created_at FROM users ORDER BY role DESC, name ASC')
    .all();
  res.json(attachDepartments(users));
});

// POST /users — criar atendente (owner only)
router.post('/', authMiddleware, ownerOnly, (req, res) => {
  const { name, email, password, role = 'attendant', department_ids } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email e password obrigatórios' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email já existe' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(name, email, hash, role);
  if (Array.isArray(department_ids)) replaceUserDepartments(result.lastInsertRowid, department_ids);

  const user = db.prepare('SELECT id, name, email, role, status, active FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(attachDepartments([user])[0]);
});

// PATCH /users/me — qualquer utilizador altera os próprios dados (nome, email, senha)
// DEVE estar antes de /:id para o Express não capturar "me" como id
router.patch('/me', authMiddleware, (req, res) => {
  const { name, email, password, current_password } = req.body;

  // Verificar senha atual antes de alterar
  if (password || email) {
    if (!current_password) return res.status(400).json({ error: 'Senha atual obrigatória para alterar email ou senha' });
    const userCheck = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(current_password, userCheck.password_hash)) {
      return res.status(401).json({ error: 'Senha atual incorreta' });
    }
  }

  if (name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), req.user.id);
  if (email) {
    const conflict = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.trim(), req.user.id);
    if (conflict) return res.status(409).json({ error: 'Email já está em uso' });
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email.trim(), req.user.id);
  }
  if (password) {
    if (password.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  }

  const user = db.prepare('SELECT id, name, email, role, status, active, on_shift FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

// PATCH /users/:id — ativar/desativar ou alterar dados (owner only)
const VALID_ROLES = ['owner', 'supervisor', 'attendant'];
router.patch('/:id', authMiddleware, ownerOnly, (req, res) => {
  const { id } = req.params;
  const { active, name, email, password, department_ids, role } = req.body;

  if (active !== undefined) {
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  }
  if (name) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), id);
  }
  if (email) {
    const conflict = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.trim(), id);
    if (conflict) return res.status(409).json({ error: 'Email já está em uso por outro utilizador' });
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email.trim(), id);
  }
  if (password) {
    if (password.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  }
  if (role !== undefined) {
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role inválido. Aceites: ${VALID_ROLES.join(', ')}` });
    }
    // Salvaguarda: não permitir que o último owner se rebaixe (deixa sem dono)
    const target = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
    if (target?.role === 'owner' && role !== 'owner') {
      const otherOwners = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'owner' AND active = 1 AND id != ?").get(id).c;
      if (otherOwners === 0) {
        return res.status(409).json({ error: 'Não é possível rebaixar o último owner. Promove outro utilizador a owner primeiro.' });
      }
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }
  if (Array.isArray(department_ids)) replaceUserDepartments(parseInt(id, 10), department_ids);

  const user = db.prepare('SELECT id, name, email, role, status, active FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Utilizador não encontrado' });

  res.json(attachDepartments([user])[0]);
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

// GET /users/supervisor — dados em tempo real para painel supervisor (owner only)
router.get('/supervisor', authMiddleware, ownerOnly, (req, res) => {
  const attendants = db.prepare(`
    SELECT u.id, u.name, u.status, u.on_shift,
      COUNT(CASE WHEN c.status = 'open'    THEN 1 END) as open_count,
      COUNT(CASE WHEN c.status = 'waiting' THEN 1 END) as waiting_count
    FROM users u
    LEFT JOIN conversations c ON c.assigned_to = u.id AND c.status IN ('open','waiting')
    WHERE u.role = 'attendant' AND u.active = 1
    GROUP BY u.id ORDER BY u.name ASC
  `).all();

  const result = attendants.map(a => {
    const conversations = db.prepare(`
      SELECT conv.id, con.name as contact_name, con.phone,
        conv.status, conv.created_at, conv.updated_at, conv.priority,
        (SELECT body FROM messages WHERE conversation_id = conv.id ORDER BY id DESC LIMIT 1) as last_message,
        (SELECT COUNT(*) FROM messages WHERE conversation_id = conv.id AND from_me = 0 AND read = 0) as unread_count
      FROM conversations conv
      JOIN contacts con ON con.id = conv.contact_id
      WHERE conv.assigned_to = ? AND conv.status IN ('open','waiting')
      ORDER BY conv.updated_at DESC
      LIMIT 10
    `).all(a.id);
    return { ...a, conversations };
  });

  res.json(result);
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
