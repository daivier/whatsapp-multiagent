const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const db = require('../db/schema');
const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, '../../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

let io;
let client;
let qrCodeData = null;
let isReady = false;

function initWhatsApp(socketIO) {
  io = socketIO;

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: process.env.WA_SESSION_PATH || './whatsapp-session' }),
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

  client.on('disconnected', (reason) => {
    isReady = false;
    io.emit('whatsapp:disconnected');
    console.log('WhatsApp desconectado, motivo:', reason);
    // Reconectar automaticamente após 5 segundos
    setTimeout(async () => {
      console.log('[reconnect] A tentar reconectar WhatsApp...');
      try { await client.destroy(); } catch (_) {}
      initWhatsApp(io);
    }, 5000);
  });

  client.on('message', async (msg) => {
    if (msg.fromMe) return;
    // Ignora status do WhatsApp, grupos e newsletter
    if (msg.from === 'status@broadcast') return;
    if (msg.from.endsWith('@g.us')) return;
    if (msg.from.endsWith('@newsletter')) return;
    // Ignora mensagens sem texto, media ou vcard
    const isVcard = msg.type === 'vcard' || msg.type === 'multi_vcard';
    if (!msg.hasMedia && !isVcard && (!msg.body || !msg.body.trim())) return;

    // Guarda o identificador completo (ex: "351912345678@c.us" ou "88244750422224@lid")
    const waId = msg.from;
    const isLid = waId.endsWith('@lid');
    const body = msg.body;

    // Upsert contact
    let contact = db.prepare('SELECT * FROM contacts WHERE wa_id = ?').get(waId);
    let phone = waId.replace(/@c\.us$/, '').replace(/@lid$/, '');

    // Para @lid já conhecido: verificar se existe contacto duplicado criado por outbound (pelo número)
    // e fundir para que as respostas entrem na conversa correcta
    if (contact && isLid) {
      let info;
      try { info = await msg.getContact(); } catch (e) {}
      const realPhone = info?.id?.user || info?.number;
      if (realPhone) {
        // Se o phone do contacto ainda é o LID (não o número real), actualiza
        const lidNum = waId.replace('@lid', '');
        if (contact.phone === lidNum || contact.phone === lidNum + '@lid') {
          db.prepare('UPDATE contacts SET phone = ? WHERE id = ?').run(realPhone, contact.id);
          contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contact.id);
        }
        // Fundir contacto duplicado criado por outbound com o número real
        const phoneContact = db.prepare('SELECT * FROM contacts WHERE (phone = ? OR phone = ?) AND id != ?')
          .get(realPhone, realPhone.replace(/^55/, ''), contact.id);
        if (phoneContact) {
          console.log(`[LID] Fundindo contacto duplicado: phone=${phoneContact.phone} (id ${phoneContact.id}) → wa_id=${waId} (id ${contact.id})`);
          db.prepare('UPDATE conversations SET contact_id = ? WHERE contact_id = ?').run(contact.id, phoneContact.id);
          db.prepare('DELETE FROM contacts WHERE id = ?').run(phoneContact.id);
        }
      }
    }

    if (!contact) {
      // Para @lid: obter o número real via getContact() ANTES de criar duplicado
      let info;
      try { info = await msg.getContact(); } catch (_) {}

      if (isLid && info) {
        // info.id.user é o número real; info.number é o LID
        const realPhone = info.id?.user || info.number || phone;
        phone = realPhone;
        // Verifica se já existe contacto com esse número
        contact = db.prepare('SELECT * FROM contacts WHERE phone = ?').get(realPhone)
               || db.prepare('SELECT * FROM contacts WHERE phone = ?').get(realPhone.replace(/^55/, ''));
        if (contact) {
          // Associa este @lid ao contacto existente para mensagens futuras
          db.prepare('UPDATE contacts SET wa_id = ? WHERE id = ?').run(waId, contact.id);
          console.log(`[LID] Associado ${waId} ao contacto existente ${contact.phone} (id ${contact.id})`);
        } else {
          // Cria novo contacto com o número real (não com o LID)
          const name = info.pushname || info.name || realPhone;
          db.prepare('INSERT INTO contacts (phone, name, wa_id) VALUES (?, ?, ?)').run(realPhone, name, waId);
          contact = db.prepare('SELECT * FROM contacts WHERE wa_id = ?').get(waId);
        }
      } else {
        // @c.us ou fallback: tenta pelo número primeiro
        contact = db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone);
        if (!contact) {
          const name = info?.pushname || info?.name || phone;
          db.prepare('INSERT INTO contacts (phone, name, wa_id) VALUES (?, ?, ?)').run(phone, name, waId);
          contact = db.prepare('SELECT * FROM contacts WHERE wa_id = ?').get(waId);
        } else if (!contact.wa_id) {
          db.prepare('UPDATE contacts SET wa_id = ? WHERE id = ?').run(waId, contact.id);
        }
      }
    }

    // Verificar bot de triagem
    function shouldSendBotReply() {
      const enabled = db.prepare(`SELECT value FROM settings WHERE key = 'bot_enabled'`).get()?.value;
      if (enabled !== '1') return false;
      const now = new Date();
      const dayKey = `hours_${now.getDay()}`;
      const dayHours = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(dayKey)?.value;
      if (!dayHours || dayHours === 'closed') return true;
      const [start, end] = dayHours.split('-');
      const currentTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      return currentTime < start || currentTime >= end;
    }

    // Find open/waiting conversation OR reopen the most recent closed one
    let conversation = db
      .prepare(`SELECT * FROM conversations WHERE contact_id = ? AND status != 'closed' ORDER BY id DESC LIMIT 1`)
      .get(contact.id);

    let reopened = false;
    if (!conversation) {
      // Verifica se há uma conversa fechada recente (últimas 24h) para reabrir
      const recentClosed = db
        .prepare(`SELECT * FROM conversations WHERE contact_id = ? AND status = 'closed' AND updated_at >= datetime('now', '-24 hours') ORDER BY id DESC LIMIT 1`)
        .get(contact.id);

      if (recentClosed) {
        // Reabrir conversa fechada recente em vez de criar nova
        db.prepare(`UPDATE conversations SET status = 'waiting', snoozed_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(recentClosed.id);
        conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(recentClosed.id);
        reopened = true;
        console.log(`[conv] Conversa ${conversation.id} reaberta por nova mensagem do contacto`);
      } else {
        db.prepare(`INSERT INTO conversations (contact_id, status) VALUES (?, 'waiting')`).run(contact.id);
        conversation = db
          .prepare(`SELECT * FROM conversations WHERE contact_id = ? ORDER BY id DESC LIMIT 1`)
          .get(contact.id);
      }

      // Auto-assign: só para conversas novas ou reabertas sem atendente
      if (!reopened || !conversation.assigned_to) {
        let attendant = db
          .prepare(`
            SELECT u.id, COUNT(c.id) as load FROM users u
            LEFT JOIN conversations c ON c.assigned_to = u.id AND c.status = 'open'
            WHERE u.role = 'attendant' AND u.status != 'offline' AND u.active = 1 AND u.on_shift = 1
            GROUP BY u.id ORDER BY load ASC LIMIT 1
          `)
          .get();
        if (!attendant) {
          attendant = db
            .prepare(`
              SELECT u.id, COUNT(c.id) as load FROM users u
              LEFT JOIN conversations c ON c.assigned_to = u.id AND c.status = 'open'
              WHERE u.role = 'attendant' AND u.status != 'offline' AND u.active = 1
              GROUP BY u.id ORDER BY load ASC LIMIT 1
            `)
            .get();
        }
        if (attendant) {
          db.prepare(`UPDATE conversations SET assigned_to = ?, status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(attendant.id, conversation.id);
          conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversation.id);
        }
      }
    }

    // Tratar vCard
    let mediaUrl = null;
    let mediaType = null;
    if (isVcard) {
      mediaType = 'vcard';
      // body já tem o VCF — não precisa de fazer nada mais
    }

    // Guardar media se existir
    if (msg.hasMedia) {
      try {
        const media = await msg.downloadMedia();
        if (media) {
          const ext = media.mimetype.split('/')[1]?.split(';')[0] || 'bin';
          const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          fs.writeFileSync(path.join(UPLOADS_DIR, filename), Buffer.from(media.data, 'base64'));
          mediaUrl = `/uploads/${filename}`;
          mediaType = media.mimetype;
        }
      } catch (err) {
        console.error('Aviso: não foi possível guardar media:', err.message);
      }
    }

    // Bot de triagem — só em conversas novas (sem mensagens anteriores)
    const existingMsgs = db.prepare('SELECT COUNT(*) as c FROM messages WHERE conversation_id = ?').get(conversation.id).c;
    if (existingMsgs === 0 && shouldSendBotReply()) {
      const botMsg = db.prepare(`SELECT value FROM settings WHERE key = 'bot_message'`).get()?.value;
      if (botMsg) {
        try { await sendMessage(waId, botMsg); } catch (_) {}
        db.prepare('INSERT INTO messages (conversation_id, from_me, body) VALUES (?, 1, ?)').run(conversation.id, botMsg);
      }
    }

    // Resolver reply_to_id se a mensagem for uma resposta a outra
    let replyToId = null;
    if (msg.hasQuotedMsg) {
      try {
        const quotedMsg = await msg.getQuotedMessage();
        const quotedWaId = quotedMsg?.id?._serialized;
        if (quotedWaId) {
          const quotedInDb = db.prepare('SELECT id FROM messages WHERE wa_message_id = ?').get(quotedWaId);
          replyToId = quotedInDb?.id || null;
        }
      } catch (_) {}
    }

    // Save message — body pode ser null em media com caption (usar '' como fallback)
    const safeBody = (msg._data?.caption) || body || '';
    const incomingWaId = msg.id?._serialized || null;
    db.prepare('INSERT INTO messages (conversation_id, from_me, body, media_url, media_type, reply_to_id, wa_message_id) VALUES (?, 0, ?, ?, ?, ?, ?)').run(conversation.id, safeBody, mediaUrl, mediaType, replyToId, incomingWaId);
    db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversation.id);

    const message = db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1')
      .get(conversation.id);

    const fullConversation = getConversationWithContact(conversation.id);

    io.emit('message:new', { message, conversation: fullConversation });
    if (conversation.assigned_to) {
      io.to(`user:${conversation.assigned_to}`).emit('message:incoming', { message, conversation: fullConversation });
    }

    // Bot por palavra-chave — só para mensagens de texto
    if (body && body.trim()) {
      const rules = db.prepare('SELECT * FROM keyword_rules WHERE active = 1').all();
      const lowerBody = body.toLowerCase();
      const matched = rules.find(r => lowerBody.includes(r.keyword.toLowerCase()));
      if (matched) {
        try {
          await sendMessage(waId, matched.response);
          db.prepare('INSERT INTO messages (conversation_id, from_me, body) VALUES (?, 1, ?)').run(conversation.id, matched.response);
          db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversation.id);
          const botMsg = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(conversation.id);
          io.emit('message:new', { message: botMsg, conversation: getConversationWithContact(conversation.id) });
        } catch (err) {
          console.error('[keyword-bot] Erro ao enviar resposta automática:', err.message);
        }
      }
    }
  });

  client.initialize().catch(err => {
    console.error('[WhatsApp] Erro na inicialização, a reiniciar em 10s:', err.message);
    isReady = false;
    setTimeout(() => {
      try { client.destroy(); } catch (_) {}
      initWhatsApp(io);
    }, 10000);
  });
}

async function disconnectWhatsApp() {
  isReady = false;
  qrCodeData = null;
  try { await client.logout(); } catch (_) {}
  try { await client.destroy(); } catch (_) {}
  // Reinicializa para gerar novo QR
  initWhatsApp(io);
}

async function sendMessage(phone, body, { quotedWaId } = {}) {
  if (!isReady) throw new Error('WhatsApp não está conectado');

  // Se phone já tem sufixo (@lid ou @c.us), usa directamente
  // Senão, adiciona @c.us como fallback
  let waId;
  if (phone.includes('@')) {
    waId = phone;
  } else {
    waId = `${phone}@c.us`;
  }

  const opts = {};
  if (quotedWaId) opts.quotedMessageId = quotedWaId;

  try {
    const msg = await client.sendMessage(waId, body, opts);
    return msg?.id?._serialized || null;
  } catch (err) {
    const isDetachedFrame = err.message && err.message.includes('detached Frame');
    if (isDetachedFrame) {
      throw new Error('WhatsApp está a reconectar, aguarde alguns segundos e tente novamente.');
    }
    const isLidError = err.message && (err.message.includes('No LID') || err.message === 't');
    if (waId.endsWith('@c.us') && isLidError) {
      const phoneNum = waId.replace('@c.us', '');
      const contact = db.prepare(`SELECT wa_id FROM contacts WHERE (phone = ? OR phone = ?) AND wa_id LIKE '%@lid'`)
                        .get(phoneNum, phoneNum.replace(/^55/, ''));
      if (contact?.wa_id) {
        console.log(`[sendMessage] Usando LID guardado ${contact.wa_id} para ${phoneNum}`);
        const msg = await client.sendMessage(contact.wa_id, body, opts);
        return msg?.id?._serialized || null;
      }
      throw new Error(`Não foi possível entregar a mensagem (No LID). O contacto precisa de enviar uma mensagem primeiro.`);
    }
    throw err;
  }
}

async function editMessage(waMessageId, newBody) {
  if (!isReady) throw new Error('WhatsApp não está conectado');
  const msg = await client.getMessageById(waMessageId);
  if (!msg) throw new Error('Mensagem não encontrada no WhatsApp');
  await msg.edit(newBody);
}

async function sendMedia(phone, filePath, filename, caption) {
  if (!isReady) throw new Error('WhatsApp não está conectado');
  const media = MessageMedia.fromFilePath(filePath);
  if (filename) media.filename = filename;
  const opts = caption ? { caption } : {};
  let waId = phone.includes('@') ? phone : `${phone}@c.us`;
  try {
    await client.sendMessage(waId, media, opts);
  } catch (err) {
    if (waId.endsWith('@c.us') && err.message && (err.message.includes('No LID') || err.message === 't')) {
      await client.sendMessage(waId.replace('@c.us', '@lid'), media, opts);
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
      SELECT conv.*, con.phone, con.name as contact_name, con.email as contact_email, con.notes as contact_notes, con.id as contact_id, u.name as attendant_name
      FROM conversations conv
      JOIN contacts con ON con.id = conv.contact_id
      LEFT JOIN users u ON u.id = conv.assigned_to
      WHERE conv.id = ?
    `)
    .get(conversationId);
}

module.exports = { initWhatsApp, sendMessage, sendMedia, editMessage, getStatus, disconnectWhatsApp };
