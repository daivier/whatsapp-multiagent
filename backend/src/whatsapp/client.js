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

// Cache de contactos da agenda do WhatsApp (populado pelo contacts.upsert)
// Chave: phone normalizado; Valor: { phone, name, wa_id }
const waContactsCache = new Map();

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

/**
 * Varre todo o mapa lidToJidMap e funde contactos LID duplicados com o contacto real.
 * Chamado: no arranque, após contacts.upsert, após criar novo contacto, ao reconectar.
 */
function runLidMerge() {
  if (lidToJidMap.size === 0) return 0;
  let merged = 0;
  for (const [lidJid, realJid] of lidToJidMap) {
    try {
      const lidNum = lidJid.split('@')[0];
      const realPhone = realJid.split('@')[0];

      // Contacto criado com número LID como phone (ou com wa_id = LID)
      const lidContact = db.prepare(
        'SELECT * FROM contacts WHERE wa_id = ? OR phone = ? LIMIT 1'
      ).get(lidJid, lidNum);

      if (!lidContact) continue; // Não há contacto LID — nada a fundir

      // Contacto real (pelo número real, sem prefixo 55 ou com, ou pelo wa_id real)
      const realContact = db.prepare(
        'SELECT * FROM contacts WHERE (wa_id = ? OR phone = ? OR phone = ?) AND id != ? LIMIT 1'
      ).get(realJid, realPhone, realPhone.replace(/^55/, ''), lidContact.id);

      if (!realContact) {
        // Só existe o contacto LID → actualizar phone para o real
        db.prepare('UPDATE contacts SET phone = ?, wa_id = ? WHERE id = ?')
          .run(realPhone, lidJid, lidContact.id);
        console.log(`[lid-merge-scan] Contacto LID ${lidContact.id} actualizado: phone ${lidNum} → ${realPhone}`);
        merged++;
        continue;
      }

      // Ambos existem → fundir: mover conversas + apagar LID
      db.prepare('UPDATE conversations SET contact_id = ? WHERE contact_id = ?')
        .run(realContact.id, lidContact.id);
      // Garantir que o contacto real tem o wa_id LID para routing futuro
      if (!realContact.wa_id || !realContact.wa_id.endsWith('@lid')) {
        db.prepare('UPDATE contacts SET wa_id = ? WHERE id = ?').run(lidJid, realContact.id);
      }
      db.prepare('DELETE FROM contacts WHERE id = ?').run(lidContact.id);
      console.log(`[lid-merge-scan] Fundido: LID ${lidNum} (contact ${lidContact.id}) → ${realPhone} (contact ${realContact.id})`);
      merged++;
      if (io) io.emit('conversation:updated', {});
    } catch (err) {
      console.error(`[lid-merge-scan] Erro ao fundir ${lidJid}:`, err.message);
    }
  }
  if (merged > 0) console.log(`[lid-merge-scan] Total fundidos: ${merged}`);
  return merged;
}

// Remove caracteres Zalgo (combinações excessivas de diacríticos Unicode)
// Mantém no máximo 2 combining marks consecutivos (suficiente para texto legítimo)
function sanitizeZalgo(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/(\p{M}{3,})/gu, m => m.slice(0, 2));
}

function normalizeJid(jid) {
  if (!jid) return null;
  // Se é um LID (@lid ou número identificado como LID na BD), resolver para o número real
  if (jid.endsWith('@lid') || jid.endsWith('@c.us')) {
    // 1. Consultar mapa em memória (mais fiável — populado na sessão)
    const mapped = lidToJidMap.get(jid);
    if (mapped) return mapped;

    const lidNum = jid.split('@')[0];

    // 2. Tentar também pelo número sem sufixo
    const mappedNum = lidToJidMap.get(`${lidNum}@lid`);
    if (mappedNum) return mappedNum;

    // 3. Tentar nos ficheiros de sessão directamente
    try {
      const sessionPath = process.env.WA_SESSION_PATH || './baileys-session';
      const reverseFile = require('path').join(sessionPath, `lid-mapping-${lidNum}_reverse.json`);
      if (require('fs').existsSync(reverseFile)) {
        const phone = JSON.parse(require('fs').readFileSync(reverseFile, 'utf8'));
        if (phone && typeof phone === 'string') {
          lidToJidMap.set(jid, `${phone}@s.whatsapp.net`);
          return `${phone}@s.whatsapp.net`;
        }
      }
    } catch (_) {}

    // 4. Fallback: procurar na BD um contacto cujo phone seja diferente do LID
    const contact = db.prepare(`
      SELECT phone FROM contacts
      WHERE (wa_id = ? OR wa_id = ?) AND phone != ?
    `).get(jid, `${lidNum}@lid`, lidNum);
    if (contact?.phone) return `${contact.phone}@s.whatsapp.net`;

    // 5. Último recurso: usar o número do LID directamente
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
    if (count > 0) {
      console.log(`[lid-map] ${count} mapeamentos LID→JID carregados da sessão`);
      // Fundir duplicados que possam existir da sessão anterior
      setTimeout(runLidMerge, 1500);
    }
  } catch (_) {}

  // Actualizar mapa quando chegam novos contactos + fundir duplicados LID
  sock.ev.on('contacts.upsert', (contacts) => {
    for (const c of contacts) {
      // Guardar na cache de contactos WA (apenas contactos reais, não grupos/broadcasts)
      if (c.id && !c.id.endsWith('@g.us') && !c.id.endsWith('@newsletter') && c.id !== 'status@broadcast') {
        const phone = c.id.split('@')[0];
        if (/^\d+$/.test(phone)) {
          waContactsCache.set(phone, {
            phone,
            name: c.name || c.notify || null,
            wa_id: c.id,
          });
        }
      }

      if (c.id && c.lid) {
        lidToJidMap.set(c.lid, c.id);
        console.log(`[lid-map] novo: ${c.lid} → ${c.id}`);

        // Gravar mapeamento em disco para sobreviver a reinícios do processo
        try {
          const lidNum = c.lid.split('@')[0];
          const realPhone = c.id.split('@')[0];
          const sp = process.env.WA_SESSION_PATH || './baileys-session';
          fs.writeFileSync(
            path.join(sp, `lid-mapping-${lidNum}_reverse.json`),
            JSON.stringify(realPhone)
          );
        } catch (_) {}

        // Tentar fundir contacto LID com contacto real para eliminar duplicados
        try {
          const lidPhone = c.lid.split('@')[0];
          const realPhone = c.id.split('@')[0];

          // Contacto criado com o LID (phone = lidPhone ou wa_id = c.lid)
          const lidContact = db.prepare(
            'SELECT * FROM contacts WHERE wa_id = ? OR phone = ? LIMIT 1'
          ).get(c.lid, lidPhone);

          // Contacto real (phone = realPhone ou wa_id = c.id)
          const realContact = db.prepare(
            'SELECT * FROM contacts WHERE wa_id = ? OR phone = ? OR phone = ? LIMIT 1'
          ).get(c.id, realPhone, realPhone.replace(/^55/, ''));

          if (lidContact && realContact && lidContact.id !== realContact.id) {
            // Mover todas as conversas do contacto LID para o contacto real
            db.prepare('UPDATE conversations SET contact_id = ? WHERE contact_id = ?')
              .run(realContact.id, lidContact.id);
            // Garantir que o contacto real tem o wa_id LID correcto
            if (!realContact.wa_id || realContact.wa_id === c.id) {
              db.prepare('UPDATE contacts SET wa_id = ? WHERE id = ?').run(c.lid, realContact.id);
            }
            // Eliminar contacto LID duplicado
            db.prepare('DELETE FROM contacts WHERE id = ?').run(lidContact.id);
            console.log(`[lid-merge] Contacto LID ${lidContact.id} (${lidPhone}) fundido com real ${realContact.id} (${realPhone})`);
            if (io) io.emit('conversation:updated', {}); // forçar refresh na UI
          } else if (lidContact && !realContact) {
            // Actualizar contacto LID com o número real
            db.prepare('UPDATE contacts SET wa_id = ?, phone = ? WHERE id = ?')
              .run(c.lid, realPhone, lidContact.id);
            console.log(`[lid-merge] Contacto LID ${lidContact.id} actualizado para ${realPhone}`);
          } else if (!lidContact && realContact) {
            // Contacto real existe mas wa_id ainda não é LID → actualizar
            // Isto garante que mensagens vindas com LID encontram este contacto via BD
            if (!realContact.wa_id || !realContact.wa_id.endsWith('@lid')) {
              db.prepare('UPDATE contacts SET wa_id = ? WHERE id = ?').run(c.lid, realContact.id);
              console.log(`[lid-merge] Contacto real ${realContact.id} (${realPhone}) actualizado com LID ${c.lid}`);
            }
          }
        } catch (mergeErr) {
          console.error('[lid-merge] Erro ao fundir:', mergeErr.message);
        }
      }
    }
    // Após processar todos os contactos upsert, varrer mapa completo para apanhar casos tardios
    setTimeout(runLidMerge, 500);
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
      // Varrer mapa LID e fundir quaisquer duplicados
      setTimeout(runLidMerge, 3000);
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
  // Também detetar mensagens apagadas via messages.update
  sock.ev.on('messages.update', (updates) => {
    for (const { key, update } of updates) {
      if (update.status >= 2 && pendingQueue.has(key.id)) {
        pendingQueue.delete(key.id);
      }
      // Mensagem apagada: message passa a null
      if (update.message === null && key.id) {
        handleMessageDeleted(key.id);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      // Detetar apagamento via protocolMessage (type 0 = REVOKE = apagar para todos)
      const proto = msg.message?.protocolMessage;
      if (proto && proto.type === 0 && proto.key?.id) {
        handleMessageDeleted(proto.key.id);
        continue;
      }

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

function handleMessageDeleted(waMessageId) {
  if (!waMessageId) return;
  const existing = db.prepare('SELECT id, conversation_id FROM messages WHERE wa_message_id = ?').get(waMessageId);
  if (!existing) return;
  db.prepare('UPDATE messages SET deleted = 1 WHERE id = ?').run(existing.id);
  if (io) {
    io.emit('message:deleted', { id: existing.id, conversation_id: existing.conversation_id });
  }
  console.log(`[msg] Mensagem ${existing.id} (wa: ${waMessageId}) marcada como apagada`);
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
      const dbContact = db.prepare('SELECT phone FROM contacts WHERE wa_id = ? AND phone != ? AND phone != ?').get(waId, lidNum, `${lidNum}@lid`);
      if (dbContact?.phone) {
        waId = `${dbContact.phone}@s.whatsapp.net`;
        console.log(`[lid] ${remoteJid} → ${waId} (via BD)`);
      }
    }
  }
  const phone = getPhoneFromJid(waId);

  // Verificar blacklist — ignorar silenciosamente mensagens de números bloqueados
  if (!fromMe) {
    const blocked = db.prepare('SELECT id FROM blacklist WHERE phone = ? OR phone = ? OR wa_id = ?')
      .get(phone, phone.replace(/^55/, ''), waId);
    if (blocked) {
      console.log(`[blacklist] Mensagem ignorada de ${phone} (bloqueado)`);
      return;
    }
  }

  const msgContent = msg.message;

  // Mensagem com conteúdo nulo — Baileys apaga o conteúdo de mensagens view-once
  // por razões de privacidade. Tratar como mensagem de visualização única.
  if (!msgContent) {
    if (fromMe || !msg.pushName) return; // Sem remetente identificado → ignorar
    // Continuar com placeholder view-once (conteúdo/media indisponível)
  }

  // Detetar view-once — formato legado (viewOnceMessage wrapper) ou conteúdo nulo
  const isViewOnce = !msgContent || !!(msgContent.viewOnceMessage || msgContent.viewOnceMessageV2 || msgContent.viewOnceMessageV2Extension);

  // Desembrulhar mensagens efémeras/viewonce (quando há conteúdo)
  const content = msgContent
    ? (msgContent.ephemeralMessage?.message
        || msgContent.viewOnceMessage?.message
        || msgContent.viewOnceMessageV2?.message
        || msgContent.viewOnceMessageV2Extension?.message
        || msgContent)
    : {};

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

  // Media (ptvMessage = recado de vídeo circular)
  const hasMedia = !!(content.imageMessage || content.videoMessage || content.ptvMessage
    || content.audioMessage || content.documentMessage || content.stickerMessage);

  // Nunca ignorar mensagens view-once mesmo sem body/media detectados após unwrap
  if (!hasMedia && !isVcard && !body.trim() && !isViewOnce) return;

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
    } else if (remoteJid.endsWith('@lid')) {
      // Mensagem LID sem contacto encontrado — tentar via mapa reverso
      // Se o mapa já conhece o número real para este LID, usar esse contacto
      const realJidFromMap = lidToJidMap.get(remoteJid);
      if (realJidFromMap) {
        const realPhone = realJidFromMap.split('@')[0];
        contact = db.prepare('SELECT * FROM contacts WHERE phone = ? OR phone = ? OR wa_id = ?')
          .get(realPhone, realPhone.replace(/^55/, ''), realJidFromMap);
        if (contact) {
          // Actualizar wa_id para o LID para matching futuro
          db.prepare('UPDATE contacts SET wa_id = ? WHERE id = ?').run(remoteJid, contact.id);
          contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contact.id);
          console.log(`[lid] Contacto real encontrado via mapa: ${remoteJid} → ${contact.phone}`);
        }
      }
      // Se ainda não encontrado, criar novo (LID sem mapeamento conhecido)
      if (!contact) {
        if (fromMe) return;
        const name = pushName || phone;
        db.prepare('INSERT INTO contacts (phone, name, wa_id) VALUES (?, ?, ?)').run(phone, name, remoteJid);
        contact = db.prepare('SELECT * FROM contacts WHERE wa_id = ?').get(remoteJid);
        // Varrer mapa após criar — se entretanto o mapeamento chegou, fundir imediatamente
        setTimeout(runLidMerge, 200);
      }
    } else if (fromMe) {
      return;
    } else {
      const name = pushName || phone;
      db.prepare('INSERT INTO contacts (phone, name, wa_id) VALUES (?, ?, ?)').run(phone, name, waId);
      contact = db.prepare('SELECT * FROM contacts WHERE wa_id = ?').get(waId);
      // Varrer mapa após criar novo contacto — apanhar LID pendente
      setTimeout(runLidMerge, 200);
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

  // Guardar contra race condition outbound+inbound simultâneos:
  // se não há conversa aberta mas foi criada uma nos últimos 2 minutos (outbound do atendente),
  // usar essa em vez de criar uma nova
  if (!conversation && !fromMe) {
    const recentOutbound = db.prepare(`
      SELECT conv.* FROM conversations conv
      JOIN messages m ON m.conversation_id = conv.id AND m.from_me = 1
      WHERE conv.contact_id = ? AND conv.status = 'closed'
        AND conv.updated_at >= datetime('now', '-2 minutes')
      ORDER BY conv.id DESC LIMIT 1
    `).get(contact.id);
    if (recentOutbound) {
      // Reabrir a conversa recente e usá-la para esta mensagem inbound
      db.prepare(`UPDATE conversations SET status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(recentOutbound.id);
      conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(recentOutbound.id);
      console.log(`[conv] Conversa recente ${recentOutbound.id} reaberta para inbound de ${phone} (race condition outbound)`);
    }
  }

  if (!conversation) {
    if (fromMe) {
      return;
    } else {
      // Verificar se é resposta de avaliação — NÃO reabrir nesse caso
      if (body && body.trim()) {
        const ratingConv = db.prepare(
          "SELECT * FROM conversations WHERE contact_id = ? AND status = 'closed' AND awaiting_rating = 1 ORDER BY id DESC LIMIT 1"
        ).get(contact.id);
        if (ratingConv) {
          const score = parseInt(body.trim(), 10);
          if (score >= 1 && score <= 5) {
            try {
              db.prepare('INSERT OR IGNORE INTO ratings (conversation_id, contact_id, attendant_id, score) VALUES (?, ?, ?, ?)')
                .run(ratingConv.id, ratingConv.contact_id, ratingConv.assigned_to, score);
              db.prepare('UPDATE conversations SET awaiting_rating = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(ratingConv.id);
              // Guardar a mensagem na conversa fechada (para histórico)
              const inWaId = msg.key.id || null;
              if (inWaId) {
                const dup = db.prepare('SELECT id FROM messages WHERE wa_message_id = ?').get(inWaId);
                if (!dup) {
                  db.prepare('INSERT INTO messages (conversation_id, from_me, body, wa_message_id) VALUES (?, 0, ?, ?)')
                    .run(ratingConv.id, sanitizeZalgo(body), inWaId);
                }
              }
              console.log(`[rating] Avaliação ${score}/5 registada para conversa ${ratingConv.id} — conversa mantida fechada`);
              if (io) io.emit('message:new', {
                message: db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(ratingConv.id),
                conversation: getConversationWithContact(ratingConv.id),
              });
            } catch (err) {
              console.error('[rating] Erro ao guardar avaliação:', err.message);
            }
            return; // Não reabrir
          }
        }
      }

      // Mensagem recebida do cliente
      // Reabertura inteligente: janela configurável via setting reopen_window_days
      const reopenDays = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'reopen_window_days'").get()?.value ?? '1', 10);
      let closedToReopen = null;
      if (reopenDays > 0) {
        const windowExpr = reopenDays >= 9999
          ? '1=1' // sempre
          : `updated_at >= datetime('now', '-${reopenDays} days')`;
        closedToReopen = db
          .prepare(`SELECT * FROM conversations WHERE contact_id = ? AND status = 'closed' AND ${windowExpr} ORDER BY id DESC LIMIT 1`)
          .get(contact.id);
      }

      let reopened = false;
      let keptAttendant = false;
      if (closedToReopen) {
        // Verificar se atendente anterior ainda está activo e disponível
        const prevAttendant = closedToReopen.assigned_to
          ? db.prepare('SELECT id, name, status, active, on_shift FROM users WHERE id = ?').get(closedToReopen.assigned_to)
          : null;
        const prevAvailable = prevAttendant && prevAttendant.active && prevAttendant.status !== 'offline';

        if (prevAvailable) {
          // Reabrir e manter atendente anterior directamente como 'open'
          db.prepare(`UPDATE conversations SET status = 'open', awaiting_rating = 0, snoozed_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(closedToReopen.id);
          conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(closedToReopen.id);
          keptAttendant = true;
          // Notificar o atendente anterior que a conversa foi reaberta
          if (io) {
            io.to(`user:${prevAttendant.id}`).emit('conversation:reopened', {
              conversation_id: closedToReopen.id,
              contact_name: contact.name || contact.phone,
            });
          }
          console.log(`[conv] Conversa ${closedToReopen.id} reaberta → atendente ${prevAttendant.name} (disponível)`);
        } else {
          // Reabrir mas sem atendente (vai para waiting para ser re-atribuído)
          db.prepare(`UPDATE conversations SET status = 'waiting', assigned_to = NULL, awaiting_rating = 0, snoozed_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(closedToReopen.id);
          conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(closedToReopen.id);
          console.log(`[conv] Conversa ${closedToReopen.id} reaberta → sem atendente disponível, a aguardar atribuição`);
        }
        reopened = true;
      } else {
        const targetDeptId = computeTargetDepartment(body);
        db.prepare(`INSERT INTO conversations (contact_id, status, department_id) VALUES (?, 'waiting', ?)`)
          .run(contact.id, targetDeptId);
        conversation = db
          .prepare(`SELECT * FROM conversations WHERE contact_id = ? ORDER BY id DESC LIMIT 1`)
          .get(contact.id);
      }

      // Auto-assign (só para mensagens do cliente)
      // Apenas atribui se houver atendente online/no turno — sem fallback para offline
      // Se a conversa tem department_id, restringe aos membros desse departamento;
      // caso contrário (modo legacy), considera todos os atendentes.
      if (!keptAttendant && (!reopened || !conversation.assigned_to)) {
        const attendant = pickLeastBusyAttendant(conversation.department_id);
        if (attendant) {
          db.prepare(`UPDATE conversations SET assigned_to = ?, status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(attendant.id, conversation.id);
          conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversation.id);

          // Assinatura automática — apenas em conversas novas (não em reabertura)
          const sigEnabled = !reopened && db.prepare("SELECT value FROM settings WHERE key = 'signature_enabled'").get()?.value === '1';
          if (sigEnabled) {
            const sigTemplate = db.prepare("SELECT value FROM settings WHERE key = 'signature_message'").get()?.value || '';
            const attendantUser = db.prepare('SELECT name FROM users WHERE id = ?').get(attendant.id);
            const sigBody = sigTemplate.replace(/\{\{nome\}\}/gi, attendantUser?.name || '').trim();
            if (sigBody) {
              try {
                const sigWaId = await sendMessage(waId, sigBody);
                db.prepare('INSERT INTO messages (conversation_id, from_me, body, wa_message_id) VALUES (?, 1, ?, ?)')
                  .run(conversation.id, sigBody, sigWaId || null);
                console.log(`[signature] Assinatura enviada para conversa ${conversation.id} (atendente: ${attendantUser?.name})`);
              } catch (err) {
                console.error('[signature] Erro ao enviar assinatura:', err.message);
              }
            }
          }
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
        const vidMsg = content.videoMessage || content.ptvMessage;
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

  // Se não foi possível guardar a media (download falhou ou view-once), usar placeholder
  if (hasMedia && !mediaUrl && !body.trim()) {
    const vType = content.imageMessage ? '📷 Imagem'
      : (content.videoMessage || content.ptvMessage) ? '🎥 Vídeo'
      : content.audioMessage ? '🎤 Áudio'
      : content.stickerMessage ? '🪄 Sticker'
      : '📎 Ficheiro';
    body = isViewOnce ? `${vType} de visualização única`
         : fromMe    ? `${vType} enviada do telemóvel`
         : vType;
  }

  // View-once com conteúdo nulo (Baileys strippou) e sem body ainda → placeholder genérico
  if (isViewOnce && !mediaUrl && !body.trim()) {
    body = '🔒 Mensagem de visualização única';
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
  const safeBody = sanitizeZalgo(body || '');
  const insRes = db.prepare('INSERT INTO messages (conversation_id, from_me, body, media_url, media_type, reply_to_id, wa_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(conversation.id, fromMe ? 1 : 0, safeBody, mediaUrl, mediaType, replyToId, incomingWaId);
  db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversation.id);

  // Transcrição automática de áudios recebidos do cliente — fire-and-forget,
  // não bloqueia o processamento da mensagem. Emite 'message:updated' quando completa.
  if (!fromMe && mediaUrl && mediaType?.startsWith('audio/')) {
    const filename = mediaUrl.split('/').pop();
    const absPath = path.join(UPLOADS_DIR, filename);
    transcribeAudio(absPath, insRes.lastInsertRowid).catch(err =>
      console.error('[transcribe] erro inesperado:', err.message)
    );
  }

  const message = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(conversation.id);
  const fullConversation = getConversationWithContact(conversation.id);

  io.emit('message:new', { message, conversation: fullConversation });
  if (!fromMe && conversation.assigned_to) {
    // Notificação de mensagem recebida (só para mensagens do cliente)
    io.to(`user:${conversation.assigned_to}`).emit('message:incoming', { message, conversation: fullConversation });
  }

  // Avaliação: capturar resposta 1-5 se conversa aguarda avaliação
  if (!fromMe && body && conversation.awaiting_rating) {
    const score = parseInt(body.trim(), 10);
    if (score >= 1 && score <= 5) {
      try {
        db.prepare('INSERT INTO ratings (conversation_id, contact_id, attendant_id, score) VALUES (?, ?, ?, ?)')
          .run(conversation.id, conversation.contact_id, conversation.assigned_to, score);
        db.prepare('UPDATE conversations SET awaiting_rating = 0 WHERE id = ?').run(conversation.id);
        console.log(`[rating] Avaliação ${score}/5 registada para conversa ${conversation.id}`);
      } catch (err) {
        console.error('[rating] Erro ao guardar avaliação:', err.message);
      }
    }
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
  let result;
  if (mimetype.startsWith('image/')) {
    result = await sock.sendMessage(jid, { image: buffer, mimetype, ...opts });
  } else if (mimetype.startsWith('video/')) {
    result = await sock.sendMessage(jid, { video: buffer, mimetype, ...opts });
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
        result = await sock.sendMessage(jid, { document: buffer, mimetype, fileName: filename || path.basename(filePath) });
        return result?.key?.id || null;
      }
    }
    result = await sock.sendMessage(jid, { audio: audioBuffer, mimetype: finalMime, ptt: true });
  } else {
    result = await sock.sendMessage(jid, { document: buffer, mimetype, fileName: filename || path.basename(filePath), ...opts });
  }
  return result?.key?.id || null;
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
           con.notes as contact_notes, con.id as contact_id, u.name as attendant_name,
           d.name as department_name, d.color as department_color
    FROM conversations conv
    JOIN contacts con ON con.id = conv.contact_id
    LEFT JOIN users u ON u.id = conv.assigned_to
    LEFT JOIN departments d ON d.id = conv.department_id
    WHERE conv.id = ?
  `).get(conversationId);
}

function getWAContacts() {
  return Array.from(waContactsCache.values())
    .filter(c => c.phone && /^\d{6,}$/.test(c.phone))
    .sort((a, b) => (a.name || a.phone).localeCompare(b.name || b.phone, 'pt-BR'));
}

module.exports = { initWhatsApp, sendMessage, sendMedia, editMessage, getStatus, disconnectWhatsApp, getWAContacts, runLidMerge };
