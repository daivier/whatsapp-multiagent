const express = require('express');
const db = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');
const { sendMessage, editMessage, deleteMessageForAll, reactToMessage, applyReactionToList } = require('../whatsapp/client');

const router = express.Router();

// POST /messages — atendente envia mensagem
router.post('/', authMiddleware, async (req, res) => {
  const { conversation_id, body } = req.body;
  if (!conversation_id || !body) return res.status(400).json({ error: 'conversation_id e body obrigatórios' });

  const conv = db
    .prepare(`
      SELECT conv.*, con.phone FROM conversations conv
      JOIN contacts con ON con.id = conv.contact_id
      WHERE conv.id = ?
    `)
    .get(conversation_id);

  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });

  if (req.user.role === 'attendant' && conv.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  try {
    await sendMessage(conv.line_id, conv.phone, body);
  } catch (err) {
    return res.status(503).json({ error: 'WhatsApp não está conectado' });
  }

  const result = db
    .prepare('INSERT INTO messages (conversation_id, from_me, sender_id, body) VALUES (?, 1, ?, ?)')
    .run(conversation_id, req.user.id, body);

  db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversation_id);

  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(message);
});

// POST /messages/:id/retry — reenviar mensagem falhada
router.post('/:id/retry', authMiddleware, async (req, res) => {
  const msg = db.prepare('SELECT m.*, c.phone, c.wa_id, conv.line_id FROM messages m JOIN conversations conv ON conv.id = m.conversation_id JOIN contacts c ON c.id = conv.contact_id WHERE m.id = ?').get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada' });
  if (!msg.from_me) return res.status(400).json({ error: 'Só é possível reenviar mensagens enviadas' });

  try {
    const waMessageId = await sendMessage(msg.line_id, msg.wa_id || msg.phone, msg.body);
    db.prepare('UPDATE messages SET failed = 0, wa_message_id = COALESCE(?, wa_message_id) WHERE id = ?').run(waMessageId, msg.id);
    const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id);
    const ioInstance = require('../io-instance').get();
    ioInstance?.to(`conv:${msg.conversation_id}`).emit('message:failed', { message: updated, error: null });
    res.json(updated);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// PATCH /messages/:id — editar mensagem enviada (máx. 15 min)
router.patch('/:id', authMiddleware, async (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'body obrigatório' });

  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada' });
  if (!msg.from_me) return res.status(400).json({ error: 'Só é possível editar mensagens enviadas' });
  if (msg.is_internal) return res.status(400).json({ error: 'Notas internas não podem ser editadas via WhatsApp' });

  // Verificar que não passou mais de 15 minutos
  const age = Date.now() - new Date(msg.timestamp.replace(' ', 'T') + 'Z').getTime();
  if (age > 15 * 60 * 1000) return res.status(400).json({ error: 'Só é possível editar mensagens enviadas nos últimos 15 minutos' });

  // Editar no WhatsApp se houver wa_message_id (linha da conversa decide qual instância)
  if (msg.wa_message_id) {
    try {
      const convForEdit = db.prepare('SELECT line_id FROM conversations WHERE id = ?').get(msg.conversation_id);
      await editMessage(convForEdit?.line_id, msg.wa_message_id, body.trim());
    } catch (err) {
      console.error('Erro ao editar no WhatsApp:', err.message);
      // Continua mesmo se o WhatsApp falhar — actualiza BD
    }
  }

  db.prepare('UPDATE messages SET body = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?').run(body.trim(), msg.id);
  const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id);

  // Emitir via socket para todos os clientes actualizarem a mensagem
  const ioInstance = require('../io-instance').get();
  ioInstance?.to(`conv:${msg.conversation_id}`).emit('message:edited', updated);

  res.json(updated);
});

// DELETE /messages/:id — apaga a mensagem no WhatsApp do destinatário (revoke)
// e marca como deleted=1 na BD. Só funciona para mensagens nossas (from_me=1).
// Atendente só pode apagar mensagens das próprias conversas; owner/supervisor em qualquer.
router.delete('/:id', authMiddleware, async (req, res) => {
  const msg = db.prepare(`SELECT m.*, conv.assigned_to, conv.line_id FROM messages m JOIN conversations conv ON conv.id = m.conversation_id WHERE m.id = ?`).get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada' });
  if (!msg.from_me) return res.status(400).json({ error: 'Só é possível apagar mensagens enviadas por nós' });
  if (msg.deleted) return res.status(400).json({ error: 'Mensagem já está apagada' });
  if (req.user.role === 'attendant' && msg.assigned_to !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });

  if (msg.wa_message_id) {
    try {
      await deleteMessageForAll(msg.line_id, msg.wa_message_id);
    } catch (err) {
      console.error('[delete-msg] WhatsApp:', err.message);
      return res.status(503).json({ error: 'Não foi possível apagar no WhatsApp: ' + err.message });
    }
  }

  db.prepare('UPDATE messages SET deleted = 1 WHERE id = ?').run(msg.id);
  const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id);

  const ioInstance = require('../io-instance').get();
  ioInstance?.emit('message:deleted', { id: msg.id, conversation_id: msg.conversation_id });

  res.json(updated);
});

// POST /messages/:id/react — adicionar/trocar/remover reacção do user actual.
// body.emoji: string com emoji (ex: '👍') ou '' para remover.
// Atualiza messages.reactions localmente E envia ao WhatsApp via Baileys.
// Atendente só pode reagir nas próprias conversas; owner/supervisor em qualquer.
router.post('/:id/react', authMiddleware, async (req, res) => {
  const { emoji } = req.body;
  if (emoji !== '' && (typeof emoji !== 'string' || emoji.length > 32)) {
    return res.status(400).json({ error: 'emoji inválido' });
  }

  const msg = db.prepare(`SELECT m.*, conv.assigned_to, conv.line_id FROM messages m JOIN conversations conv ON conv.id = m.conversation_id WHERE m.id = ?`).get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada' });
  if (msg.is_internal) return res.status(400).json({ error: 'Reacções em notas internas usam o chat interno' });
  if (req.user.role === 'attendant' && msg.assigned_to !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });

  // Aplica localmente primeiro (UI rápida)
  const senderUser = { id: req.user.id, name: req.user.name };
  const list = applyReactionToList(msg.reactions, senderUser, emoji || '');
  db.prepare('UPDATE messages SET reactions = ? WHERE id = ?').run(JSON.stringify(list), msg.id);

  const ioInstance = require('../io-instance').get();
  ioInstance?.emit('message:reactions', { id: msg.id, conversation_id: msg.conversation_id, reactions: list });

  // Envia ao WhatsApp em paralelo (não bloqueia resposta)
  if (msg.wa_message_id) {
    reactToMessage(msg.line_id, msg.wa_message_id, emoji || '').catch(err => {
      console.error('[react] WhatsApp:', err.message);
    });
  }

  res.json({ ok: true, reactions: list });
});

module.exports = router;
