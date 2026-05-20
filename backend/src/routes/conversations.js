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
    SELECT conv.*, con.phone, con.wa_id, con.id as contact_id, con.name as contact_name, con.email as contact_email, con.notes as contact_notes, u.name as attendant_name,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = conv.id AND from_me = 0 AND read = 0) as unread_count,
      (SELECT MAX(timestamp) FROM messages WHERE conversation_id = conv.id AND from_me = 0) as last_client_at
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
  const conditions = [];
  const params = [];

  if (req.user.role === 'attendant') {
    conditions.push('conv.assigned_to = ?');
    params.push(req.user.id);
  }

  if (status === 'snoozed') {
    conditions.push("conv.snoozed_until IS NOT NULL AND conv.snoozed_until > CURRENT_TIMESTAMP");
  } else {
    conditions.push("(conv.snoozed_until IS NULL OR conv.snoozed_until <= CURRENT_TIMESTAMP)");
    if (status) { conditions.push('conv.status = ?'); params.push(status); }
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const conversations = db.prepare(conversationQuery(where)).all(...params);
  res.json(conversations);
});

// POST /conversations/outbound — iniciar conversa sainte
router.post('/outbound', authMiddleware, async (req, res) => {
  const { phone, message } = req.body;
  if (!phone?.trim()) return res.status(400).json({ error: 'phone obrigatório' });
  if (!message?.trim()) return res.status(400).json({ error: 'message obrigatório' });

  // Normaliza o número: remove espaços, traços, parênteses
  const cleanPhone = phone.trim().replace(/[\s\-().]/g, '');
  // Variante sem prefixo 55 para pesquisa
  const phoneNoPrefix = cleanPhone.replace(/^55/, '');

  // Upsert contacto — procura também por número sem prefixo e por wa_id
  let contact = db.prepare(`
    SELECT * FROM contacts
    WHERE phone = ? OR phone = ? OR wa_id LIKE ? OR wa_id LIKE ?
  `).get(cleanPhone, phoneNoPrefix, `${cleanPhone}%`, `${phoneNoPrefix}%`);

  let isNewContact = false;
  if (!contact) {
    db.prepare('INSERT INTO contacts (phone, name) VALUES (?, ?)').run(cleanPhone, cleanPhone);
    contact = db.prepare('SELECT * FROM contacts WHERE phone = ?').get(cleanPhone);
    isNewContact = true;
  }

  // Cria conversa (ou reabre a última fechada)
  let conversation = db.prepare(`SELECT * FROM conversations WHERE contact_id = ? AND status != 'closed' ORDER BY id DESC LIMIT 1`).get(contact.id);
  if (!conversation) {
    db.prepare(`INSERT INTO conversations (contact_id, assigned_to, status) VALUES (?, ?, 'open')`).run(contact.id, req.user.id);
    conversation = db.prepare('SELECT * FROM conversations WHERE contact_id = ? ORDER BY id DESC LIMIT 1').get(contact.id);
  }

  // Envia mensagem pelo WhatsApp
  let waMessageId;
  try {
    waMessageId = await sendMessage(contact.wa_id || cleanPhone, message);
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao enviar: ' + err.message });
  }

  // Extrair wa_id real do destinatário a partir do ID da mensagem enviada
  // Formato: "true_<waId>_<hash>" — permite detectar se é @lid ou @c.us diferente do que temos
  if (waMessageId && isNewContact) {
    const parts = waMessageId.split('_');
    if (parts.length >= 2) {
      const recipientWaId = parts[1]; // ex: "88244750422224@lid" ou "559684078116@c.us"
      if (recipientWaId && recipientWaId.includes('@')) {
        const existingContact = db.prepare('SELECT * FROM contacts WHERE wa_id = ? AND id != ?').get(recipientWaId, contact.id);
        if (existingContact) {
          // Já existe contacto com este wa_id — mover a conversa para ele e apagar o duplicado
          console.log(`[outbound] Contacto duplicado detectado: ${cleanPhone} = ${existingContact.phone} (${recipientWaId}). A fundir.`);
          db.prepare('UPDATE conversations SET contact_id = ?, assigned_to = ?, status = ? WHERE id = ?')
            .run(existingContact.id, req.user.id, 'open', conversation.id);
          db.prepare('DELETE FROM contacts WHERE id = ?').run(contact.id);
          contact = existingContact;
          conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversation.id);
        } else {
          // Actualizar o wa_id do contacto novo com o valor real
          db.prepare('UPDATE contacts SET wa_id = ? WHERE id = ?').run(recipientWaId, contact.id);
        }
      }
    }
  }

  // Guarda mensagem
  db.prepare('INSERT INTO messages (conversation_id, from_me, sender_id, body, wa_message_id) VALUES (?, 1, ?, ?, ?)').run(conversation.id, req.user.id, message, waMessageId || null);
  db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP, assigned_to = ?, status = ? WHERE id = ?').run(req.user.id, 'open', conversation.id);

  const fullConv = db.prepare(conversationQuery('WHERE conv.id = ?')).get(conversation.id);
  const msg = db.prepare('SELECT m.*, u.name as sender_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT 1').get(conversation.id);

  ioInstance.get()?.emit('message:new', { message: msg, conversation: fullConv });
  res.json(fullConv);
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
      SELECT m.*, u.name as sender_name,
        q.body as quoted_body, q.from_me as quoted_from_me,
        qu.name as quoted_sender_name, q.media_type as quoted_media_type
      FROM messages m
      LEFT JOIN users u ON u.id = m.sender_id
      LEFT JOIN messages q ON q.id = m.reply_to_id
      LEFT JOIN users qu ON qu.id = q.sender_id
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

  const conv = db.prepare('SELECT conv.*, con.name as contact_name, con.phone FROM conversations conv JOIN contacts con ON con.id = conv.contact_id WHERE conv.id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  if (req.user.role === 'attendant' && conv.assigned_to !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });

  const result = db.prepare('INSERT INTO messages (conversation_id, from_me, sender_id, body, is_internal) VALUES (?, 1, ?, ?, 1)')
    .run(req.params.id, req.user.id, body);
  const message = db.prepare('SELECT m.*, u.name as sender_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = ?').get(result.lastInsertRowid);

  // Processar @menções: emitir mention:new para cada utilizador mencionado
  const allUsers = db.prepare('SELECT id, name FROM users WHERE active = 1').all();
  for (const u of allUsers) {
    if (u.id !== req.user.id && body.includes(`@${u.name}`)) {
      ioInstance.get()?.to(`user:${u.id}`).emit('mention:new', {
        message,
        conversation: { id: conv.id, contact_name: conv.contact_name || conv.phone },
        mentioned_by: req.user.name,
      });
    }
  }

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

  const prevConv = db.prepare('SELECT assigned_to FROM conversations WHERE id = ?').get(req.params.id);
  db.prepare(`UPDATE conversations SET assigned_to = ?, status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(attendant_id, req.params.id);

  // Log de transferência
  db.prepare('INSERT INTO transfer_logs (conversation_id, from_user_id, to_user_id, transferred_by) VALUES (?, ?, ?, ?)')
    .run(req.params.id, prevConv?.assigned_to || null, attendant_id, req.user.id);

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

// PATCH /conversations/:id/priority
router.patch('/:id/priority', authMiddleware, (req, res) => {
  const { priority } = req.body;
  if (!['urgent', 'normal', 'low'].includes(priority)) return res.status(400).json({ error: 'priority deve ser urgent, normal ou low' });

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  if (req.user.role === 'attendant' && conv.assigned_to !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });

  db.prepare('UPDATE conversations SET priority = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(priority, req.params.id);
  const updated = db.prepare(conversationQuery('WHERE conv.id = ?')).get(req.params.id);
  ioInstance.get()?.emit('conversation:updated', updated);
  res.json(updated);
});

// PATCH /conversations/:id/snooze
router.patch('/:id/snooze', authMiddleware, (req, res) => {
  const { snoozed_until } = req.body; // ISO string or null to unsnooze

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  if (req.user.role === 'attendant' && conv.assigned_to !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });

  db.prepare('UPDATE conversations SET snoozed_until = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(snoozed_until || null, req.params.id);
  const updated = db.prepare(conversationQuery('WHERE conv.id = ?')).get(req.params.id);
  ioInstance.get()?.emit('conversation:updated', updated);
  res.json(updated);
});

// DELETE /conversations/:id
// POST /conversations/:id/merge — fundir com outra conversa (owner only)
// Body: { into_id } — todas as mensagens de :id são movidas para into_id, e :id é eliminada
router.post('/:id/merge', authMiddleware, ownerOnly, (req, res) => {
  const { into_id } = req.body;
  if (!into_id) return res.status(400).json({ error: 'into_id obrigatório' });

  const src = db.prepare('SELECT id FROM conversations WHERE id = ?').get(req.params.id);
  const dst = db.prepare('SELECT id FROM conversations WHERE id = ?').get(into_id);
  if (!src || !dst) return res.status(404).json({ error: 'Conversa não encontrada' });
  if (src.id === dst.id) return res.status(400).json({ error: 'Não é possível fundir uma conversa consigo própria' });

  const merge = db.transaction(() => {
    // Mover mensagens e notas
    db.prepare('UPDATE messages SET conversation_id = ? WHERE conversation_id = ?').run(into_id, src.id);
    // Mover tags (ignorar duplicados)
    db.prepare(`INSERT OR IGNORE INTO conversation_tags (conversation_id, tag_id)
                SELECT ?, tag_id FROM conversation_tags WHERE conversation_id = ?`).run(into_id, src.id);
    // Eliminar conversa de origem
    db.prepare('DELETE FROM conversation_tags WHERE conversation_id = ?').run(src.id);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(src.id);
    // Actualizar updated_at da destino
    db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(into_id);
  });
  merge();

  const io = ioInstance.get();
  io?.emit('conversation:deleted', { id: src.id });

  const result = db.prepare(`
    SELECT conv.*, con.phone, con.wa_id, con.name as contact_name, u.name as attendant_name
    FROM conversations conv
    JOIN contacts con ON con.id = conv.contact_id
    LEFT JOIN users u ON u.id = conv.assigned_to
    WHERE conv.id = ?
  `).get(into_id);
  io?.emit('conversation:updated', result);

  res.json(result);
});

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

// GET /conversations/export — CSV com histórico
router.get('/export', authMiddleware, ownerOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT conv.id, con.name as contact_name, con.phone, conv.status,
      u.name as attendant_name, conv.created_at, conv.updated_at,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = conv.id) as msg_count,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = conv.id AND from_me = 0) as client_msgs,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = conv.id AND from_me = 1) as agent_msgs
    FROM conversations conv
    JOIN contacts con ON con.id = conv.contact_id
    LEFT JOIN users u ON u.id = conv.assigned_to
    ORDER BY conv.created_at DESC
  `).all();

  const header = 'ID,Contacto,Telefone,Status,Atendente,Criado em,Última actualização,Total msgs,Msgs cliente,Msgs atendente';
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map(r => [r.id, r.contact_name || '', r.phone, r.status, r.attendant_name || '', r.created_at, r.updated_at, r.msg_count, r.client_msgs, r.agent_msgs].map(escape).join(','));

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="conversas-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send('﻿' + [header, ...lines].join('\r\n')); // BOM para Excel
});

// GET /conversations/transfer-logs
router.get('/transfer-logs', authMiddleware, ownerOnly, (req, res) => {
  const logs = db.prepare(`
    SELECT tl.id, tl.created_at,
      conv.id as conversation_id, con.name as contact_name, con.phone,
      fu.name as from_name, tu.name as to_name, bu.name as by_name
    FROM transfer_logs tl
    JOIN conversations conv ON conv.id = tl.conversation_id
    JOIN contacts con ON con.id = conv.contact_id
    LEFT JOIN users fu ON fu.id = tl.from_user_id
    JOIN users tu ON tu.id = tl.to_user_id
    JOIN users bu ON bu.id = tl.transferred_by
    ORDER BY tl.created_at DESC
    LIMIT 200
  `).all();
  res.json(logs);
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
