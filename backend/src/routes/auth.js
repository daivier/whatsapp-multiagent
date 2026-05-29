const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/schema');
const { authMiddleware, SECRET } = require('../middleware/auth');
const { assignWaitingConversations } = require('../whatsapp/routing');

const router = express.Router();

// POST /auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e password obrigatórios' });

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
  if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Credenciais inválidas' });

  const token = jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '12h' });

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status, on_shift: user.on_shift },
  });
});

// GET /auth/me — devolve user com quiet_hours_start/end (campos opcionais)
router.get('/me', authMiddleware, (req, res) => {
  const u = db.prepare('SELECT id, name, email, role, status, on_shift, quiet_hours_start, quiet_hours_end FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: u });
});

// PATCH /auth/quiet-hours — { start: 'HH:MM' | null, end: 'HH:MM' | null }
// Define janela em que pushes não são entregues a este user (excepto urgent
// como menções). Se um dos campos vier null/vazio, a janela é desactivada.
router.patch('/quiet-hours', authMiddleware, (req, res) => {
  const { start, end } = req.body;
  const hhmm = /^\d{2}:\d{2}$/;
  const startOk = !start ? null : (hhmm.test(start) ? start : false);
  const endOk = !end ? null : (hhmm.test(end) ? end : false);
  if (startOk === false || endOk === false) return res.status(400).json({ error: 'Formato esperado HH:MM' });
  const finalStart = (startOk && endOk) ? startOk : null;
  const finalEnd = (startOk && endOk) ? endOk : null;
  db.prepare('UPDATE users SET quiet_hours_start = ?, quiet_hours_end = ? WHERE id = ?')
    .run(finalStart, finalEnd, req.user.id);
  res.json({ ok: true, quiet_hours_start: finalStart, quiet_hours_end: finalEnd });
});

// PATCH /auth/status
router.patch('/status', authMiddleware, (req, res) => {
  const { status } = req.body;
  if (!['online', 'busy', 'away', 'offline'].includes(status)) return res.status(400).json({ error: 'Status inválido' });

  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, req.user.id);
  if (status !== 'offline') {
    db.prepare('UPDATE users SET preferred_status = ? WHERE id = ?').run(status, req.user.id);
    // Auto-atribuir conversas em espera quando atendente fica disponível
    assignWaitingConversations();
  }
  res.json({ ok: true });
});

module.exports = router;
