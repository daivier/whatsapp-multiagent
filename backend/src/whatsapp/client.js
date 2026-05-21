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
const { spawn } = require('child_process');
const os = require('os');

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

// Mapa LID → JID real (ex: "175286893162624@lid" → "5596933005328@s.whatsapp.net")
// Populado pelos eventos contacts.upsert do Baileys
const lidToJidMap = new Map();

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

  // Carregar mapa LID → telefone a partir dos ficheiros de sessão do Baileys
  // Formato: lid-mapping-{lid}_reverse.json → conteúdo = "phoneNumber"
  try {
    const sessionPath = process.env.WA_SESSION_PATH || './baileys-session';
    const files = fs.readdirSync(sessionPath).filter(f => f.startsWith('lid-mapping-') && f.endsWith('_reverse.json'));
    let count = 0;
    for (const file of files) {
      try {
        const lid = file.replace('lid-mapping-', '').replace('_reverse.json', '');
        const raw = fs.readFileSync(path.join(sessionPath, file), 'utf8');
        const phone = JSON.parse(raw); // ex: "5596933005328"
        if (phone && typeof phone === 'string') {
          lidToJidMap.set(`${lid}@lid`, `${phone}@s.whatsapp.net`);
          count++;
        }
      } catch (_) {}
    }
    if (count > 0) console.log(`[lid-map] ${count} mapeamentos LID→JID carregados da sessão`);
  } catch (_) {}

  // Actualizar mapa quando chegam novos contactos
  sock.ev.on('contacts.upsert', (contacts) => {
    for (const c of contacts) {
      if (c.id && c.lid) {
        lidToJidMap.set(c.lid, c.id);
        console.log(`[lid-map] novo: ${c.lid} → ${c.id}`);
      }
    }
  });

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
    for (const msg of messages) {
      // 'notify' = mensagem nova em tempo real (de cliente ou do telemóvel)
      // 'append' = sincronização de histórico — ignorar (exceto fromMe recentes)
      if (type !== 'notify') {
        if (!msg.key.fromMe) continue;
        const msgTs = (msg.messageTimestamp || 0) * 1000;
        if (Date.now() - msgTs > 5 * 60 * 1000) continue;
      }
      try {
        await handleIncomingMessage(msg);
      } catch (err) {
        console.error('[message] Erro ao processar mensagem:', err.message);
      }
    }
  });
}

async function handleIncomingMessage(msg) {
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid) return;
  if (remoteJid === 'status@broadcast') return;
  if (remoteJid.endsWith('@g.us')) return;
  if (remoteJid.endsWith('@newsletter')) return;

  // Se fromMe: só processar se NÃO enviámos nós pela interface (não está na BD)
  // Mensagens enviadas directamente pelo telemóvel devem aparecer na interface
  if (msg.key.fromMe) {
    const existing = db.prepare('SELECT id FROM messages WHERE wa_message_id = ?').get(msg.key.id);
    if (existing) return;
  }

  const fromMe = !!msg.key.fromMe; // true = enviada do telemóvel directamente

  // Resolver LID → JID real se possível (via mapa de contactos ou DB)
  let waId = remoteJid;
  if (waId.endsWith('@lid')) {
    const realJid = lidToJidMap.get(waId);
    if (realJid) {
      waId = realJid;
    } else {
      // Tentar resolver via BD (contacto com este LID pode ter phone real registado)
      const lidNum = waId.split('@')[0];
      const dbContact = db.prepare('SELECT phone FROM contacts WHERE wa_id = ? AND phone NOT LIKE ?').get(waId, lidNum);
      if (dbContact?.phone) {
        waId = `${dbContact.phone}@s.whatsapp.net`;
        console.log(`[lid] ${remoteJid} → ${waId} (via BD)`);
      }
    }
  }
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
    } else if (fromMe) {
      return;
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

  if (!conversation) {
    if (fromMe) {
      return;
    } else {
      // Mensagem recebida do cliente
      const recentClosed = db
        .prepare(`SELECT * FROM conversations WHERE contact_id = ? AND status = 'closed' AND updated_at >= datetime('now', '-24 hours') ORDER BY id DESC LIMIT 1`)
        .get(contact.id);

      let reopened = false;
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

      // Auto-assign (só para mensagens do cliente)
      // Apenas atribui se houver atendente online/no turno — sem fallback para offline
      if (!reopened || !conversation.assigned_to) {
        const attendant = db.prepare(`
          SELECT u.id, COUNT(c.id) as load FROM users u
          LEFT JOIN conversations c ON c.assigned_to = u.id AND c.status = 'open'
          WHERE u.role = 'attendant' AND u.status != 'offline' AND u.active = 1 AND u.on_shift = 1
          GROUP BY u.id ORDER BY load ASC LIMIT 1
        `).get();
        if (attendant) {
          db.prepare(`UPDATE conversations SET assigned_to = ?, status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(attendant.id, conversation.id);
          conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversation.id);
        }
        // Se não há ninguém disponível, conversa fica 'waiting' sem atribuição
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

  // Bot de triagem (só em conversas novas e só para mensagens do cliente)
  if (!fromMe) {
    const existingMsgs = db.prepare('SELECT COUNT(*) as c FROM messages WHERE conversation_id = ?').get(conversation.id).c;
    if (existingMsgs === 0 && shouldSendBotReply()) {
      const botMsg = db.prepare(`SELECT value FROM settings WHERE key = 'bot_message'`).get()?.value;
      if (botMsg) {
        try { await sendMessage(waId, botMsg); } catch (_) {}
        db.prepare('INSERT INTO messages (conversation_id, from_me, body) VALUES (?, 1, ?)').run(conversation.id, botMsg);
      }
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

  // Guardar mensagem (from_me=1 se enviada do telemóvel, 0 se do cliente)
  const incomingWaId = msg.key.id || null;
  // Dedup: evitar duplicado se mensagem já foi guardada (ex: pelo cron de agendamentos ou socket handler)
  if (incomingWaId) {
    const existing = db.prepare('SELECT id FROM messages WHERE wa_message_id = ?').get(incomingWaId);
    if (existing) return;
  }
  const safeBody = body || '';
  db.prepare('INSERT INTO messages (conversation_id, from_me, body, media_url, media_type, reply_to_id, wa_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(conversation.id, fromMe ? 1 : 0, safeBody, mediaUrl, mediaType, replyToId, incomingWaId);
  db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversation.id);

  const message = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(conversation.id);
  const fullConversation = getConversationWithContact(conversation.id);

  io.emit('message:new', { message, conversation: fullConversation });
  if (!fromMe && conversation.assigned_to) {
    // Notificação de mensagem recebida (só para mensagens do cliente)
    io.to(`user:${conversation.assigned_to}`).emit('message:incoming', { message, conversation: fullConversation });
  }

  // Bot por palavra-chave (só para mensagens do cliente)
  if (!fromMe && body && body.trim()) {
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

/**
 * Converte qualquer ficheiro de áudio para OGG Opus usando ffmpeg.
 * Retorna um Buffer com o resultado, ou lança erro se ffmpeg falhar.
 */
function convertToOggOpus(inputPath) {
  return new Promise((resolve, reject) => {
    const tmpOut = path.join(os.tmpdir(), `wa-audio-${Date.now()}.ogg`);
    const ff = spawn('ffmpeg', [
      '-y',                    // sobrescrever output
      '-i', inputPath,         // ficheiro de entrada
      '-vn',                   // sem vídeo
      '-c:a', 'libopus',       // codec Opus
      '-b:a', '64k',           // bitrate
      '-ar', '48000',          // sample rate exigido pelo WhatsApp
      '-ac', '1',              // mono
      tmpOut,
    ]);
    let stderr = '';
    ff.stderr.on('data', d => { stderr += d.toString(); });
    ff.on('close', code => {
      if (code !== 0) {
        reject(new Error(`ffmpeg saiu com código ${code}: ${stderr.slice(-200)}`));
        return;
      }
      try {
        const buf = fs.readFileSync(tmpOut);
        fs.unlinkSync(tmpOut);
        resolve(buf);
      } catch (e) {
        reject(e);
      }
    });
    ff.on('error', reject);
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
    mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac',
    opus: 'audio/ogg; codecs=opus',
    pdf: 'application/pdf',
  };
  const mimetype = mimeMap[ext] || 'application/octet-stream';
  const opts = caption ? { caption } : {};
  if (mimetype.startsWith('image/')) {
    await sock.sendMessage(jid, { image: buffer, mimetype, ...opts });
  } else if (mimetype.startsWith('video/')) {
    await sock.sendMessage(jid, { video: buffer, mimetype, ...opts });
  } else if (mimetype.startsWith('audio/')) {
    // WhatsApp exige OGG Opus para voice notes (PTT)
    // Converter sempre para garantir compatibilidade
    const isOgg = mimetype.includes('ogg');
    let audioBuffer = buffer;
    let finalMime = 'audio/ogg; codecs=opus';
    if (!isOgg) {
      try {
        console.log(`[sendMedia] A converter áudio (${mimetype}) para OGG Opus...`);
        audioBuffer = await convertToOggOpus(filePath);
        console.log(`[sendMedia] Conversão concluída (${audioBuffer.length} bytes)`);
      } catch (convErr) {
        console.error(`[sendMedia] Falha na conversão ffmpeg: ${convErr.message} — a enviar como documento`);
        // Fallback: enviar como documento se a conversão falhar
        await sock.sendMessage(jid, { document: buffer, mimetype, fileName: filename || path.basename(filePath) });
        return;
      }
    }
    await sock.sendMessage(jid, { audio: audioBuffer, mimetype: finalMime, ptt: true });
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
