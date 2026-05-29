const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../db/schema');
const { authMiddleware, ownerOnly } = require('../middleware/auth');
const ioInstance = require('../io-instance');

const router = express.Router();
router.use(authMiddleware);

// ─── Multer setup (reuse uploads dir) ────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '../../../uploads');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    cb(null, `ic-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 32 * 1024 * 1024 } });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getThreadMembers(threadId) {
  return db.prepare(`
    SELECT itm.user_id, itm.muted, itm.last_read_message_id,
      u.name, u.status, u.role
    FROM internal_thread_members itm
    JOIN users u ON u.id = itm.user_id
    WHERE itm.thread_id = ?
  `).all(threadId);
}

function enrichMessage(msg) {
  if (!msg) return null;
  // Attach sender info
  const sender = db.prepare('SELECT id, name, role, status FROM users WHERE id = ?').get(msg.from_user_id);
  // Attach reactions grouped
  const rawReactions = db.prepare(`
    SELECT ir.emoji, ir.user_id, u.name as user_name
    FROM internal_reactions ir
    JOIN users u ON u.id = ir.user_id
    WHERE ir.message_id = ?
  `).all(msg.id);
  const reactionsMap = {};
  for (const r of rawReactions) {
    if (!reactionsMap[r.emoji]) reactionsMap[r.emoji] = { emoji: r.emoji, count: 0, users: [] };
    reactionsMap[r.emoji].count++;
    reactionsMap[r.emoji].users.push({ id: r.user_id, name: r.user_name });
  }
  // Attach replied-to message snippet if any
  let replyTo = null;
  if (msg.reply_to_id) {
    const parent = db.prepare('SELECT id, body, from_user_id, deleted FROM internal_messages WHERE id = ?').get(msg.reply_to_id);
    if (parent) {
      const parentSender = db.prepare('SELECT name FROM users WHERE id = ?').get(parent.from_user_id);
      replyTo = { id: parent.id, body: parent.deleted ? 'Mensagem apagada' : parent.body, sender_name: parentSender?.name || 'Desconhecido' };
    }
  }
  return { ...msg, sender, reactions: Object.values(reactionsMap), reply_to: replyTo };
}

function getUnreadCount(threadId, userId) {
  const member = db.prepare('SELECT last_read_message_id FROM internal_thread_members WHERE thread_id = ? AND user_id = ?').get(threadId, userId);
  if (!member) return 0;
  if (!member.last_read_message_id) {
    return db.prepare('SELECT COUNT(*) as c FROM internal_messages WHERE thread_id = ? AND deleted = 0 AND from_user_id != ?').get(threadId, userId).c;
  }
  return db.prepare('SELECT COUNT(*) as c FROM internal_messages WHERE thread_id = ? AND id > ? AND deleted = 0 AND from_user_id != ?').get(threadId, member.last_read_message_id, userId).c;
}

function getLastMessage(threadId) {
  const msg = db.prepare(`
    SELECT im.*, u.name as sender_name
    FROM internal_messages im
    JOIN users u ON u.id = im.from_user_id
    WHERE im.thread_id = ? AND im.deleted = 0
    ORDER BY im.created_at DESC LIMIT 1
  `).get(threadId);
  return msg;
}

function buildThreadPayload(thread, userId) {
  const members = getThreadMembers(thread.id);
  const myMembership = members.find(m => m.user_id === userId);
  const unread = getUnreadCount(thread.id, userId);
  const lastMsg = getLastMessage(thread.id);

  let displayName = thread.name;
  // For DMs, the display name is the other person
  if (thread.type === 'dm') {
    const other = members.find(m => m.user_id !== userId);
    displayName = other?.name || thread.name || 'Directo';
  }

  return {
    ...thread,
    display_name: displayName,
    members,
    unread_count: unread,
    last_message: lastMsg,
    muted: myMembership?.muted || 0,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /internal-chat/threads
router.get('/threads', (req, res) => {
  const userId = req.user.id;
  const adminView = req.query.admin === '1' && req.user.role === 'owner';

  let threads;
  if (adminView) {
    threads = db.prepare('SELECT * FROM internal_threads ORDER BY created_at DESC').all();
  } else {
    threads = db.prepare(`
      SELECT t.*
      FROM internal_threads t
      JOIN internal_thread_members m ON m.thread_id = t.id AND m.user_id = ?
      ORDER BY t.created_at DESC
    `).all(userId);
  }

  const result = threads.map(t => buildThreadPayload(t, userId));
  // Sort: threads with unread first, then by last message date
  result.sort((a, b) => {
    if (a.unread_count > 0 && b.unread_count === 0) return -1;
    if (b.unread_count > 0 && a.unread_count === 0) return 1;
    const aTime = a.last_message?.created_at || a.created_at;
    const bTime = b.last_message?.created_at || b.created_at;
    return bTime > aTime ? 1 : -1;
  });

  res.json(result);
});

// GET /internal-chat/threads/:id/messages
router.get('/threads/:id/messages', (req, res) => {
  const threadId = parseInt(req.params.id, 10);
  const userId = req.user.id;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const before = req.query.before ? parseInt(req.query.before, 10) : null;

  // Check membership (owner can always view)
  if (req.user.role !== 'owner') {
    const isMember = db.prepare('SELECT 1 FROM internal_thread_members WHERE thread_id = ? AND user_id = ?').get(threadId, userId);
    if (!isMember) return res.status(403).json({ error: 'Não és membro deste canal' });
  }

  let rows;
  if (before) {
    rows = db.prepare(`
      SELECT * FROM internal_messages
      WHERE thread_id = ? AND id < ?
      ORDER BY id DESC LIMIT ?
    `).all(threadId, before, limit);
  } else {
    rows = db.prepare(`
      SELECT * FROM internal_messages
      WHERE thread_id = ?
      ORDER BY id DESC LIMIT ?
    `).all(threadId, limit);
  }

  // Reverse to chronological order
  rows.reverse();
  const enriched = rows.map(enrichMessage);
  res.json(enriched);
});

// POST /internal-chat/threads/dm — create or get DM
router.post('/threads/dm', (req, res) => {
  const { userId: targetId } = req.body;
  if (!targetId) return res.status(400).json({ error: 'userId obrigatório' });

  const myId = req.user.id;
  if (myId === parseInt(targetId, 10)) return res.status(400).json({ error: 'Não podes criar DM contigo mesmo' });

  const target = db.prepare('SELECT id, name FROM users WHERE id = ? AND active = 1').get(targetId);
  if (!target) return res.status(404).json({ error: 'Utilizador não encontrado' });

  // Find existing DM between these two users
  const existing = db.prepare(`
    SELECT t.* FROM internal_threads t
    WHERE t.type = 'dm'
    AND EXISTS (SELECT 1 FROM internal_thread_members WHERE thread_id = t.id AND user_id = ?)
    AND EXISTS (SELECT 1 FROM internal_thread_members WHERE thread_id = t.id AND user_id = ?)
  `).get(myId, targetId);

  if (existing) {
    return res.json(buildThreadPayload(existing, myId));
  }

  // Create new DM
  const r = db.prepare("INSERT INTO internal_threads (type, created_by) VALUES ('dm', ?)").run(myId);
  const threadId = r.lastInsertRowid;
  db.prepare('INSERT INTO internal_thread_members (thread_id, user_id) VALUES (?, ?)').run(threadId, myId);
  db.prepare('INSERT INTO internal_thread_members (thread_id, user_id) VALUES (?, ?)').run(threadId, targetId);

  const thread = db.prepare('SELECT * FROM internal_threads WHERE id = ?').get(threadId);
  const payload = buildThreadPayload(thread, myId);

  // Notify target
  const io = ioInstance.get();
  io?.to(`user:${targetId}`).emit('internal:thread_new', payload);

  res.status(201).json(payload);
});

// POST /internal-chat/channels — create channel
router.post('/channels', (req, res) => {
  const { name, department_id, member_ids } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name obrigatório' });

  const members = Array.isArray(member_ids) ? member_ids : [];
  if (!members.includes(req.user.id)) members.push(req.user.id);

  const r = db.prepare("INSERT INTO internal_threads (type, name, department_id, created_by) VALUES ('channel', ?, ?, ?)")
    .run(name.trim(), department_id || null, req.user.id);
  const threadId = r.lastInsertRowid;

  const addMember = db.prepare('INSERT OR IGNORE INTO internal_thread_members (thread_id, user_id) VALUES (?, ?)');
  for (const uid of members) {
    const userExists = db.prepare('SELECT id FROM users WHERE id = ? AND active = 1').get(uid);
    if (userExists) addMember.run(threadId, uid);
  }

  const thread = db.prepare('SELECT * FROM internal_threads WHERE id = ?').get(threadId);
  const payload = buildThreadPayload(thread, req.user.id);

  // Notify all members
  const io = ioInstance.get();
  for (const uid of members) {
    if (uid !== req.user.id) {
      io?.to(`user:${uid}`).emit('internal:thread_new', buildThreadPayload(thread, uid));
    }
  }

  res.status(201).json(payload);
});

// POST /internal-chat/threads/:id/messages — send message
router.post('/threads/:id/messages', (req, res) => {
  upload.single('file')(req, res, (uploadErr) => {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message });

    const threadId = parseInt(req.params.id, 10);
    const userId = req.user.id;

    // Check membership
    const isMember = db.prepare('SELECT 1 FROM internal_thread_members WHERE thread_id = ? AND user_id = ?').get(threadId, userId);
    if (!isMember) return res.status(403).json({ error: 'Não és membro deste canal' });

    const thread = db.prepare('SELECT * FROM internal_threads WHERE id = ?').get(threadId);
    if (!thread) return res.status(404).json({ error: 'Thread não encontrada' });

    const body = req.body.body || '';
    const replyToId = req.body.reply_to_id ? parseInt(req.body.reply_to_id, 10) : null;

    let mediaUrl = null, mediaType = null, mediaFilename = null;
    if (req.file) {
      mediaUrl = `/uploads/${req.file.filename}`;
      mediaType = req.file.mimetype;
      mediaFilename = req.file.originalname;
    }

    if (!body.trim() && !mediaUrl) return res.status(400).json({ error: 'Mensagem vazia' });

    // Validate reply target is in same thread
    if (replyToId) {
      const parent = db.prepare('SELECT id FROM internal_messages WHERE id = ? AND thread_id = ?').get(replyToId, threadId);
      if (!parent) return res.status(400).json({ error: 'Mensagem de reply inválida' });
    }

    const r = db.prepare(`
      INSERT INTO internal_messages (thread_id, from_user_id, body, media_url, media_type, media_filename, reply_to_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(threadId, userId, body.trim(), mediaUrl, mediaType, mediaFilename, replyToId);

    const msg = db.prepare('SELECT * FROM internal_messages WHERE id = ?').get(r.lastInsertRowid);
    const enriched = enrichMessage(msg);

    // Emit to all thread members
    const members = getThreadMembers(threadId);
    const io = ioInstance.get();
    for (const m of members) {
      io?.to(`user:${m.user_id}`).emit('internal:message', { message: enriched, thread_id: threadId, sender_name: enriched.sender?.name || '' });
    }

    // Push notifications para membros não-mutados, exceto o próprio sender.
    // push.sendToUser já respeita quiet_hours; chat interno é considerado
    // urgent (atendentes esperam saber logo) para furar quiet_hours.
    try {
      const push = require('../push');
      const senderName = enriched.sender?.name || 'Alguém';
      const preview = enriched.deleted ? 'Mensagem apagada' : (enriched.body || (mediaUrl ? '📎 Ficheiro' : ''));
      for (const m of members) {
        if (m.user_id === userId) continue;
        if (m.muted) continue;
        push.sendToUser(m.user_id, {
          title: thread.type === 'dm' ? senderName : `${thread.name}: ${senderName}`,
          body: preview.substring(0, 100),
          tag: `internal-${threadId}`,
          url: `/?thread=${threadId}`,
          urgent: true,
        });
      }
    } catch (err) { console.error('[internal-push]', err.message); }

    res.status(201).json(enriched);
  });
});

// PATCH /internal-chat/messages/:id — edit own message
router.patch('/messages/:id', (req, res) => {
  const msgId = parseInt(req.params.id, 10);
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'body obrigatório' });

  const msg = db.prepare('SELECT * FROM internal_messages WHERE id = ?').get(msgId);
  if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada' });
  if (msg.from_user_id !== req.user.id) return res.status(403).json({ error: 'Só podes editar as tuas próprias mensagens' });
  if (msg.deleted) return res.status(400).json({ error: 'Mensagem apagada não pode ser editada' });

  db.prepare('UPDATE internal_messages SET body = ?, edited = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(body.trim(), msgId);

  const updated = enrichMessage(db.prepare('SELECT * FROM internal_messages WHERE id = ?').get(msgId));

  const io = ioInstance.get();
  const members = getThreadMembers(msg.thread_id);
  for (const m of members) {
    io?.to(`user:${m.user_id}`).emit('internal:message_updated', { message: updated });
  }

  res.json(updated);
});

// DELETE /internal-chat/messages/:id — soft delete
router.delete('/messages/:id', (req, res) => {
  const msgId = parseInt(req.params.id, 10);
  const msg = db.prepare('SELECT * FROM internal_messages WHERE id = ?').get(msgId);
  if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada' });

  // Owner can delete any; others only own
  if (req.user.role !== 'owner' && msg.from_user_id !== req.user.id) {
    return res.status(403).json({ error: 'Sem permissão para apagar esta mensagem' });
  }

  db.prepare('UPDATE internal_messages SET deleted = 1, body = \'\', media_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(msgId);

  const updated = enrichMessage(db.prepare('SELECT * FROM internal_messages WHERE id = ?').get(msgId));

  const io = ioInstance.get();
  const members = getThreadMembers(msg.thread_id);
  for (const m of members) {
    io?.to(`user:${m.user_id}`).emit('internal:message_updated', { message: updated });
  }

  res.json({ ok: true });
});

// POST /internal-chat/messages/:id/react — toggle reaction
router.post('/messages/:id/react', (req, res) => {
  const msgId = parseInt(req.params.id, 10);
  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: 'emoji obrigatório' });

  const msg = db.prepare('SELECT * FROM internal_messages WHERE id = ?').get(msgId);
  if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada' });
  if (msg.deleted) return res.status(400).json({ error: 'Não podes reagir a uma mensagem apagada' });

  const userId = req.user.id;
  const existing = db.prepare('SELECT 1 FROM internal_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(msgId, userId, emoji);

  if (existing) {
    db.prepare('DELETE FROM internal_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(msgId, userId, emoji);
  } else {
    db.prepare('INSERT OR IGNORE INTO internal_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(msgId, userId, emoji);
  }

  // Build updated reactions
  const rawReactions = db.prepare(`
    SELECT ir.emoji, ir.user_id, u.name as user_name
    FROM internal_reactions ir
    JOIN users u ON u.id = ir.user_id
    WHERE ir.message_id = ?
  `).all(msgId);
  const reactionsMap = {};
  for (const r of rawReactions) {
    if (!reactionsMap[r.emoji]) reactionsMap[r.emoji] = { emoji: r.emoji, count: 0, users: [] };
    reactionsMap[r.emoji].count++;
    reactionsMap[r.emoji].users.push({ id: r.user_id, name: r.user_name });
  }
  const reactions = Object.values(reactionsMap);

  const io = ioInstance.get();
  const members = getThreadMembers(msg.thread_id);
  for (const m of members) {
    io?.to(`user:${m.user_id}`).emit('internal:reaction', { message_id: msgId, thread_id: msg.thread_id, reactions });
  }

  res.json({ reactions });
});

// POST /internal-chat/messages/:id/pin — toggle pin (owner only)
router.post('/messages/:id/pin', (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Apenas o dono pode fixar mensagens' });

  const msgId = parseInt(req.params.id, 10);
  const msg = db.prepare('SELECT * FROM internal_messages WHERE id = ?').get(msgId);
  if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada' });

  const newPinned = msg.pinned ? 0 : 1;
  db.prepare('UPDATE internal_messages SET pinned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newPinned, msgId);

  const updated = enrichMessage(db.prepare('SELECT * FROM internal_messages WHERE id = ?').get(msgId));

  const io = ioInstance.get();
  const members = getThreadMembers(msg.thread_id);
  for (const m of members) {
    io?.to(`user:${m.user_id}`).emit('internal:message_updated', { message: updated });
  }

  res.json(updated);
});

// POST /internal-chat/threads/:id/read — mark as read
router.post('/threads/:id/read', (req, res) => {
  const threadId = parseInt(req.params.id, 10);
  const userId = req.user.id;

  const lastMsg = db.prepare('SELECT id FROM internal_messages WHERE thread_id = ? AND deleted = 0 ORDER BY id DESC LIMIT 1').get(threadId);
  if (!lastMsg) return res.json({ ok: true });

  db.prepare('UPDATE internal_thread_members SET last_read_message_id = ? WHERE thread_id = ? AND user_id = ?')
    .run(lastMsg.id, threadId, userId);

  const io = ioInstance.get();
  // Notify other members (for DM read receipts)
  const members = getThreadMembers(threadId);
  for (const m of members) {
    io?.to(`user:${m.user_id}`).emit('internal:read', { thread_id: threadId, user_id: userId, last_read_message_id: lastMsg.id });
  }

  res.json({ ok: true, last_read_message_id: lastMsg.id });
});

// PATCH /internal-chat/threads/:id/mute — toggle mute
router.patch('/threads/:id/mute', (req, res) => {
  const threadId = parseInt(req.params.id, 10);
  const userId = req.user.id;

  const member = db.prepare('SELECT muted FROM internal_thread_members WHERE thread_id = ? AND user_id = ?').get(threadId, userId);
  if (!member) return res.status(403).json({ error: 'Não és membro deste canal' });

  const newMuted = member.muted ? 0 : 1;
  db.prepare('UPDATE internal_thread_members SET muted = ? WHERE thread_id = ? AND user_id = ?').run(newMuted, threadId, userId);

  res.json({ muted: newMuted });
});

// GET /internal-chat/search?q=
router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);

  const userId = req.user.id;
  const isOwner = req.user.role === 'owner';

  let rows;
  if (isOwner) {
    rows = db.prepare(`
      SELECT im.*, u.name as sender_name, t.name as thread_name, t.type as thread_type
      FROM internal_messages im
      JOIN users u ON u.id = im.from_user_id
      JOIN internal_threads t ON t.id = im.thread_id
      WHERE im.deleted = 0 AND im.body LIKE ?
      ORDER BY im.created_at DESC
      LIMIT 50
    `).all(`%${q}%`);
  } else {
    rows = db.prepare(`
      SELECT im.*, u.name as sender_name, t.name as thread_name, t.type as thread_type
      FROM internal_messages im
      JOIN users u ON u.id = im.from_user_id
      JOIN internal_threads t ON t.id = im.thread_id
      JOIN internal_thread_members m ON m.thread_id = t.id AND m.user_id = ?
      WHERE im.deleted = 0 AND im.body LIKE ?
      ORDER BY im.created_at DESC
      LIMIT 50
    `).all(userId, `%${q}%`);
  }

  res.json(rows);
});

// GET /internal-chat/users — list users for DM creation / @mentions
router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, name, role, status FROM users WHERE active = 1 ORDER BY name').all();
  res.json(users);
});


// PATCH /internal-chat/channels/:id — rename channel (owner only)
router.patch('/channels/:id', (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Apenas o dono pode renomear canais' });

  const threadId = parseInt(req.params.id, 10);
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name obrigatório' });

  const thread = db.prepare("SELECT * FROM internal_threads WHERE id = ? AND type = 'channel'").get(threadId);
  if (!thread) return res.status(404).json({ error: 'Canal não encontrado' });

  db.prepare('UPDATE internal_threads SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name.trim(), threadId);

  const updated = db.prepare('SELECT * FROM internal_threads WHERE id = ?').get(threadId);
  const payload = buildThreadPayload(updated, req.user.id);

  // Notify all members
  const io = ioInstance.get();
  const members = getThreadMembers(threadId);
  for (const m of members) {
    io?.to(`user:${m.user_id}`).emit('internal:thread_updated', payload);
  }

  res.json(payload);
});

// PUT /internal-chat/channels/:id/members — replace member list (owner only)
router.put('/channels/:id/members', (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Apenas o dono pode gerir membros' });

  const threadId = parseInt(req.params.id, 10);
  const { member_ids } = req.body;
  if (!Array.isArray(member_ids)) return res.status(400).json({ error: 'member_ids deve ser um array' });

  const thread = db.prepare("SELECT * FROM internal_threads WHERE id = ? AND type = 'channel'").get(threadId);
  if (!thread) return res.status(404).json({ error: 'Canal não encontrado' });

  // Always keep creator
  const ids = Array.from(new Set([thread.created_by, ...member_ids.map(Number)]));

  db.prepare('DELETE FROM internal_thread_members WHERE thread_id = ?').run(threadId);
  const addMember = db.prepare('INSERT OR IGNORE INTO internal_thread_members (thread_id, user_id) VALUES (?, ?)');
  for (const uid of ids) {
    const userExists = db.prepare('SELECT id FROM users WHERE id = ? AND active = 1').get(uid);
    if (userExists) addMember.run(threadId, uid);
  }

  const payload = buildThreadPayload(thread, req.user.id);
  res.json(payload);
});

// DELETE /internal-chat/channels/:id — delete channel (owner only)
router.delete('/channels/:id', (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Apenas o dono pode apagar canais' });

  const threadId = parseInt(req.params.id, 10);
  const thread = db.prepare("SELECT * FROM internal_threads WHERE id = ? AND type = 'channel'").get(threadId);
  if (!thread) return res.status(404).json({ error: 'Canal não encontrado' });

  const members = getThreadMembers(threadId);
  const memberIds = members.map(m => m.user_id);

  db.prepare('DELETE FROM internal_reactions WHERE message_id IN (SELECT id FROM internal_messages WHERE thread_id = ?)').run(threadId);
  db.prepare('DELETE FROM internal_messages WHERE thread_id = ?').run(threadId);
  db.prepare('DELETE FROM internal_thread_members WHERE thread_id = ?').run(threadId);
  db.prepare('DELETE FROM internal_threads WHERE id = ?').run(threadId);

  const io = ioInstance.get();
  for (const uid of memberIds) {
    io?.to(`user:${uid}`).emit('internal:thread_deleted', { thread_id: threadId });
  }

  res.json({ ok: true });
});

module.exports = router;
