const express = require('express');
const router = express.Router();
const db = require('../db/schema');
const { authMiddleware, ownerOnly } = require('../middleware/auth');
const { sendMessage } = require('../whatsapp/client');
const ioInstance = require('../io-instance');
const { logAction } = require('../utils/audit');

// GET /broadcast/logs
router.get('/logs', authMiddleware, ownerOnly, (req, res) => {
  const logs = db.prepare('SELECT * FROM broadcast_logs ORDER BY id DESC LIMIT 100').all();
  res.json(logs);
});

// POST /broadcast
router.post('/', authMiddleware, ownerOnly, async (req, res) => {
  const { contact_ids, message, line_id } = req.body;
  if (!Array.isArray(contact_ids) || contact_ids.length === 0)
    return res.status(400).json({ error: 'contact_ids obrigatorio' });
  if (!message?.trim())
    return res.status(400).json({ error: 'message obrigatorio' });

  let lineId = line_id ? parseInt(line_id, 10) : null;
  if (!lineId) {
    const def = db.prepare('SELECT id FROM lines WHERE is_default = 1 AND active = 1 LIMIT 1').get();
    lineId = def?.id;
  }
  if (!lineId) return res.status(400).json({ error: 'Nenhuma linha activa para envio' });

  const lineRow = db.prepare('SELECT * FROM lines WHERE id = ?').get(lineId);
  const lineName = lineRow?.name || lineRow?.phone_number || String(lineId);
  const total = contact_ids.length;

  const logId = db.prepare(
    'INSERT INTO broadcast_logs (user_id, user_name, line_id, line_name, message, total, sent, failed, status) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)'
  ).run(req.user.id, req.user.name || req.user.username || 'desconhecido', lineId, lineName, message.trim(), total, 'running').lastInsertRowid;

  console.log(`[broadcast] log#${logId} iniciado por user#${req.user.id} (${req.user.name || req.user.username}) linha=${lineName} total=${total}`);
  logAction(req, 'broadcast.send', { type: 'broadcast', id: logId, details: { total, line_id: lineId, line_name: lineName, preview: message.trim().slice(0, 100) } });

  res.json({ ok: true, total, line_id: lineId, log_id: logId });

  const io = ioInstance.get();
  let sent = 0, failed = 0;

  for (const contactId of contact_ids) {
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
    if (!contact) {
      failed++;
      console.warn(`[broadcast] log#${logId} contact#${contactId} nao encontrado`);
      db.prepare('UPDATE broadcast_logs SET failed = ? WHERE id = ?').run(failed, logId);
      io?.emit('broadcast:progress', { sent, failed, total, log_id: logId });
      continue;
    }

    const dest = contact.wa_id || contact.phone;
    if (!dest) {
      failed++;
      console.warn(`[broadcast] log#${logId} contact#${contactId} (${contact.name}) sem numero`);
      db.prepare('UPDATE broadcast_logs SET failed = ? WHERE id = ?').run(failed, logId);
      io?.emit('broadcast:progress', { sent, failed, total, log_id: logId });
      continue;
    }

    try {
      const waMessageId = await sendMessage(lineId, dest, message.trim());

      let conv = db.prepare(
        "SELECT * FROM conversations WHERE contact_id = ? AND line_id = ? AND status != 'closed' ORDER BY id DESC LIMIT 1"
      ).get(contact.id, lineId);

      if (!conv) {
        try {
          db.prepare("INSERT INTO conversations (contact_id, status, line_id) VALUES (?, 'open', ?)").run(contact.id, lineId);
        } catch (_) {}
        conv = db.prepare('SELECT * FROM conversations WHERE contact_id = ? AND line_id = ? ORDER BY id DESC LIMIT 1').get(contact.id, lineId);
      }

      if (conv) {
        db.prepare('INSERT INTO messages (conversation_id, from_me, body, wa_message_id) VALUES (?, 1, ?, ?)')
          .run(conv.id, message.trim(), waMessageId || null);
        db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conv.id);
      }

      sent++;
      console.log(`[broadcast] log#${logId} [${sent}/${total}] enviado para ${contact.name || dest}`);
    } catch (err) {
      failed++;
      console.error(`[broadcast] log#${logId} FALHA ${contact.name || dest}: ${err.message}`);
    }

    db.prepare('UPDATE broadcast_logs SET sent = ?, failed = ? WHERE id = ?').run(sent, failed, logId);
    io?.emit('broadcast:progress', { sent, failed, total, log_id: logId });
    await new Promise(r => setTimeout(r, 1500));
  }

  db.prepare("UPDATE broadcast_logs SET sent = ?, failed = ?, status = 'done', finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(sent, failed, logId);
  console.log(`[broadcast] log#${logId} concluido: ${sent} enviados, ${failed} falhas`);
  io?.emit('broadcast:done', { sent, failed, total, log_id: logId });
});

module.exports = router;
