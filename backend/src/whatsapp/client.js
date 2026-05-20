const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const db = require('../db/schema');
const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, '../../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Logger silencioso para não poluir os logs
const logger = {
  level: 'silent',
  trace: () => {}, debug: () => {}, info: () => {},
  warn: () => {}, error: () => {}, fatal: () => {},
  child: () => logger,
};

let io;
let sock = null;
let qrCodeData = null;
let isReady = false;

// Fila de reenvio: msgId → { jid, body, opts, sentAt }
// Guarda mensagens enviadas nos últimos RETRY_TTL_MS ms para reenvio se a ligação cair
const pendingQueue = new Map();
const RETRY_TTL_MS = 2 * 60 * 1000; // 2 minutos

function cleanPendingQueue() {
  const now = Date.now();
  for (const [id, entry] of pendingQueue) {
    if (now - entry.sentAt > RETRY_TTL_MS) pendingQueue.delete(id);
  }
}

async function retryPendingMessages() {
  cleanPendingQueue();
  if (pendingQueue.size === 0) return;
  console.log(`[retry] A reenviar ${pendingQueue.size} mensagem(ns) pendente(s)...`);
  for (const [id, entry] of pendingQueue) {
    try {
      const result = await sock.sendMessage(entry.jid, { text: entry.body }, entry.opts || {});
      const newId = result?.key?.id;
      if (newId) {
        // Actualizar wa_message_id na BD
        db.prepare('UPDATE messages SET wa_message_id = ? WHERE wa_message_id = ?').run(newId, id);
        pendingQueue.delete(id);
        pendingQueue.set(newId, { ...entry, sentAt: Date.now() });
      }
      console.log(`[retry] Mensagem reenviada: ${id} → ${newId}`);
    } catch (err) {
      console.error(`[retry] Falha ao reenviar ${id}:`, err.message);
    }
  }
}

function getPhoneFromJid(jid) {
  if (!jid) return '';
  return jid.split('@')[0];
}

function normalizeJid(jid) {
  if (!jid) return null;
  // Se é um LID (@lid ou número identificado como LID na BD), resolver para o número real
  if (jid.endsWith('@lid') || jid.endsWith('@c.us')) {
    const lidNum = jid.split('@')[0];
    const contact = db.prepare('SELECT phone FROM contacts WHERE wa_id = ? OR wa_id = ?')
      .get(jid, `${lidNum}@lid`);
    if (contact?.phone) return `${contact.phone}@s.whatsapp.net`;
    // Fallback: usar o número do LID directamente (pode não funcionar mas é o melhor que temos)
    return `${lidNum}@s.whatsapp.net`;
  }
  if (jid.includes('@')) return jid;
  return `${jid}@s.whatsapp.net`;
}

async function initWhatsApp(socketIO) {
  io = socketIO;

  const sessionPath = process.env.WA_SESSION_PATH || './baileys-session';
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  let version = [2, 3000, 0];
  try {
    const result = await fetchLatestBaileysVersion();
    version = result.version;
  } catch (_) {}

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger,
    browser: ['WhatsApp Multi-Atendente', 'Chrome', '120.0.0'],
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    retryRequestDelayMs: 2000,
    getMessage: async () => ({ conversation: '' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        qrCodeData = await qrcode.toDataURL(qr);
        isReady = false;
        io.emit('whatsapp:qr', qrCodeData);
        console.log('QR Code gerado — escaneie no painel do dono');
      } catch (_) {}
    }

    if (connection === 'open') {
      isReady = true;
      qrCodeData = null;
      io.emit('whatsapp:ready');
      console.log('WhatsApp conectado');
      // Reenviar mensagens que ficaram pendentes antes da desconexão
      setTimeout(retryPendingMessages, 2000);
    }

    if (connection === 'close') {
      isReady = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      console.log(`WhatsApp desconectado, motivo: ${isLoggedOut ? 'LOGOUT' : (statusCode || 'desconhecido')}`);
      io.emit('whatsapp:disconnected');
      setTimeout(() => {
        console.log('[reconnect] A tentar reconectar WhatsApp...');
        initWhatsApp(io);
      }, 3000);
    }
  });

  // Remover da fila quando o servidor confirma a entrega (status >= 2 = SERVER_ACK)
  sock.ev.on('messages.update', (updates) => {
    for (const { key, update } of updates) {
      if (update.status >= 2 && pendingQueue.has(key.id)) {
        pendingQueue.delete(key.id);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        await handleIncomingMessage(msg);
      } catch (err) {
        console.error('[message] Erro ao processar mensagem:', err.message);
      }
    }
  });
}

async function handleIncomingMessage(msg) {
  if (msg.key.fromMe) return;
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid) return;
  if (remoteJid === 'status@broadcast') return;
  if (remoteJid.endsWith('@g.us')) return;
  if (remoteJid.endsWith('@newsletter')) return;

  const waId = remoteJid; // ex: "559684078116@s.whatsapp.net"
  const phone = getPhoneFromJid(waId);
  const msgContent = msg.message;
  if (!msgContent) return;

  // Desembrulhar mensagens efémeras/viewonce
  const content = msgContent.ephemeralMessage?.message
    || msgContent.viewOnceMessage?.message
    || msgContent.viewOnceMessageV2?.message?.viewOnceMessage?.message
    || msgContent;

  // Extrair texto
  let body = content.conversation
    || content.extendedTextMessage?.text
    || content.imageMessage?.caption
    || content.videoMessage?.caption
    || content.documentMessage?.caption
    || '';

  // vCard
  const isVcard = !!(content.contactMessage || content.contactsArrayMessage);
  if (isVcard) {
    body = content.contactMessage?.vcard
      || content.contactsArrayMessage?.contacts?.map(c => c.vcard).join('\n')
      || '';
  }

  // Media
  const hasMedia = !!(content.imageMessage || content.videoMessage
    || content.audioMessage || content.documentMessage || content.stickerMessage);

  if (!hasMedia && !isVcard && !body.trim()) return;

  const pushName = msg.pushName || '';

  // Upsert contacto
  let contact = db.prepare('SELECT * FROM contacts WHERE wa_id = ?').get(waId);

  if (!contact) {
    contact = db.prepare('SELECT * FROM contacts WHERE phone = ? OR phone = ?')
      .get(phone, phone.replace(/^55/, ''));
    if (contact) {
      if (!contact.wa_id) {
        db.prepare('UPDATE contacts SET wa_id = ? WHERE id = ?').run(waId, contact.id);
        contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contact.id);
      }
    } else {
      const name = pushName || phone;
      db.prepare('INSERT INTO contacts (phone, name, wa_id) VALUES (?, ?, ?)').run(phone, name, waId);
      contact = db.prepare('SELECT * FROM contacts WHERE wa_id = ?').get(waId);
    }
  }

  // Bot de triagem
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

  // Encontrar ou criar conversa
  let conversation = db
    .prepare(`SELECT * FROM conversations WHERE contact_id = ? AND status != 'closed' ORDER BY id DESC LIMIT 1`)
    .get(contact.id);

  let reopened = false;
  if (!conversation) {
    const recentClosed = db
      .prepare(`SELECT * FROM conversations WHERE contact_id = ? AND status = 'closed' AND updated_at >= datetime('now', '-24 hours') ORDER BY id DESC LIMIT 1`)
      .get(contact.id);

    if (recentClosed) {
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

    // Auto-assign
    if (!reopened || !conversation.assigned_to) {
      let attendant = db.prepare(`
        SELECT u.id, COUNT(c.id) as load FROM users u
        LEFT JOIN conversations c ON c.assigned_to = u.id AND c.status = 'open'
        WHERE u.role = 'attendant' AND u.status != 'offline' AND u.active = 1 AND u.on_shift = 1
        GROUP BY u.id ORDER BY load ASC LIMIT 1
      `).get();
      if (!attendant) {
        attendant = db.prepare(`
          SELECT u.id, COUNT(c.id) as load FROM users u
          LEFT JOIN conversations c ON c.assigned_to = u.id AND c.status = 'open'
          WHERE u.role = 'attendant' AND u.status != 'offline' AND u.active = 1
          GROUP BY u.id ORDER BY load ASC LIMIT 1
        `).get();
      }
      if (attendant) {
        db.prepare(`UPDATE conversations SET assigned_to = ?, status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(attendant.id, conversation.id);
        conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversation.id);
      }
    }
  }

  // Guardar media
  let mediaUrl = null;
  let mediaType = null;
  if (isVcard) {
    mediaType = 'vcard';
  } else if (hasMedia) {
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      if (buffer) {
        const imgMsg = content.imageMessage;
        const vidMsg = content.videoMessage;
        const audMsg = content.audioMessage;
        const docMsg = content.documentMessage;
        const stkMsg = content.stickerMessage;
        const mimetype = imgMsg?.mimetype || vidMsg?.mimetype || audMsg?.mimetype
          || docMsg?.mimetype || stkMsg?.mimetype || 'application/octet-stream';
        const origName = docMsg?.fileName || null;
        const ext = mimetype.split('/')[1]?.split(';')[0] || 'bin';
        const filename = origName || `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
        mediaUrl = `/uploads/${filename}`;
        mediaType = mimetype;
      }
    } catch (err) {
      console.error('Aviso: não foi possível guardar media:', err.message);
    }
  }

  // Bot de triagem (só em conversas novas)
  const existingMsgs = db.prepare('SELECT COUNT(*) as c FROM messages WHERE conversation_id = ?').get(conversation.id).c;
  if (existingMsgs === 0 && shouldSendBotReply()) {
    const botMsg = db.prepare(`SELECT value FROM settings WHERE key = 'bot_message'`).get()?.value;
    if (botMsg) {
      try { await sendMessage(waId, botMsg); } catch (_) {}
      db.prepare('INSERT INTO messages (conversation_id, from_me, body) VALUES (?, 1, ?)').run(conversation.id, botMsg);
    }
  }

  // Resolver reply_to_id
  let replyToId = null;
  const contextInfo = content.extendedTextMessage?.contextInfo
    || content.imageMessage?.contextInfo
    || content.videoMessage?.contextInfo
    || content.documentMessage?.contextInfo
    || content.audioMessage?.contextInfo;
  if (contextInfo?.stanzaId) {
    const quoted = db.prepare('SELECT id FROM messages WHERE wa_message_id = ?').get(contextInfo.stanzaId);
    replyToId = quoted?.id || null;
  }

  // Guardar mensagem
  const incomingWaId = msg.key.id || null;
  const safeBody = body || '';
  db.prepare('INSERT INTO messages (conversation_id, from_me, body, media_url, media_type, reply_to_id, wa_message_id) VALUES (?, 0, ?, ?, ?, ?, ?)')
    .run(conversation.id, safeBody, mediaUrl, mediaType, replyToId, incomingWaId);
  db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversation.id);

  const message = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(conversation.id);
  const fullConversation = getConversationWithContact(conversation.id);

  io.emit('message:new', { message, conversation: fullConversation });
  if (conversation.assigned_to) {
    io.to(`user:${conversation.assigned_to}`).emit('message:incoming', { message, conversation: fullConversation });
  }

  // Bot por palavra-chave
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
}

async function sendMessage(phone, body, { quotedWaId } = {}) {
  if (!isReady || !sock) throw new Error('WhatsApp não está conectado');
  const jid = normalizeJid(phone);
  const opts = {};
  if (quotedWaId) {
    const quotedMsg = db.prepare('SELECT wa_message_id, from_me FROM messages WHERE wa_message_id = ?').get(quotedWaId);
    opts.quoted = {
      key: { id: quotedWaId, fromMe: !!(quotedMsg?.from_me), remoteJid: jid },
      message: { conversation: '' },
    };
  }
  const result = await sock.sendMessage(jid, { text: body }, opts);
  const msgId = result?.key?.id || null;
  // Registar na fila de reenvio até receber ACK do servidor
  if (msgId) {
    pendingQueue.set(msgId, { jid, body, opts, sentAt: Date.now() });
  }
  return msgId;
}

async function editMessage(waMessageId, newBody) {
  if (!isReady || !sock) throw new Error('WhatsApp não está conectado');
  const msgInDb = db.prepare(`
    SELECT m.wa_message_id, con.wa_id, con.phone
    FROM messages m
    JOIN conversations conv ON conv.id = m.conversation_id
    JOIN contacts con ON con.id = conv.contact_id
    WHERE m.wa_message_id = ? AND m.from_me = 1
  `).get(waMessageId);
  if (!msgInDb) throw new Error('Mensagem não encontrada');
  const jid = normalizeJid(msgInDb.wa_id || msgInDb.phone);
  await sock.sendMessage(jid, {
    text: newBody,
    edit: { id: waMessageId, fromMe: true, remoteJid: jid },
  });
}

async function sendMedia(phone, filePath, filename, caption) {
  if (!isReady || !sock) throw new Error('WhatsApp não está conectado');
  const jid = normalizeJid(phone);
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filename || filePath).toLowerCase().replace('.', '');
  const mimeMap = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp',
    mp4: 'video/mp4', mov: 'video/quicktime',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4',
    pdf: 'application/pdf',
  };
  const mimetype = mimeMap[ext] || 'application/octet-stream';
  const opts = caption ? { caption } : {};
  if (mimetype.startsWith('image/')) {
    await sock.sendMessage(jid, { image: buffer, mimetype, ...opts });
  } else if (mimetype.startsWith('video/')) {
    await sock.sendMessage(jid, { video: buffer, mimetype, ...opts });
  } else if (mimetype.startsWith('audio/')) {
    await sock.sendMessage(jid, { audio: buffer, mimetype, ptt: false });
  } else {
    await sock.sendMessage(jid, { document: buffer, mimetype, fileName: filename || path.basename(filePath), ...opts });
  }
}

async function disconnectWhatsApp() {
  isReady = false;
  qrCodeData = null;
  try { await sock?.logout(); } catch (_) {}
  try { sock?.end(undefined); } catch (_) {}
  sock = null;
  setTimeout(() => initWhatsApp(io), 1000);
}

function getStatus() {
  return { isReady, hasQr: !!qrCodeData, qrCode: qrCodeData };
}

function getConversationWithContact(conversationId) {
  return db.prepare(`
    SELECT conv.*, con.phone, con.name as contact_name, con.email as contact_email,
           con.notes as contact_notes, con.id as contact_id, u.name as attendant_name
    FROM conversations conv
    JOIN contacts con ON con.id = conv.contact_id
    LEFT JOIN users u ON u.id = conv.assigned_to
    WHERE conv.id = ?
  `).get(conversationId);
}

module.exports = { initWhatsApp, sendMessage, sendMedia, editMessage, getStatus, disconnectWhatsApp };
