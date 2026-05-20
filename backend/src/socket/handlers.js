const jwt = require('jsonwebtoken');
const db = require('../db/schema');
const { SECRET } = require('../middleware/auth');
const { sendMessage, getStatus, editMessage } = require('../whatsapp/client');

function initSocket(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Não autenticado'));
    try {
      const payload = jwt.verify(token, SECRET);
      const user = db.prepare('SELECT id, name, role, status FROM users WHERE id = ? AND active = 1').get(payload.id);
      if (!user) return next(new Error('Utilizador não encontrado'));
      socket.user = user;
      next();
    } catch {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket) => {
    const { user } = socket;
    socket.join(`user:${user.id}`);
    if (user.role === 'owner') socket.join('owners');

    // Envia estado actual do WhatsApp para este socket (evita perder evento após restart)
    const waStatus = getStatus();
    if (waStatus.isReady) {
      socket.emit('whatsapp:ready');
    } else if (waStatus.hasQr) {
      socket.emit('whatsapp:qr', waStatus.qrCode);
    }

    // Restaura o preferred_status (último status escolhido pelo utilizador, nunca 'offline')
    const row = db.prepare('SELECT preferred_status FROM users WHERE id = ?').get(user.id);
    const connectStatus = row?.preferred_status || 'online';
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(connectStatus, user.id);
    io.emit('user:status', { userId: user.id, status: connectStatus });

    // Atendente envia mensagem via socket
    socket.on('message:send', async ({ conversation_id, body, reply_to_id }, callback) => {
      const conv = db
        .prepare('SELECT conv.*, con.phone, con.wa_id FROM conversations conv JOIN contacts con ON con.id = conv.contact_id WHERE conv.id = ?')
        .get(conversation_id);

      if (!conv) return callback?.({ error: 'Conversa não encontrada' });
      if (user.role === 'attendant' && conv.assigned_to !== user.id) return callback?.({ error: 'Sem permissão' });

      // Guarda na BD primeiro — a mensagem aparece sempre na UI
      const result = db
        .prepare('INSERT INTO messages (conversation_id, from_me, sender_id, body, reply_to_id) VALUES (?, 1, ?, ?, ?)')
        .run(conversation_id, user.id, body, reply_to_id || null);
      db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversation_id);
      const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);
      const fullConversation = db.prepare(`
        SELECT conv.*, con.phone, con.name as contact_name, con.email as contact_email, con.notes as contact_notes, con.id as contact_id, u.name as attendant_name
        FROM conversations conv
        JOIN contacts con ON con.id = conv.contact_id
        LEFT JOIN users u ON u.id = conv.assigned_to
        WHERE conv.id = ?
      `).get(conversation_id);

      // Formato unificado com o evento do whatsapp/client.js
      io.emit('message:new', { message, conversation: fullConversation });
      callback?.({ ok: true, message });

      // Obter wa_message_id da mensagem citada (se existir)
      let quotedWaId = null;
      if (reply_to_id) {
        const quoted = db.prepare('SELECT wa_message_id FROM messages WHERE id = ?').get(reply_to_id);
        quotedWaId = quoted?.wa_message_id || null;
      }

      // Usa wa_id (ex: @lid) se disponível, senão usa phone; guarda wa_message_id para edição futura
      try {
        const waMessageId = await sendMessage(conv.wa_id || conv.phone, body, { quotedWaId });
        if (waMessageId) {
          db.prepare('UPDATE messages SET wa_message_id = ? WHERE id = ?').run(waMessageId, result.lastInsertRowid);
        }
      } catch (err) {
        console.error('Aviso: mensagem guardada mas não enviada pelo WhatsApp:', err.message);
        // Marcar como falhada e notificar o frontend
        db.prepare('UPDATE messages SET failed = 1 WHERE id = ?').run(result.lastInsertRowid);
        const failedMsg = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);
        io.to(`conv:${conversation_id}`).emit('message:failed', { message: failedMsg, error: err.message });
      }
    });

    // Sala da conversa (para typing indicator)
    socket.on('conv:join', ({ conversation_id }) => {
      socket.join(`conv:${conversation_id}`);
    });
    socket.on('conv:leave', ({ conversation_id }) => {
      socket.leave(`conv:${conversation_id}`);
      socket.to(`conv:${conversation_id}`).emit('typing:update', { userId: user.id, name: user.name, typing: false, conversation_id });
    });

    // Indicador de digitação
    socket.on('typing:start', ({ conversation_id }) => {
      socket.to(`conv:${conversation_id}`).emit('typing:update', { userId: user.id, name: user.name, typing: true, conversation_id });
    });

    socket.on('typing:stop', ({ conversation_id }) => {
      socket.to(`conv:${conversation_id}`).emit('typing:update', { userId: user.id, name: user.name, typing: false, conversation_id });
    });

    // Atualizar status do atendente
    socket.on('user:status', ({ status }) => {
      if (!['online', 'busy', 'away', 'offline'].includes(status)) return;
      db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, user.id);
      // Guarda preferred_status (só quando o utilizador escolhe — nunca 'offline')
      if (status !== 'offline') {
        db.prepare('UPDATE users SET preferred_status = ? WHERE id = ?').run(status, user.id);
      }
      io.emit('user:status', { userId: user.id, status });
    });

    socket.on('disconnect', () => {
      db.prepare('UPDATE users SET status = ? WHERE id = ?').run('offline', user.id);
      io.emit('user:status', { userId: user.id, status: 'offline' });
    });
  });
}

module.exports = { initSocket };
