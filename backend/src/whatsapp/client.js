const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const db = require('../db/schema');

let io;
let client;
let qrCodeData = null;
let isReady = false;

function initWhatsApp(socketIO) {
  io = socketIO;

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: './whatsapp-session' }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  client.on('qr', async (qr) => {
    qrCodeData = await qrcode.toDataURL(qr);
    isReady = false;
    io.emit('whatsapp:qr', qrCodeData);
    console.log('QR Code gerado — escaneie no painel do dono');
  });

  client.on('ready', () => {
    isReady = true;
    qrCodeData = null;
    io.emit('whatsapp:ready');
    console.log('WhatsApp conectado');
  });

  client.on('disconnected', () => {
    isReady = false;
    io.emit('whatsapp:disconnected');
    console.log('WhatsApp desconectado');
  });

  client.on('message', async (msg) => {
    if (msg.fromMe) return;

    // Guarda o identificador completo (ex: "351912345678@c.us" ou "88244750422224@lid")
    const waId = msg.from;
    // Número limpo para display
    const phone = waId.replace(/@c\.us$/, '').replace(/@lid$/, '');
    const body = msg.body;

    // Upsert contact — procura pelo waId completo
    let contact = db.prepare('SELECT * FROM contacts WHERE wa_id = ?').get(waId);
    if (!contact) {
      // Tenta também pelo número simples (migração de dados antigos)
      contact = db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone);
    }
    if (!contact) {
      const info = await msg.getContact();
      const name = info.pushname || info.name || phone;
      db.prepare('INSERT INTO contacts (phone, name, wa_id) VALUES (?, ?, ?)').run(phone, name, waId);
      contact = db.prepare('SELECT * FROM contacts WHERE wa_id = ?').get(waId);
    } else if (!contact.wa_id) {
      // Actualiza contactos antigos sem wa_id
      db.prepare('UPDATE contacts SET wa_id = ? WHERE id = ?').run(waId, contact.id);
    }

    // Find open conversation or create new one
    let conversation = db
      .prepare(`SELECT * FROM conversations WHERE contact_id = ? AND status != 'closed' ORDER BY id DESC LIMIT 1`)
      .get(contact.id);

    if (!conversation) {
      db.prepare(`INSERT INTO conversations (contact_id, status) VALUES (?, 'waiting')`).run(contact.id);
      conversation = db
        .prepare(`SELECT * FROM conversations WHERE contact_id = ? ORDER BY id DESC LIMIT 1`)
        .get(contact.id);

      // Auto-assign to least busy available attendant
      const attendant = db
        .prepare(`
          SELECT u.id, COUNT(c.id) as load FROM users u
          LEFT JOIN conversations c ON c.assigned_to = u.id AND c.status = 'open'
          WHERE u.role = 'attendant' AND u.status != 'offline' AND u.active = 1
          GROUP BY u.id ORDER BY load ASC LIMIT 1
        `)
        .get();

      if (attendant) {
        db.prepare(`UPDATE conversations SET assigned_to = ?, status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(attendant.id, conversation.id);
        conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversation.id);
      }
    }

    // Save message
    db.prepare('INSERT INTO messages (conversation_id, from_me, body) VALUES (?, 0, ?)').run(conversation.id, body);
    db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversation.id);

    const message = db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1')
      .get(conversation.id);

    const fullConversation = getConversationWithContact(conversation.id);

    io.emit('message:new', { message, conversation: fullConversation });
    if (conversation.assigned_to) {
      io.to(`user:${conversation.assigned_to}`).emit('message:incoming', { message, conversation: fullConversation });
    }
  });

  client.initialize();
}

async function disconnectWhatsApp() {
  isReady = false;
  qrCodeData = null;
  try { await client.logout(); } catch (_) {}
  try { await client.destroy(); } catch (_) {}
  // Reinicializa para gerar novo QR
  initWhatsApp(io);
}

async function sendMessage(phone, body) {
  if (!isReady) throw new Error('WhatsApp não está conectado');

  // Se phone já tem sufixo (@lid ou @c.us), usa directamente
  // Senão, adiciona @c.us como fallback
  let waId;
  if (phone.includes('@')) {
    waId = phone;
  } else {
    waId = `${phone}@c.us`;
  }

  try {
    await client.sendMessage(waId, body);
  } catch (err) {
    // Se @c.us falhar com LID error, tenta @lid
    if (waId.endsWith('@c.us') && err.message && (err.message.includes('No LID') || err.message === 't')) {
      const lidId = waId.replace('@c.us', '@lid');
      await client.sendMessage(lidId, body);
    } else {
      throw err;
    }
  }
}

function getStatus() {
  return { isReady, hasQr: !!qrCodeData, qrCode: qrCodeData };
}

function getConversationWithContact(conversationId) {
  return db
    .prepare(`
      SELECT conv.*, con.phone, con.name as contact_name, u.name as attendant_name
      FROM conversations conv
      JOIN contacts con ON con.id = conv.contact_id
      LEFT JOIN users u ON u.id = conv.assigned_to
      WHERE conv.id = ?
    `)
    .get(conversationId);
}

module.exports = { initWhatsApp, sendMessage, getStatus, disconnectWhatsApp };
