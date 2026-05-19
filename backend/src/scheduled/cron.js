const db = require('../db/schema');
const { sendMessage } = require('../whatsapp/client');

function startScheduledMessagesCron(io) {
  setInterval(async () => {

    // Acordar conversas em snooze expirado
    const snoozedDone = db.prepare(`
      SELECT conv.id FROM conversations conv
      WHERE conv.snoozed_until IS NOT NULL AND conv.snoozed_until <= CURRENT_TIMESTAMP
    `).all();
    for (const { id } of snoozedDone) {
      db.prepare('UPDATE conversations SET snoozed_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
      const conv = db.prepare(`
        SELECT conv.*, con.phone, con.name as contact_name, u.name as attendant_name,
          (SELECT COUNT(*) FROM messages WHERE conversation_id = conv.id AND from_me = 0 AND read = 0) as unread_count,
          (SELECT MAX(timestamp) FROM messages WHERE conversation_id = conv.id AND from_me = 0) as last_client_at
        FROM conversations conv
        JOIN contacts con ON con.id = conv.contact_id
        LEFT JOIN users u ON u.id = conv.assigned_to
        WHERE conv.id = ?
      `).get(id);
      io.emit('conversation:updated', conv);
    }

    const now = new Date().toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
    const pending = db.prepare(`
      SELECT * FROM scheduled_messages
      WHERE sent_at IS NULL AND cancelled = 0
        AND substr(scheduled_at, 1, 16) <= ?
    `).all(now);

    for (const sm of pending) {
      try {
        await sendMessage(sm.wa_id, sm.body);

        db.prepare('UPDATE scheduled_messages SET sent_at = CURRENT_TIMESTAMP WHERE id = ?').run(sm.id);

        // Guardar como mensagem na conversa
        if (sm.conversation_id) {
          db.prepare(
            'INSERT INTO messages (conversation_id, from_me, body, sender_id) VALUES (?, 1, ?, ?)'
          ).run(sm.conversation_id, sm.body, sm.created_by);
          db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(sm.conversation_id);

          const message = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(sm.conversation_id);
          const conversation = db.prepare(`
            SELECT conv.*, con.phone, con.name as contact_name, u.name as attendant_name
            FROM conversations conv
            JOIN contacts con ON con.id = conv.contact_id
            LEFT JOIN users u ON u.id = conv.assigned_to
            WHERE conv.id = ?
          `).get(sm.conversation_id);
          io.emit('message:new', { message, conversation });
        }

        console.log(`[cron] Mensagem agendada ${sm.id} enviada para ${sm.wa_id}`);
      } catch (err) {
        console.error(`[cron] Erro ao enviar mensagem agendada ${sm.id}:`, err.message);
      }
    }
  }, 30000); // verifica a cada 30 segundos
}

module.exports = { startScheduledMessagesCron };
