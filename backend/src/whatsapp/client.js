/**
 * WhatsApp Manager — uma instância Baileys por linha (entrada na tabela `lines`).
 *
 * Backwards-compat com tenants single-line: a migration em app.js cria
 * automaticamente uma "Linha principal" que usa o WA_SESSION_PATH antigo,
 * por isso tenants existentes não precisam de re-scan.
 *
 * Estado é per-linha (Map lineStates). Funções públicas tomam lineId como
 * primeiro argumento; se omitido cai na default line (back-compat).
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const db = require('../db/schema');
const { computeTargetDepartment, pickLeastBusyAttendant } = require('./routing');
const { transcribeAudio } = require('./transcribe');
const push = require('../push');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

const UPLOADS_DIR = path.join(__dirname, '../../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Logger silencioso (evita poluir os logs com chatter do Baileys)
const logger = {
  level: 'silent',
  trace: () => {}, debug: () => {}, info: () => {},
  warn: () => {}, error: () => {}, fatal: () => {},
  child: () => logger,
};

const RETRY_TTL_MS = 2 * 60 * 1000;

let io = null;

// Estado per-linha. Cada entrada: { sock, isReady, qrCodeData, lidToJidMap, waContactsCache, pendingQueue }
const lineStates = new Map();

function newLineState() {
  return {
    sock: null,
    isReady: false,
    qrCodeData: null,
    lidToJidMap: new Map(),
    waContactsCache: new Map(),
    pendingQueue: new Map(),
  };
}

function getLineState(lineId) {
  if (!lineStates.has(lineId)) lineStates.set(lineId, newLineState());
  return lineStates.get(lineId);
}

function getDefaultLineId() {
  const r = db.prepare("SELECT id FROM lines WHERE is_default = 1 AND active = 1 LIMIT 1").get();
  if (r) return r.id;
  const any = db.prepare("SELECT id FROM lines WHERE active = 1 ORDER BY id ASC LIMIT 1").get();
  return any?.id ?? null;
}

function resolveLineId(lineId) {
  return lineId ?? getDefaultLineId();
}

// ─── Helpers de string / JID (independentes de linha) ────────────────────────
function getPhoneFromJid(jid) { return jid ? jid.split('@')[0] : ''; }

function sanitizeZalgo(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/(\p{M}{3,})/gu, m => m.slice(0, 2));
}

function normalizeJid(state, jid) {
  if (!jid) return null;
  if (jid.endsWith('@lid') || jid.endsWith('@c.us')) {
    const mapped = state.lidToJidMap.get(jid);
    if (mapped) return mapped;
    const lidNum = jid.split('@')[0];
    const mappedNum = state.lidToJidMap.get(`${lidNum}@lid`);
    if (mappedNum) return mappedNum;
    // Sessão em disco — Baileys grava ficheiros lid-mapping-*_reverse.json
    try {
      const sessionPath = state.sessionPath;
      if (sessionPath) {
        const reverseFile = path.join(sessionPath, `lid-mapping-${lidNum}_reverse.json`);
        if (fs.existsSync(reverseFile)) {
          const phone = JSON.parse(fs.readFileSync(reverseFile, 'utf8'));
          if (phone && typeof phone === 'string') {
            state.lidToJidMap.set(jid, `${phone}@s.whatsapp.net`);
            return `${phone}@s.whatsapp.net`;
          }
        }
      }
    } catch (_) {}
    const contact = db.prepare(`SELECT phone FROM contacts WHERE (wa_id = ? OR wa_id = ?) AND phone != ?`).get(jid, `${lidNum}@lid`, lidNum);
    if (contact?.phone) return `${contact.phone}@s.whatsapp.net`;
    return `${lidNum}@s.whatsapp.net`;
  }
  if (jid.includes('@')) return jid;
  return `${jid}@s.whatsapp.net`;
}

// ─── Retry queue (per-linha) ─────────────────────────────────────────────────
function cleanPendingQueue(state) {
  const now = Date.now();
  for (const [id, entry] of state.pendingQueue) {
    if (now - entry.sentAt > RETRY_TTL_MS) state.pendingQueue.delete(id);
  }
}

async function retryPendingMessages(state) {
  cleanPendingQueue(state);
  if (state.pendingQueue.size === 0 || !state.sock) return;
  // Snapshot — for-of num Map visita entries adicionadas durante a iteração.
  // Sem isto, cada retry bem-sucedido criaria um novo entry que voltaria
  // a ser visitado, gerando spam infinito (incidente supermercados, 2026-05).
  const snapshot = Array.from(state.pendingQueue.entries());
  console.log(`[retry] linha ${state.lineId}: ${snapshot.length} mensagem(ns) pendente(s)...`);
  for (const [id, entry] of snapshot) {
    try {
      const result = await state.sock.sendMessage(entry.jid, { text: entry.body }, entry.opts || {});
      const newId = result?.key?.id;
      if (newId) {
        db.prepare('UPDATE messages SET wa_message_id = ? WHERE wa_message_id = ?').run(newId, id);
      }
      // Remove sempre — não re-adicionar com novo id. O ACK definitivo virá
      // por messages.update, e cleanPendingQueue trata do TTL.
      state.pendingQueue.delete(id);
    } catch (err) {
      console.error(`[retry] linha ${state.lineId}: ${err.message}`);
    }
  }
}

// ─── LID merge (per-linha — varre o lidToJidMap dessa linha) ─────────────────
function runLidMerge(lineId) {
  const state = lineStates.get(resolveLineId(lineId));
  if (!state || state.lidToJidMap.size === 0) return 0;
  let merged = 0;
  for (const [lidJid, realJid] of state.lidToJidMap) {
    try {
      const lidNum = lidJid.split('@')[0];
      const realPhone = realJid.split('@')[0];
      const lidContact = db.prepare('SELECT * FROM contacts WHERE wa_id = ? OR phone = ? LIMIT 1').get(lidJid, lidNum);
      if (!lidContact) continue;
      const realContact = db.prepare('SELECT * FROM contacts WHERE (wa_id = ? OR phone = ? OR phone = ?) AND id != ? LIMIT 1')
        .get(realJid, realPhone, realPhone.replace(/^55/, ''), lidContact.id);
      if (!realContact) {
        db.prepare('UPDATE contacts SET phone = ?, wa_id = ? WHERE id = ?').run(realPhone, lidJid, lidContact.id);
        merged++;
        continue;
      }
      db.prepare('UPDATE conversations SET contact_id = ? WHERE contact_id = ?').run(realContact.id, lidContact.id);
      if (!realContact.wa_id || !realContact.wa_id.endsWith('@lid')) {
        db.prepare('UPDATE contacts SET wa_id = ? WHERE id = ?').run(lidJid, realContact.id);
      }
      db.prepare('DELETE FROM contacts WHERE id = ?').run(lidContact.id);
      merged++;
      if (io) io.emit('conversation:updated', {});
    } catch (err) {
      console.error(`[lid-merge] linha ${state.lineId}: ${err.message}`);
    }
  }
  if (merged > 0) console.log(`[lid-merge] linha ${state.lineId}: ${merged} fundidos`);
  return merged;
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────
async function startLine(lineId) {
  const line = db.prepare('SELECT * FROM lines WHERE id = ? AND active = 1').get(lineId);
  if (!line) throw new Error(`Linha ${lineId} não encontrada ou inactiva`);

  const state = getLineState(lineId);
  state.lineId = lineId;
  state.sessionPath = line.session_path;

  // Se já tem sock activo, fecha primeiro (start = restart)
  if (state.sock) {
    try { state.sock.end(undefined); } catch (_) {}
    state.sock = null;
  }

  if (!fs.existsSync(line.session_path)) fs.mkdirSync(line.session_path, { recursive: true });

  const { state: authState, saveCreds } = await useMultiFileAuthState(line.session_path);
  let version = [2, 3000, 0];
  try { const r = await fetchLatestBaileysVersion(); version = r.version; } catch (_) {}

  const sock = makeWASocket({
    version,
    auth: authState,
    printQRInTerminal: false,
    logger,
    browser: ['WhatsApp Multi-Atendente', 'Chrome', '120.0.0'],
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    retryRequestDelayMs: 2000,
    getMessage: async () => ({ conversation: '' }),
  });
  state.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  // Carregar mapeamentos LID de disco
  try {
    const files = fs.readdirSync(line.session_path).filter(f => f.startsWith('lid-mapping-') && f.endsWith('_reverse.json'));
    let count = 0;
    for (const file of files) {
      try {
        const lid = file.replace('lid-mapping-', '').replace('_reverse.json', '');
        const phone = JSON.parse(fs.readFileSync(path.join(line.session_path, file), 'utf8'));
        if (phone && typeof phone === 'string') {
          state.lidToJidMap.set(`${lid}@lid`, `${phone}@s.whatsapp.net`);
          count++;
        }
      } catch (_) {}
    }
    if (count > 0) {
      console.log(`[lid-map] linha ${lineId}: ${count} mapeamentos carregados`);
      setTimeout(() => runLidMerge(lineId), 1500);
    }
  } catch (_) {}

  sock.ev.on('contacts.upsert', (contacts) => {
    for (const c of contacts) {
      if (c.id && !c.id.endsWith('@g.us') && !c.id.endsWith('@newsletter') && c.id !== 'status@broadcast') {
        const phone = c.id.split('@')[0];
        if (/^\d+$/.test(phone)) {
          state.waContactsCache.set(phone, { phone, name: c.name || c.notify || null, wa_id: c.id });
        }
      }
      if (c.id && c.lid) {
        state.lidToJidMap.set(c.lid, c.id);
        try {
          const lidNum = c.lid.split('@')[0];
          const realPhone = c.id.split('@')[0];
          fs.writeFileSync(path.join(line.session_path, `lid-mapping-${lidNum}_reverse.json`), JSON.stringify(realPhone));
        } catch (_) {}
        try {
          const lidPhone = c.lid.split('@')[0];
          const realPhone = c.id.split('@')[0];
          const lidContact = db.prepare('SELECT * FROM contacts WHERE wa_id = ? OR phone = ? LIMIT 1').get(c.lid, lidPhone);
          const realContact = db.prepare('SELECT * FROM contacts WHERE wa_id = ? OR phone = ? OR phone = ? LIMIT 1').get(c.id, realPhone, realPhone.replace(/^55/, ''));
          if (lidContact && realContact && lidContact.id !== realContact.id) {
            db.prepare('UPDATE conversations SET contact_id = ? WHERE contact_id = ?').run(realContact.id, lidContact.id);
            if (!realContact.wa_id || realContact.wa_id === c.id) {
              db.prepare('UPDATE contacts SET wa_id = ? WHERE id = ?').run(c.lid, realContact.id);
            }
            db.prepare('DELETE FROM contacts WHERE id = ?').run(lidContact.id);
            if (io) io.emit('conversation:updated', {});
          } else if (lidContact && !realContact) {
            db.prepare('UPDATE contacts SET wa_id = ?, phone = ? WHERE id = ?').run(c.lid, realPhone, lidContact.id);
          } else if (!lidContact && realContact) {
            if (!realContact.wa_id || !realContact.wa_id.endsWith('@lid')) {
              db.prepare('UPDATE contacts SET wa_id = ? WHERE id = ?').run(c.lid, realContact.id);
            }
          }
        } catch (e) { console.error(`[lid-merge] linha ${lineId}: ${e.message}`); }
      }
    }
    setTimeout(() => runLidMerge(lineId), 500);
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      try {
        state.qrCodeData = await qrcode.toDataURL(qr);
        state.isReady = false;
        if (io) io.emit('whatsapp:qr', { line_id: lineId, qr: state.qrCodeData });
      } catch (_) {}
    }
    if (connection === 'open') {
      state.isReady = true;
      state.qrCodeData = null;
      if (io) io.emit('whatsapp:ready', { line_id: lineId });
      console.log(`[wa] linha ${lineId} (${line.name}) conectada`);
      setTimeout(() => retryPendingMessages(state), 2000);
      setTimeout(() => runLidMerge(lineId), 3000);
    }
    if (connection === 'close') {
      state.isReady = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = code === DisconnectReason.loggedOut;
      console.log(`[wa] linha ${lineId} desconectada — ${isLoggedOut ? 'LOGOUT' : code || 'desconhecido'}`);
      if (isLoggedOut && line.session_path) {
        // Sessao invalida — apagar para gerar novo QR automaticamente
        try {
          const sessionFiles = fs.readdirSync(line.session_path);
          for (const f of sessionFiles) {
            if (!f.startsWith('lid-mapping-')) fs.unlinkSync(path.join(line.session_path, f));
          }
          console.log(`[logout] sessao da linha ${lineId} limpa — aguardar novo QR`);
        } catch (e) { console.error('[logout] erro ao limpar sessao:', e.message); }
      }
      if (io) io.emit('whatsapp:disconnected', { line_id: lineId });
      setTimeout(() => { console.log(`[reconnect] linha ${lineId}...`); startLine(lineId).catch(e => console.error(e.message)); }, 3000);
    }
  });

  sock.ev.on('messages.update', (updates) => {
    for (const { key, update } of updates) {
      if (update.status >= 2 && state.pendingQueue.has(key.id)) state.pendingQueue.delete(key.id);
      if (update.message === null && key.id) handleMessageDeleted(key.id);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      const proto = msg.message?.protocolMessage;
      if (proto && proto.type === 0 && proto.key?.id) { handleMessageDeleted(proto.key.id); continue; }
      if (type !== 'notify') {
        if (!msg.key.fromMe) continue;
        const msgTs = (msg.messageTimestamp || 0) * 1000;
        if (Date.now() - msgTs > 5 * 60 * 1000) continue;
      }
      try { await handleIncomingMessage(msg, lineId); }
      catch (err) { console.error(`[message] linha ${lineId}: ${err.message}`); }
    }
  });
}

async function stopLine(lineId) {
  const state = lineStates.get(lineId);
  if (!state) return;
  state.isReady = false;
  state.qrCodeData = null;
  try { await state.sock?.logout(); } catch (_) {}
  try { state.sock?.end(undefined); } catch (_) {}
  state.sock = null;
  if (io) io.emit('whatsapp:disconnected', { line_id: lineId });
}

async function initWhatsAppManager(socketIO) {
  io = socketIO;
  const lines = db.prepare('SELECT id, name FROM lines WHERE active = 1').all();
  console.log(`[wa-manager] a iniciar ${lines.length} linha(s)`);
  for (const l of lines) {
    try { await startLine(l.id); } catch (err) { console.error(`[wa-manager] linha ${l.id} (${l.name}) falhou: ${err.message}`); }
  }
}

// ─── Mensagens recebidas (per-linha — usa state correto via lineId) ─────────
function handleMessageDeleted(waMessageId) {
  if (!waMessageId) return;
  const existing = db.prepare('SELECT id, conversation_id FROM messages WHERE wa_message_id = ?').get(waMessageId);
  if (!existing) return;
  db.prepare('UPDATE messages SET deleted = 1 WHERE id = ?').run(existing.id);
  if (io) io.emit('message:deleted', { id: existing.id, conversation_id: existing.conversation_id });
}

async function handleIncomingMessage(msg, lineId) {
  const state = getLineState(lineId);
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid) return;
  if (remoteJid === 'status@broadcast') return;
  if (remoteJid.endsWith('@g.us')) return;
  if (remoteJid.endsWith('@newsletter')) return;
  if (msg.key.fromMe) {
    const existing = db.prepare('SELECT id FROM messages WHERE wa_message_id = ?').get(msg.key.id);
    if (existing) return;
  }
  const fromMe = !!msg.key.fromMe;

  let waId = remoteJid;
  if (waId.endsWith('@lid')) {
    const realJid = state.lidToJidMap.get(waId);
    if (realJid) waId = realJid;
    else {
      const lidNum = waId.split('@')[0];
      const dbContact = db.prepare('SELECT phone FROM contacts WHERE wa_id = ? AND phone != ? AND phone != ?').get(waId, lidNum, `${lidNum}@lid`);
      if (dbContact?.phone) waId = `${dbContact.phone}@s.whatsapp.net`;
    }
  }
  const phone = getPhoneFromJid(waId);

  if (!fromMe) {
    const blocked = db.prepare('SELECT id FROM blacklist WHERE phone = ? OR phone = ? OR wa_id = ?').get(phone, phone.replace(/^55/, ''), waId);
    if (blocked) return;
  }

  const msgContent = msg.message;
  if (!msgContent) {
    if (fromMe || !msg.pushName) return;
  }
  const isViewOnce = !msgContent || !!(msgContent.viewOnceMessage || msgContent.viewOnceMessageV2 || msgContent.viewOnceMessageV2Extension);
  const content = msgContent
    ? (msgContent.ephemeralMessage?.message || msgContent.viewOnceMessage?.message || msgContent.viewOnceMessageV2?.message || msgContent.viewOnceMessageV2Extension?.message || msgContent.documentWithCaptionMessage?.message || msgContent)
    : {};

  let body = content.conversation || content.extendedTextMessage?.text || content.imageMessage?.caption || content.videoMessage?.caption || content.documentMessage?.caption || '';
  const isVcard = !!(content.contactMessage || content.contactsArrayMessage);
  if (isVcard) {
    body = content.contactMessage?.vcard || content.contactsArrayMessage?.contacts?.map(c => c.vcard).join('\n') || '';
  }
  const hasMedia = !!(content.imageMessage || content.videoMessage || content.ptvMessage || content.audioMessage || content.documentMessage || content.stickerMessage);
  if (!hasMedia && !isVcard && !body.trim() && !isViewOnce) {
    // Se nao ha msgContent (mensagem de protocolo/timing) e e de contacto, guardar placeholder
    if (!msgContent && !fromMe) {
      body = '📩 Mensagem recebida';
    } else {
      return;
    }
  }

  const pushName = msg.pushName || '';

  // Upsert contacto (igual ao antes)
  let contact = db.prepare('SELECT * FROM contacts WHERE wa_id = ?').get(waId);
  if (!contact) {
    contact = db.prepare('SELECT * FROM contacts WHERE phone = ? OR phone = ?').get(phone, phone.replace(/^55/, ''));
    if (contact) {
      if (!contact.wa_id) {
        db.prepare('UPDATE contacts SET wa_id = ? WHERE id = ?').run(waId, contact.id);
        contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contact.id);
      }
    } else if (remoteJid.endsWith('@lid')) {
      const realJidFromMap = state.lidToJidMap.get(remoteJid);
      if (realJidFromMap) {
        const realPhone = realJidFromMap.split('@')[0];
        contact = db.prepare('SELECT * FROM contacts WHERE phone = ? OR phone = ? OR wa_id = ?').get(realPhone, realPhone.replace(/^55/, ''), realJidFromMap);
        if (contact) {
          db.prepare('UPDATE contacts SET wa_id = ? WHERE id = ?').run(remoteJid, contact.id);
          contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contact.id);
        }
      }
      if (!contact) {
        if (fromMe) return;
        const name = pushName || phone;
        db.prepare('INSERT INTO contacts (phone, name, wa_id) VALUES (?, ?, ?)').run(phone, name, remoteJid);
        contact = db.prepare('SELECT * FROM contacts WHERE wa_id = ?').get(remoteJid);
        setTimeout(() => runLidMerge(lineId), 200);
      }
    } else if (fromMe) {
      return;
    } else {
      const name = pushName || phone;
      db.prepare('INSERT INTO contacts (phone, name, wa_id) VALUES (?, ?, ?)').run(phone, name, waId);
      contact = db.prepare('SELECT * FROM contacts WHERE wa_id = ?').get(waId);
      setTimeout(() => runLidMerge(lineId), 200);
    }
  }

  function shouldSendBotReply(lineId) {
    const row = db.prepare('SELECT * FROM line_bot_settings WHERE line_id = ?').get(lineId);
    if (!row || !row.enabled) return false;
    const now = new Date();
    const dayKey = `hours_${now.getDay()}`;
    const dayHours = row[dayKey];
    if (!dayHours || dayHours === 'closed') return true;
    const [start, end] = dayHours.split('-');
    const currentTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    return currentTime < start || currentTime >= end;
  }

  // Encontrar ou criar conversa — filtrada por line_id (conversas da mesma pessoa
  // em linhas diferentes são INDEPENDENTES; o cliente pode falar com Vendas E Suporte)
  let conversation = db.prepare(`SELECT * FROM conversations WHERE contact_id = ? AND line_id = ? AND status != 'closed' ORDER BY id DESC LIMIT 1`).get(contact.id, lineId);

  if (!conversation && !fromMe) {
    const recentOutbound = db.prepare(`
      SELECT conv.* FROM conversations conv
      JOIN messages m ON m.conversation_id = conv.id AND m.from_me = 1 AND (m.is_internal IS NULL OR m.is_internal = 0)
      WHERE conv.contact_id = ? AND conv.line_id = ? AND conv.status = 'closed'
        AND conv.awaiting_rating = 0
        AND conv.updated_at >= datetime('now', '-2 minutes')
      ORDER BY conv.id DESC LIMIT 1
    `).get(contact.id, lineId);
    if (recentOutbound) {
      db.prepare(`UPDATE conversations SET status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(recentOutbound.id);
      conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(recentOutbound.id);
    }
  }

  if (!conversation) {
    if (fromMe) return;
    if (body && body.trim()) {
      const ratingConv = db.prepare("SELECT * FROM conversations WHERE contact_id = ? AND line_id = ? AND status = 'closed' AND awaiting_rating = 1 ORDER BY id DESC LIMIT 1").get(contact.id, lineId);
      if (ratingConv) {
        const score = parseInt(body.trim(), 10);
        if (score >= 1 && score <= 5) {
          try {
            db.prepare('INSERT OR IGNORE INTO ratings (conversation_id, contact_id, attendant_id, score) VALUES (?, ?, ?, ?)').run(ratingConv.id, ratingConv.contact_id, ratingConv.assigned_to, score);
            db.prepare('UPDATE conversations SET awaiting_rating = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(ratingConv.id);
            const inWaId = msg.key.id || null;
            if (inWaId) {
              const dup = db.prepare('SELECT id FROM messages WHERE wa_message_id = ?').get(inWaId);
              if (!dup) db.prepare('INSERT INTO messages (conversation_id, from_me, body, wa_message_id) VALUES (?, 0, ?, ?)').run(ratingConv.id, sanitizeZalgo(body), inWaId);
            }
            if (io) io.emit('message:new', {
              message: db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(ratingConv.id),
              conversation: getConversationWithContact(ratingConv.id),
            });
          } catch (err) { console.error('[rating]', err.message); }
          return;
        } else {
          // Resposta nao numerica — guardar msg e fechar awaiting_rating sem reabrir
          try {
            const inWaId2 = msg.key.id || null;
            if (inWaId2) {
              const dup2 = db.prepare('SELECT id FROM messages WHERE wa_message_id = ?').get(inWaId2);
              if (!dup2) db.prepare('INSERT INTO messages (conversation_id, from_me, body, wa_message_id) VALUES (?, 0, ?, ?)').run(ratingConv.id, sanitizeZalgo(body), inWaId2);
            }
            db.prepare('UPDATE conversations SET awaiting_rating = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(ratingConv.id);
            if (io) io.emit('message:new', { message: db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(ratingConv.id), conversation: getConversationWithContact(ratingConv.id) });
          } catch (err) { console.error('[rating-fallback]', err.message); }
          return;
        }
      }
    }

    // Reabertura inteligente
    const reopenDays = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'reopen_window_days'").get()?.value ?? '1', 10);
    let closedToReopen = null;
    if (reopenDays > 0) {
      const windowExpr = reopenDays >= 9999 ? '1=1' : `updated_at >= datetime('now', '-${reopenDays} days')`;
      closedToReopen = db.prepare(`SELECT * FROM conversations WHERE contact_id = ? AND line_id = ? AND status = 'closed' AND ${windowExpr} ORDER BY id DESC LIMIT 1`).get(contact.id, lineId);
    }

    let reopened = false;
    let keptAttendant = false;
    if (closedToReopen) {
      const prevAttendant = closedToReopen.assigned_to ? db.prepare('SELECT id, name, status, active, on_shift FROM users WHERE id = ?').get(closedToReopen.assigned_to) : null;
      const prevAvailable = prevAttendant && prevAttendant.active && prevAttendant.status !== 'offline';
      if (prevAvailable) {
        db.prepare(`UPDATE conversations SET status = 'open', awaiting_rating = 0, snoozed_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(closedToReopen.id);
        conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(closedToReopen.id);
        keptAttendant = true;
        if (io) io.to(`user:${prevAttendant.id}`).emit('conversation:reopened', { conversation_id: closedToReopen.id, contact_name: contact.name || contact.phone });
      } else {
        db.prepare(`UPDATE conversations SET status = 'waiting', assigned_to = NULL, awaiting_rating = 0, snoozed_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(closedToReopen.id);
        conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(closedToReopen.id);
      }
      reopened = true;
    } else {
      const targetDeptId = computeTargetDepartment(body, lineId);
      try {
        db.prepare(`INSERT INTO conversations (contact_id, status, department_id, line_id) VALUES (?, 'waiting', ?, ?)`).run(contact.id, targetDeptId, lineId);
      } catch (constraintErr) {
        // UNIQUE constraint: ja existe conversa nao-fechada para este contact+line, reutilizar
        console.warn('[inbound] UNIQUE constraint ao criar conversa, reutilizando existente.');
      }
      conversation = db.prepare(`SELECT * FROM conversations WHERE contact_id = ? AND line_id = ? AND status != 'closed' ORDER BY id DESC LIMIT 1`).get(contact.id, lineId);
      if (!conversation) {
        console.error('[inbound] Nao consegui criar nem encontrar conversa para contact', contact.id, 'line', lineId);
        return;
      }
    }

    if (!keptAttendant && (!reopened || !conversation.assigned_to)) {
      const attendant = pickLeastBusyAttendant(conversation.department_id);
      if (attendant) {
        db.prepare(`UPDATE conversations SET assigned_to = ?, status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(attendant.id, conversation.id);
        conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversation.id);
        const sigEnabled = !reopened && db.prepare("SELECT value FROM settings WHERE key = 'signature_enabled'").get()?.value === '1';
        if (sigEnabled) {
          const sigTemplate = db.prepare("SELECT value FROM settings WHERE key = 'signature_message'").get()?.value || '';
          const attendantUser = db.prepare('SELECT name FROM users WHERE id = ?').get(attendant.id);
          const sigBody = sigTemplate.replace(/\{\{nome\}\}/gi, attendantUser?.name || '').trim();
          if (sigBody) {
            try {
              const sigWaId = await sendMessage(lineId, waId, sigBody);
              db.prepare('INSERT INTO messages (conversation_id, from_me, body, wa_message_id) VALUES (?, 1, ?, ?)').run(conversation.id, sigBody, sigWaId || null);
            } catch (err) { console.error('[signature]', err.message); }
          }
        }
      }
    }
  }

  // Media
  let mediaUrl = null, mediaType = null, mediaFilename = null;
  if (isVcard) mediaType = 'vcard';
  else if (hasMedia) {
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      if (buffer) {
        const imgMsg = content.imageMessage;
        const vidMsg = content.videoMessage || content.ptvMessage;
        const audMsg = content.audioMessage;
        const docMsg = content.documentMessage;
        const stkMsg = content.stickerMessage;
        const mimetype = imgMsg?.mimetype || vidMsg?.mimetype || audMsg?.mimetype || docMsg?.mimetype || stkMsg?.mimetype || 'application/octet-stream';
        const origName = docMsg?.fileName || null;
        const ext = mimetype.split('/')[1]?.split(';')[0] || 'bin';
        const filename = origName || `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
        mediaUrl = `/uploads/${filename}`;
        mediaType = mimetype;
        mediaFilename = origName || null;
      }
    } catch (err) { console.error('[media]', err.message); }
  }

  if (hasMedia && !mediaUrl && !body.trim()) {
    const vType = content.imageMessage ? '📷 Imagem' : (content.videoMessage || content.ptvMessage) ? '🎥 Vídeo' : content.audioMessage ? '🎤 Áudio' : content.stickerMessage ? '🪄 Sticker' : '📎 Ficheiro';
    body = isViewOnce ? `${vType} de visualização única` : fromMe ? `${vType} enviada do telemóvel` : vType;
  }
  if (isViewOnce && !mediaUrl && !body.trim()) {
    // Mensagem sainte (fromMe) sem corpo e sem media é um eco mal parseado da plataforma
    // (acontece quando o chat tem mensagens temporárias e o wa_message_id não foi gravado).
    // Descartar em vez de guardar o sentinela errado na DB.
    if (fromMe) return;
    body = '🔒 Mensagem de visualização única';
  }

  // Bot de triagem
  if (!fromMe) {
    const existingMsgs = db.prepare('SELECT COUNT(*) as c FROM messages WHERE conversation_id = ?').get(conversation.id).c;
    if (existingMsgs === 0 && shouldSendBotReply(lineId)) {
      const botMsg = db.prepare('SELECT message FROM line_bot_settings WHERE line_id = ?').get(lineId)?.message;
      if (botMsg) {
        try { await sendMessage(lineId, waId, botMsg); } catch (_) {}
        db.prepare('INSERT INTO messages (conversation_id, from_me, body) VALUES (?, 1, ?)').run(conversation.id, botMsg);
      }
    }
  }

  // reply_to
  let replyToId = null;
  const contextInfo = content.extendedTextMessage?.contextInfo || content.imageMessage?.contextInfo || content.videoMessage?.contextInfo || content.documentMessage?.contextInfo || content.audioMessage?.contextInfo;
  if (contextInfo?.stanzaId) {
    const quoted = db.prepare('SELECT id FROM messages WHERE wa_message_id = ?').get(contextInfo.stanzaId);
    replyToId = quoted?.id || null;
  }

  const incomingWaId = msg.key.id || null;
  if (incomingWaId) {
    const existing = db.prepare('SELECT id FROM messages WHERE wa_message_id = ?').get(incomingWaId);
    if (existing) return;
  }
  const safeBody = sanitizeZalgo(body || '');
  const insRes = db.prepare('INSERT INTO messages (conversation_id, from_me, body, media_url, media_type, media_filename, reply_to_id, wa_message_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(conversation.id, fromMe ? 1 : 0, safeBody, mediaUrl, mediaType, mediaFilename, replyToId, incomingWaId);
  db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversation.id);

  if (!fromMe && mediaUrl && mediaType?.startsWith('audio/')) {
    const filename = mediaUrl.split('/').pop();
    const absPath = path.join(UPLOADS_DIR, filename);
    transcribeAudio(absPath, insRes.lastInsertRowid).catch(err => console.error('[transcribe]', err.message));
  }

  const message = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(conversation.id);
  const fullConversation = getConversationWithContact(conversation.id);

  if (io) {
    io.emit('message:new', { message, conversation: fullConversation });
    if (!fromMe && conversation.assigned_to) {
      io.to(`user:${conversation.assigned_to}`).emit('message:incoming', { message, conversation: fullConversation });
      push.sendToUser(conversation.assigned_to, {
        title: fullConversation.contact_name || fullConversation.phone || 'Nova mensagem',
        body: safeBody || (mediaType?.startsWith('image/') ? '📷 Imagem' : mediaType?.startsWith('audio/') ? '🎤 Áudio' : mediaType?.startsWith('video/') ? '🎥 Vídeo' : mediaType ? '📎 Ficheiro' : 'Mensagem nova'),
        tag: `conv-${conversation.id}`,
        url: `/?conv=${conversation.id}`,
      });
    }
  }

  if (!fromMe && body && conversation.awaiting_rating) {
    const score = parseInt(body.trim(), 10);
    if (score >= 1 && score <= 5) {
      try {
        db.prepare('INSERT INTO ratings (conversation_id, contact_id, attendant_id, score) VALUES (?, ?, ?, ?)').run(conversation.id, conversation.contact_id, conversation.assigned_to, score);
        db.prepare('UPDATE conversations SET awaiting_rating = 0 WHERE id = ?').run(conversation.id);
      } catch (err) { console.error('[rating]', err.message); }
    }
  }

  // Bot por palavra-chave + auto-tag
  if (!fromMe && body && body.trim()) {
    const rules = db.prepare('SELECT * FROM keyword_rules WHERE active = 1 ORDER BY priority ASC, id ASC').all();
    const lowerBody = body.toLowerCase();
    let responseSent = false;
    const appliedTags = new Set();
    for (const rule of rules) {
      if (!rule.keyword || !lowerBody.includes(rule.keyword.toLowerCase())) continue;
      if (rule.tag_id && !appliedTags.has(rule.tag_id)) {
        try {
          db.prepare('INSERT OR IGNORE INTO conversation_tags (conversation_id, tag_id) VALUES (?, ?)').run(conversation.id, rule.tag_id);
          appliedTags.add(rule.tag_id);
        } catch (err) { console.error('[keyword-bot tag]', err.message); }
      }
      if (!responseSent && rule.response && rule.response.trim()) {
        try {
          const responseBody = rule.response.trim();
          const waMessageId = await sendMessage(lineId, waId, responseBody);
          db.prepare('INSERT INTO messages (conversation_id, from_me, body, wa_message_id) VALUES (?, 1, ?, ?)').run(conversation.id, responseBody, waMessageId || null);
          db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversation.id);
          const botMsg = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(conversation.id);
          if (io) io.emit('message:new', { message: botMsg, conversation: getConversationWithContact(conversation.id) });
          responseSent = true;
        } catch (err) { console.error('[keyword-bot]', err.message); }
      }
    }
    if (appliedTags.size > 0 && io) {
      const tags = db.prepare(`SELECT t.id, t.name, t.color FROM tags t INNER JOIN conversation_tags ct ON ct.tag_id = t.id WHERE ct.conversation_id = ?`).all(conversation.id);
      io.emit('conversation:tags_updated', { conversation_id: conversation.id, tags });
    }
  }
}

// ─── Envio (per-linha) ───────────────────────────────────────────────────────
async function sendMessage(lineId, phone, body, { quotedWaId } = {}) {
  const state = lineStates.get(resolveLineId(lineId));
  if (!state?.isReady || !state.sock) throw new Error('WhatsApp não está conectado nesta linha');
  const jid = normalizeJid(state, phone);
  const opts = {};
  if (quotedWaId) {
    const quotedMsg = db.prepare('SELECT wa_message_id, from_me FROM messages WHERE wa_message_id = ?').get(quotedWaId);
    opts.quoted = { key: { id: quotedWaId, fromMe: !!(quotedMsg?.from_me), remoteJid: jid }, message: { conversation: '' } };
  }
  const result = await state.sock.sendMessage(jid, { text: body }, opts);
  const msgId = result?.key?.id || null;
  if (msgId) state.pendingQueue.set(msgId, { jid, body, opts, sentAt: Date.now() });
  return msgId;
}

async function editMessage(lineId, waMessageId, newBody) {
  const state = lineStates.get(resolveLineId(lineId));
  if (!state?.isReady || !state.sock) throw new Error('WhatsApp não está conectado nesta linha');
  const msgInDb = db.prepare(`SELECT m.wa_message_id, con.wa_id, con.phone FROM messages m JOIN conversations conv ON conv.id = m.conversation_id JOIN contacts con ON con.id = conv.contact_id WHERE m.wa_message_id = ? AND m.from_me = 1`).get(waMessageId);
  if (!msgInDb) throw new Error('Mensagem não encontrada');
  const jid = normalizeJid(state, msgInDb.wa_id || msgInDb.phone);
  await state.sock.sendMessage(jid, { text: newBody, edit: { id: waMessageId, fromMe: true, remoteJid: jid } });
}

// Apagar mensagem ("Apagar para todos" no WhatsApp). Substitui no telemóvel
// do destinatário por "Esta mensagem foi apagada".
async function deleteMessageForAll(lineId, waMessageId) {
  const state = lineStates.get(resolveLineId(lineId));
  if (!state?.isReady || !state.sock) throw new Error('WhatsApp não está conectado nesta linha');
  const msgInDb = db.prepare(`SELECT m.wa_message_id, con.wa_id, con.phone FROM messages m JOIN conversations conv ON conv.id = m.conversation_id JOIN contacts con ON con.id = conv.contact_id WHERE m.wa_message_id = ? AND m.from_me = 1`).get(waMessageId);
  if (!msgInDb) throw new Error('Mensagem não encontrada');
  const jid = normalizeJid(state, msgInDb.wa_id || msgInDb.phone);
  await state.sock.sendMessage(jid, { delete: { id: waMessageId, fromMe: true, remoteJid: jid } });
}

function convertToOggOpus(inputPath) {
  return new Promise((resolve, reject) => {
    const tmpOut = path.join(os.tmpdir(), `wa-audio-${Date.now()}.ogg`);
    const ff = spawn('ffmpeg', ['-y', '-i', inputPath, '-vn', '-c:a', 'libopus', '-b:a', '64k', '-ar', '48000', '-ac', '1', tmpOut]);
    let stderr = '';
    ff.stderr.on('data', d => stderr += d.toString());
    ff.on('close', code => {
      if (code !== 0) return reject(new Error(`ffmpeg ${code}: ${stderr.slice(-200)}`));
      try { const buf = fs.readFileSync(tmpOut); fs.unlinkSync(tmpOut); resolve(buf); }
      catch (e) { reject(e); }
    });
    ff.on('error', reject);
  });
}

async function sendMedia(lineId, phone, filePath, filename, caption) {
  const state = lineStates.get(resolveLineId(lineId));
  if (!state?.isReady || !state.sock) throw new Error('WhatsApp não está conectado nesta linha');
  const jid = normalizeJid(state, phone);
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filename || filePath).toLowerCase().replace('.', '');
  const mimeMap = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    mp4: 'video/mp4', mov: 'video/quicktime',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/ogg; codecs=opus',
    pdf: 'application/pdf',
  };
  const mimetype = mimeMap[ext] || 'application/octet-stream';
  const opts = caption ? { caption } : {};
  let result;
  if (mimetype.startsWith('image/')) result = await state.sock.sendMessage(jid, { image: buffer, mimetype, ...opts });
  else if (mimetype.startsWith('video/')) result = await state.sock.sendMessage(jid, { video: buffer, mimetype, ...opts });
  else if (mimetype.startsWith('audio/')) {
    const isOgg = mimetype.includes('ogg');
    let audioBuffer = buffer;
    if (!isOgg) {
      try { audioBuffer = await convertToOggOpus(filePath); }
      catch (convErr) {
        console.error(`[sendMedia] ffmpeg falhou: ${convErr.message} — enviando como documento`);
        result = await state.sock.sendMessage(jid, { document: buffer, mimetype, fileName: filename || path.basename(filePath) });
        return result?.key?.id || null;
      }
    }
    result = await state.sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
  } else {
    result = await state.sock.sendMessage(jid, { document: buffer, mimetype, fileName: filename || path.basename(filePath), ...opts });
  }
  return result?.key?.id || null;
}

// ─── Status / disconnect / utils ─────────────────────────────────────────────
async function disconnectWhatsApp(lineId) {
  return stopLine(resolveLineId(lineId));
}

function getStatus(lineId) {
  const id = resolveLineId(lineId);
  const state = lineStates.get(id);
  if (!state) return { line_id: id, isReady: false, hasQr: false, qrCode: null };
  return { line_id: id, isReady: state.isReady, hasQr: !!state.qrCodeData, qrCode: state.qrCodeData };
}

function getAllStatuses() {
  return db.prepare('SELECT id FROM lines WHERE active = 1').all().map(({ id }) => getStatus(id));
}

function getConversationWithContact(conversationId) {
  return db.prepare(`
    SELECT conv.*, con.phone, con.name as contact_name, con.email as contact_email,
           con.notes as contact_notes, con.id as contact_id, u.name as attendant_name,
           d.name as department_name, d.color as department_color,
           l.name as line_name, l.color as line_color
    FROM conversations conv
    JOIN contacts con ON con.id = conv.contact_id
    LEFT JOIN users u ON u.id = conv.assigned_to
    LEFT JOIN departments d ON d.id = conv.department_id
    LEFT JOIN lines l ON l.id = conv.line_id
    WHERE conv.id = ?
  `).get(conversationId);
}

function getWAContacts(lineId) {
  const state = lineStates.get(resolveLineId(lineId));
  if (!state) return [];
  return Array.from(state.waContactsCache.values())
    .filter(c => c.phone && /^\d{6,}$/.test(c.phone))
    .sort((a, b) => (a.name || a.phone).localeCompare(b.name || b.phone, 'pt-BR'));
}

module.exports = {
  initWhatsAppManager,
  initWhatsApp: initWhatsAppManager, // back-compat alias
  startLine,
  stopLine,
  sendMessage,
  sendMedia,
  editMessage,
  deleteMessageForAll,
  getStatus,
  getAllStatuses,
  disconnectWhatsApp,
  getWAContacts,
  runLidMerge,
  getDefaultLineId,
};
