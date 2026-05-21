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

    // Alertas de SLA
    const slaMinutes = parseInt(db.prepare(`SELECT value FROM settings WHERE key = 'sla_minutes'`).get()?.value || '30', 10);
    const slaBreached = db.prepare(`
      SELECT conv.id, conv.assigned_to, con.name as contact_name, con.phone
      FROM conversations conv
      JOIN contacts con ON con.id = conv.contact_id
      WHERE conv.status != 'closed'
        AND (conv.snoozed_until IS NULL OR conv.snoozed_until <= CURRENT_TIMESTAMP)
        AND (
          SELECT MAX(m.timestamp) FROM messages m
          WHERE m.conversation_id = conv.id AND m.from_me = 0
        ) IS NOT NULL
        AND (
          SELECT MAX(m.timestamp) FROM messages m
          WHERE m.conversation_id = conv.id AND m.from_me = 0
        ) <= datetime('now', '-' || ? || ' minutes')
        AND NOT EXISTS (
          SELECT 1 FROM messages m2
          WHERE m2.conversation_id = conv.id AND m2.from_me = 1 AND m2.is_internal = 0
            AND m2.timestamp > (
              SELECT MAX(m3.timestamp) FROM messages m3
              WHERE m3.conversation_id = conv.id AND m3.from_me = 0
            )
        )
        AND (
          conv.sla_alerted_at IS NULL
          OR conv.sla_alerted_at < (
            SELECT MAX(m.timestamp) FROM messages m
            WHERE m.conversation_id = conv.id AND m.from_me = 0
          )
        )
    `).all(slaMinutes);

    for (const conv of slaBreached) {
      db.prepare('UPDATE conversations SET sla_alerted_at = CURRENT_TIMESTAMP WHERE id = ?').run(conv.id);
      const payload = {
        conversation_id: conv.id,
        contact_name: conv.contact_name || conv.phone,
        sla_minutes: slaMinutes,
      };
      // Notifica atendente responsável
      if (conv.assigned_to) io.to(`user:${conv.assigned_to}`).emit('sla:alert', payload);
      // Notifica owners
      io.to('owners').emit('sla:alert', payload);
    }

    const now = new Date().toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
    const pending = db.prepare(`
      SELECT * FROM scheduled_messages
      WHERE sent_at IS NULL AND cancelled = 0
        AND substr(scheduled_at, 1, 16) <= ?
    `).all(now);

    for (const sm of pending) {
      try {
        const waMessageId = await sendMessage(sm.wa_id, sm.body);

        db.prepare('UPDATE scheduled_messages SET sent_at = CURRENT_TIMESTAMP WHERE id = ?').run(sm.id);

        // Guardar como mensagem na conversa (com wa_message_id para evitar duplicado via messages.upsert)
        if (sm.conversation_id) {
          db.prepare(
            'INSERT INTO messages (conversation_id, from_me, body, sender_id, wa_message_id) VALUES (?, 1, ?, ?, ?)'
          ).run(sm.conversation_id, sm.body, sm.created_by, waMessageId || null);
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
