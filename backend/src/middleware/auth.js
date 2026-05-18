const jwt = require('jsonwebtoken');
const db = require('../db/schema');

const SECRET = process.env.JWT_SECRET || 'whatsapp_secret_2024';

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });

  try {
    const payload = jwt.verify(token, SECRET);
    const user = db.prepare('SELECT id, name, email, role, status, active FROM users WHERE id = ?').get(payload.id);
    if (!user || !user.active) return res.status(401).json({ error: 'Utilizador inativo' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

function ownerOnly(req, res, next) {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Apenas o dono pode fazer isso' });
  next();
}

module.exports = { authMiddleware, ownerOnly, SECRET };
