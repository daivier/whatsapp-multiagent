const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/schema');
const { authMiddleware, ownerOnly } = require('../middleware/auth');
const { sendMessage, sendMedia } = require('../whatsapp/client');
const ioInstance = require('../io-instance');

const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '../../../uploads');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 32 * 1024 * 1024 } });

function conversationQuery(extraWhere = '') {
  return `
    SELECT conv.*, con.phone, con.wa_id, con.name as contact_name, u.name as attendant_name,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = conv.id AND from_me = 0 AND read = 0) as unread_count
    FROM conversations conv
    JOIN contacts con ON con.id = conv.contact_id
    LEFT JOIN users u ON u.id = conv.assigned_to
    ${extraWhere}
    ORDER BY conv.updated_at DESC
  `;
}

// GET /conversations
router.get('/', authMiddleware, (req, res) => {
  const { status } = req.query;
  let where = '';
  const params = [];

  if (req.user.role === 'attendant') {
    where = 'WHERE conv.assigned_to = ?';
    params.push(req.user.id);
    if (status) { where += ' AND conv.status = ?'; params.push(status); }
  } else {
    if (status) { where = 'WHERE conv.status = ?'; params.push(status); }
  }

  const conversations = db.prepare(conversationQuery(where)).all(...params);
  res.json(conversations);
});

// GET /conversations/:id/messages
router.get('/:id/messages', authMiddleware, (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });

  if (req.user.role === 'attendant' && conv.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  const messages = db
    .prepare(`
      SELECT m.*, u.name as sender_name
      FROM messages m
      LEFT JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = ?
      ORDER BY m.timestamp ASC
    `)
    .all(req.params.id);

  // Mark as read
  db.prepare('UPDATE messages SET read = 1 WHERE conversation_id = ? AND from_me = 0').run(req.params.id);

  res.json(messages);
});

// POST /conversations/:id/notes
router.post('/:id/notes', authMiddleware, (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'body obrigatório' });

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  if (req.user.role === 'attendant' && conv.assigned_to !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });

  const result = db.prepare('INSERT INTO messages (conversation_id, from_me, sender_id, body, is_internal) VALUES (?, 1, ?, ?, 1)')
    .run(req.params.id, req.user.id, body);
  const message = db.prepare('SELECT m.*, u.name as sender_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = ?').get(result.lastInsertRowid);
  res.json(message);
});

// POST /conversations/:id/send-media — enviar ficheiro/imagem
router.post('/:id/send-media', authMiddleware, upload.single('file'), async (req, res) => {
  const conv = db.prepare('SELECT conv.*, con.phone, con.wa_id FROM conversations conv JOIN contacts con ON con.id = conv.contact_id WHERE conv.id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  if (req.user.role === 'attendant' && conv.assigned_to !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });

  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Ficheiro obrigatório' });

  const caption = req.body.caption || '';
  const mediaUrl = `/uploads/${file.filename}`;

  try {
    await sendMedia(conv.wa_id || conv.phone, file.path, file.originalname, caption);

    const result = db.prepare('INSERT INTO messages (conversation_id, from_me, sender_id, body, media_url, media_type) VALUES (?, 1, ?, ?, ?, ?)')
      .run(conv.id, req.user.id, caption, mediaUrl, file.mimetype);
    db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conv.id);

    const message = db.prepare('SELECT m.*, u.name as sender_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = ?').get(result.lastInsertRowid);
    const fullConv = db.prepare(conversationQuery('WHERE conv.id = ?')).get(conv.id);

    ioInstance.get()?.emit('message:new', { message, conversation: fullConv });
    res.json(message);
  } catch (err) {
    try { fs.unlinkSync(file.path); } catch (_) {}
    res.status(500).json({ error: err.message });
  }
});

// GET /conversations/contact/:phone
router.get('/contact/:phone', authMiddleware, (req, res) => {
  const contact = db.prepare('SELECT * FROM contacts WHERE phone = ? OR wa_id LIKE ?').get(req.params.phone, `${req.params.phone}%`);
  if (!contact) return res.json([]);
  const convs = db.prepare(`
    SELECT conv.*, u.name as attendant_name,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = conv.id) as message_count
    FROM conversations conv
    LEFT JOIN users u ON u.id = conv.assigned_to
    WHERE conv.contact_id = ?
    ORDER BY conv.created_at DESC
  `).all(contact.id);
  res.json(convs);
});

// POST /conversations/:id/transfer
router.post('/:id/transfer', authMiddleware, ownerOnly, async (req, res) => {
  const { attendant_id, notify = true } = req.body;
  if (!attendant_id) return res.status(400).json({ error: 'attendant_id obrigatório' });

  const attendant = db.prepare('SELECT id, name FROM users WHERE id = ? AND role = ? AND active = 1').get(attendant_id, 'attendant');
  if (!attendant) return res.status(404).json({ error: 'Atendente não encontrado' });

  db.prepare(`UPDATE conversations SET assigned_to = ?, status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(attendant_id, req.params.id);

  const conv = db.prepare(conversationQuery('WHERE conv.id = ?')).get(req.params.id);

  if (notify) {
    const notifyText = `Olá! O seu atendimento foi transferido para *${attendant.name}*, que irá continuar a ajudá-lo em breve. 😊`;
    try {
      await sendMessage(conv.wa_id || conv.phone, notifyText);
      db.prepare('INSERT INTO messages (conversation_id, from_me, body) VALUES (?, 1, ?)').run(conv.id, notifyText);
    } catch (err) {
      console.error('Aviso: notificação de transferência não enviada:', err.message);
    }
  }

  res.json(conv);
});

// PATCH /conversations/:id/close
router.patch('/:id/close', authMiddleware, (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  if (req.user.role === 'attendant' && conv.assigned_to !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });

  db.prepare(`UPDATE conversations SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(req.params.id);
  const updated = db.prepare(conversationQuery('WHERE conv.id = ?')).get(req.params.id);
  ioInstance.get()?.emit('conversation:updated', updated);
  res.json(updated);
});

// PATCH /conversations/:id/reopen
router.patch('/:id/reopen', authMiddleware, (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  if (req.user.role === 'attendant' && conv.assigned_to !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });

  db.prepare(`UPDATE conversations SET status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(req.params.id);
  const updated = db.prepare(conversationQuery('WHERE conv.id = ?')).get(req.params.id);
  ioInstance.get()?.emit('conversation:updated', updated);
  res.json(updated);
});

// DELETE /conversations/:id
router.delete('/:id', authMiddleware, ownerOnly, (req, res) => {
  const conv = db.prepare('SELECT id FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(req.params.id);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// GET /conversations/metrics
router.get('/metrics', authMiddleware, ownerOnly, (req, res) => {
  const metrics = db.prepare(`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN status = 'waiting' THEN 1 END) as waiting,
      COUNT(CASE WHEN status = 'open' THEN 1 END) as open,
      COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed
    FROM conversations
  `).get();
  res.json(metrics);
});

// GET /conversations/reports
router.get('/reports', authMiddleware, ownerOnly, (req, res) => {
  const byAttendant = db.prepare(`
    SELECT u.name, COUNT(c.id) as total,
      COUNT(CASE WHEN c.status = 'open' THEN 1 END) as open,
      COUNT(CASE WHEN c.status = 'closed' THEN 1 END) as closed
    FROM users u
    LEFT JOIN conversations c ON c.assigned_to = u.id
    WHERE u.role = 'attendant'
    GROUP BY u.id ORDER BY total DESC
  `).all();

  const byHour = db.prepare(`
    SELECT strftime('%H', created_at) as hour, COUNT(*) as total
    FROM conversations
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY hour ORDER BY hour ASC
  `).all();

  const byDay = db.prepare(`
    SELECT strftime('%Y-%m-%d', created_at) as day, COUNT(*) as total
    FROM conversations
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY day ORDER BY day ASC
  `).all();

  const avgResponse = db.prepare(`
    SELECT ROUND(AVG(response_seconds) / 60.0, 1) as avg_minutes
    FROM (
      SELECT c.id,
        (strftime('%s', MIN(CASE WHEN m.from_me = 1 THEN m.timestamp END)) -
         strftime('%s', MIN(CASE WHEN m.from_me = 0 THEN m.timestamp END))) as response_seconds
      FROM conversations c
      JOIN messages m ON m.conversation_id = c.id
      GROUP BY c.id
      HAVING response_seconds > 0 AND response_seconds < 86400
    )
  `).get();

  res.json({ byAttendant, byHour, byDay, avgResponse });
});

module.exports = router;
