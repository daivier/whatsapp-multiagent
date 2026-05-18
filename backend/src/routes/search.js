const express = require('express');
const db = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /search?q=texto&limit=20
router.get('/', authMiddleware, (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json([]);

  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const like = `%${q}%`;
  const isOwner = req.user.role === 'owner';

  // Busca por nome/telefone do contacto
  const byContact = db.prepare(`
    SELECT DISTINCT conv.id as conversation_id, con.name as contact_name, con.phone,
      conv.status, u.name as attendant_name, conv.updated_at,
      NULL as message_body, NULL as message_at, 'contact' as match_type
    FROM conversations conv
    JOIN contacts con ON con.id = conv.contact_id
    LEFT JOIN users u ON u.id = conv.assigned_to
    WHERE (con.name LIKE ? OR con.phone LIKE ?)
      ${isOwner ? '' : 'AND conv.assigned_to = ?'}
    ORDER BY conv.updated_at DESC
    LIMIT ?
  `).all(...(isOwner ? [like, like, limit] : [like, like, req.user.id, limit]));

  // Busca por conteúdo de mensagens
  const byMessage = db.prepare(`
    SELECT conv.id as conversation_id, con.name as contact_name, con.phone,
      conv.status, u.name as attendant_name, conv.updated_at,
      m.body as message_body, m.timestamp as message_at, 'message' as match_type
    FROM messages m
    JOIN conversations conv ON conv.id = m.conversation_id
    JOIN contacts con ON con.id = conv.contact_id
    LEFT JOIN users u ON u.id = conv.assigned_to
    WHERE m.body LIKE ? AND m.is_internal = 0
      ${isOwner ? '' : 'AND conv.assigned_to = ?'}
    ORDER BY m.timestamp DESC
    LIMIT ?
  `).all(...(isOwner ? [like, limit] : [like, req.user.id, limit]));

  // Merge e deduplica (preferindo resultados de contacto primeiro)
  const seen = new Set();
  const results = [];
  for (const r of [...byContact, ...byMessage]) {
    if (!seen.has(`${r.match_type}-${r.conversation_id}-${r.message_at}`)) {
      seen.add(`${r.match_type}-${r.conversation_id}-${r.message_at}`);
      results.push(r);
    }
  }

  res.json(results.slice(0, limit));
});

module.exports = router;
