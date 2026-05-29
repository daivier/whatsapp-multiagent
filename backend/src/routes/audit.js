const express = require('express');
const router = express.Router();
const db = require('../db/schema');
const { authMiddleware, ownerOnly } = require('../middleware/auth');

router.use(authMiddleware, ownerOnly);

// GET /audit?action=&user_id=&target_type=&target_id=&from=&to=&limit=
// Filtros opcionais. Default limit 100, max 500.
router.get('/', (req, res) => {
  const { action, user_id, target_type, target_id, from, to } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  const conds = [];
  const params = [];
  if (action) { conds.push('action = ?'); params.push(action); }
  if (user_id) { conds.push('user_id = ?'); params.push(parseInt(user_id, 10)); }
  if (target_type) { conds.push('target_type = ?'); params.push(target_type); }
  if (target_id) { conds.push('target_id = ?'); params.push(parseInt(target_id, 10)); }
  if (from) { conds.push('created_at >= ?'); params.push(from); }
  if (to) { conds.push('created_at <= ?'); params.push(to); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT id, user_id, user_name, action, target_type, target_id, details, ip, created_at
    FROM audit_log
    ${where}
    ORDER BY id DESC
    LIMIT ?
  `).all(...params, limit);
  // Parse details JSON inline para conveniência
  const out = rows.map(r => ({ ...r, details: r.details ? safeParse(r.details) : null }));
  res.json(out);
});

// GET /audit/actions — lista de action strings distintos (para o frontend
// preencher um dropdown de filtro)
router.get('/actions', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').all();
  res.json(rows.map(r => r.action));
});

function safeParse(s) { try { return JSON.parse(s); } catch (_) { return s; } }

module.exports = router;
