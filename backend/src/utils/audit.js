/**
 * Audit log — regista acções sensíveis (LGPD + queixas internas).
 *
 * Uso (dentro de uma rota Express com req.user já populado pelo authMiddleware):
 *   const { logAction } = require('../utils/audit');
 *   logAction(req, 'conversation.delete', { type: 'conversation', id: convId });
 *   logAction(req, 'user.role_change', { type: 'user', id: userId, details: { from: 'attendant', to: 'supervisor' } });
 *
 * Fire-and-forget. Erros são swallowed para não bloquear a acção real.
 */

const db = require('../db/schema');

function logAction(req, action, target = {}) {
  try {
    const user = req?.user || {};
    const detailsJson = target.details ? JSON.stringify(target.details) : null;
    const ip = (req?.headers?.['x-forwarded-for']?.split(',')[0] || req?.ip || '').trim() || null;
    db.prepare(`
      INSERT INTO audit_log (user_id, user_name, action, target_type, target_id, details, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id || null,
      user.name || null,
      action,
      target.type || null,
      target.id != null ? parseInt(target.id, 10) : null,
      detailsJson,
      ip
    );
  } catch (err) {
    console.error('[audit] log falhou:', err.message);
  }
}

module.exports = { logAction };
