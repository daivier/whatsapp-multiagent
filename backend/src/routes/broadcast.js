const express = require('express');
const router = express.Router();
const db = require('../db/schema');
const { authMiddleware, ownerOnly } = require('../middleware/auth');
const { sendMessage } = require('../whatsapp/client');
const ioInstance = require('../io-instance');

// POST /broadcast — body aceita opcionalmente line_id; sem isso usa a default
router.post('/', authMiddleware, ownerOnly, async (req, res) => {
  const { contact_ids, message, line_id } = req.body;
  if (!Array.isArray(contact_ids) || contact_ids.length === 0)
    return res.status(400).json({ error: 'contact_ids obrigatório' });
  if (!message?.trim())
    return res.status(400).json({ error: 'message obrigatório' });

  // Resolve line: usar a do body ou a default
  let lineId = line_id ? parseInt(line_id, 10) : null;
  if (!lineId) {
    const def = db.prepare("SELECT id FROM lines WHERE is_default = 1 AND active = 1 LIMIT 1").get();
    lineId = def?.id;
  }
  if (!lineId) return res.status(400).json({ error: 'Nenhuma linha activa para envio' });

  const total = contact_ids.length;
  // Responder imediatamente — envio acontece em background
  res.json({ ok: true, total, line_id: lineId });

  const io = ioInstance.get();
  let sent = 0, failed = 0;

  for (const contactId of contact_ids) {
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
    if (!contact) { failed++; io?.emit('broadcast:progress', { sent, failed, total }); continue; }

    const dest = contact.wa_id || contact.phone;
    if (!dest) { failed++; io?.emit('broadcast:progress', { sent, failed, total }); continue; }

    try {
      const waMessageId = await sendMessage(lineId, dest, message.trim());

      // Encontrar ou criar conversa aberta para este contacto NESTA linha
      let conv = db.prepare(
        "SELECT * FROM conversations WHERE contact_id = ? AND line_id = ? AND status != 'closed' ORDER BY id DESC LIMIT 1"
      ).get(contact.id, lineId);

      if (!conv) {
        db.prepare("INSERT INTO conversations (contact_id, status, line_id) VALUES (?, 'open', ?)").run(contact.id, lineId);
        conv = db.prepare('SELECT * FROM conversations WHERE contact_id = ? AND line_id = ? ORDER BY id DESC LIMIT 1').get(contact.id, lineId);
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
