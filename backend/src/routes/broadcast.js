const express = require('express');
const router = express.Router();
const db = require('../db/schema');
const { authMiddleware, ownerOnly } = require('../middleware/auth');
const { sendMessage } = require('../whatsapp/client');
const ioInstance = require('../io-instance');

// POST /broadcast
router.post('/', authMiddleware, ownerOnly, async (req, res) => {
  const { contact_ids, message } = req.body;
  if (!Array.isArray(contact_ids) || contact_ids.length === 0)
    return res.status(400).json({ error: 'contact_ids obrigatório' });
  if (!message?.trim())
    return res.status(400).json({ error: 'message obrigatório' });

  const total = contact_ids.length;
  // Responder imediatamente — envio acontece em background
  res.json({ ok: true, total });

  const io = ioInstance.get();
  let sent = 0, failed = 0;

  for (const contactId of contact_ids) {
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
    if (!contact) { failed++; io?.emit('broadcast:progress', { sent, failed, total }); continue; }

    const dest = contact.wa_id || contact.phone;
    if (!dest) { failed++; io?.emit('broadcast:progress', { sent, failed, total }); continue; }

    try {
      const waMessageId = await sendMessage(dest, message.trim());

      // Encontrar ou criar conversa aberta para este contacto
      let conv = db.prepare(
        "SELECT * FROM conversations WHERE contact_id = ? AND status != 'closed' ORDER BY id DESC LIMIT 1"
      ).get(contact.id);

      if (!conv) {
        db.prepare("INSERT INTO conversations (contact_id, status) VALUES (?, 'open')").run(contact.id);
        conv = db.prepare('SELECT * FROM conversations WHERE contact_id = ? ORDER BY id DESC LIMIT 1').get(contact.id);
      }

      db.prepare('INSERT INTO messages (conversation_id, from_me, body, wa_message_id) VALUES (?, 1, ?, ?)')
        .run(conv.id, message.trim(), waMessageId || null);
      db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conv.id);

      sent++;
    } catch (_) {
      failed++;
    }

    io?.emit('broadcast:progress', { sent, failed, total });

    // Delay anti-spam entre mensagens (1.5s)
    await new Promise(r => setTimeout(r, 1500));
  }

  io?.emit('broadcast:done', { sent, failed, total });
});

module.exports = router;
