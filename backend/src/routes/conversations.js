const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/schema');
const { authMiddleware, ownerOnly, supervisorOrOwner } = require('../middleware/auth');
const { sendMessage, sendMedia, registerLidMapping, runLidMerge } = require('../whatsapp/client');
const ioInstance = require('../io-instance');
const push = require('../push');
const { logAction } = require('../utils/audit');

const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '../../../uploads');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 32 * 1024 * 1024 } });

function conversationQuery(extraWhere = '', currentUserId = null) {
  // is_muted é per-user — se userId não passado, omite o flag (queries gerais
  // como notes/edit não precisam).
  const mutedSelect = currentUserId
    ? `, EXISTS (SELECT 1 FROM conversation_mutes m WHERE m.user_id = ${parseInt(currentUserId, 10)} AND m.conversation_id = conv.id) as is_muted`
    : '';
  return `
    SELECT conv.*, con.phone, con.wa_id, con.id as contact_id, con.name as contact_name, con.email as contact_email, con.notes as contact_notes, u.name as attendant_name,
      d.name as department_name, d.color as department_color,
      l.name as line_name, l.color as line_color,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = conv.id AND from_me = 0 AND read = 0) as unread_count,
      (SELECT MAX(timestamp) FROM messages WHERE conversation_id = conv.id AND from_me = 0) as last_client_at
      ${mutedSelect}
    FROM conversations conv
    JOIN contacts con ON con.id = conv.contact_id
    LEFT JOIN users u ON u.id = conv.assigned_to
    LEFT JOIN departments d ON d.id = conv.department_id
    LEFT JOIN lines l ON l.id = conv.line_id
    ${extraWhere}
    ORDER BY conv.updated_at DESC
  `;
}

// GET /conversations
router.get('/', authMiddleware, (req, res) => {
  const { status, priority, attendant_id, tag_id, department_id, line_id } = req.query;
  const conditions = [];
  const params = [];

  if (req.user.role === 'attendant') {
    conditions.push('conv.assigned_to = ?');
    params.push(req.user.id);
  } else if (req.user.role === 'supervisor') {
    // Supervisor é restrito aos departamentos a que pertence.
    // Se não pertence a nenhum, IN (empty) → 0 resultados (esperado).
    conditions.push('conv.department_id IN (SELECT department_id FROM user_departments WHERE user_id = ?)');
    params.push(req.user.id);
    if (attendant_id) {
      conditions.push('conv.assigned_to = ?');
      params.push(parseInt(attendant_id));
    }
  } else if (attendant_id) {
    // Owner a filtrar por atendente específico
    conditions.push('conv.assigned_to = ?');
    params.push(parseInt(attendant_id));
  }

  if (status === 'snoozed') {
    conditions.push("conv.snoozed_until IS NOT NULL AND conv.snoozed_until > CURRENT_TIMESTAMP");
  } else {
    conditions.push("(conv.snoozed_until IS NULL OR conv.snoozed_until <= CURRENT_TIMESTAMP)");
    if (status) { conditions.push('conv.status = ?'); params.push(status); }
  }

  if (priority && ['urgent','normal','low'].includes(priority)) {
    conditions.push('conv.priority = ?');
    params.push(priority);
  }

  if (tag_id) {
    conditions.push('EXISTS (SELECT 1 FROM conversation_tags ct WHERE ct.conversation_id = conv.id AND ct.tag_id = ?)');
    params.push(parseInt(tag_id));
  }

  if (department_id) {
    conditions.push('conv.department_id = ?');
    params.push(parseInt(department_id));
  }

  if (line_id) {
    conditions.push('conv.line_id = ?');
    params.push(parseInt(line_id));
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const conversations = db.prepare(conversationQuery(where, req.user.id)).all(...params);
  res.json(conversations);
});

// POST /conversations/outbound — iniciar conversa sainte
// body.line_id: opcional; sem isso usa a linha padrão
router.post('/outbound', authMiddleware, async (req, res) => {
  const { phone, message, force, line_id } = req.body;
  if (!phone?.trim()) return res.status(400).json({ error: 'phone obrigatório' });
  if (!message?.trim()) return res.status(400).json({ error: 'message obrigatório' });

  // Resolver line: do body ou default
  let lineId = line_id ? parseInt(line_id, 10) : null;
  if (!lineId) {
    const def = db.prepare("SELECT id FROM lines WHERE is_default = 1 AND active = 1 LIMIT 1").get();
    lineId = def?.id;
  }
  if (!lineId) return res.status(400).json({ error: 'Nenhuma linha activa para envio' });

  // Atendentes só podem usar linhas do seu departamento. Linha sem
  // department_id é considerada configuração administrativa e fica
  // INACESSÍVEL a atendentes (antes era 'global' a todos — security leak
  // para tenants com SAC/Financeiro internos).
  if (req.user.role === 'attendant') {
    const line = db.prepare('SELECT department_id FROM lines WHERE id = ?').get(lineId);
    if (!line?.department_id) {
      return res.status(403).json({ error: 'Esta linha não está atribuída a um departamento. Peça ao Dono para configurar.' });
    }
    const isMember = db.prepare('SELECT 1 FROM user_departments WHERE department_id = ? AND user_id = ?').get(line.department_id, req.user.id);
    if (!isMember) return res.status(403).json({ error: 'Não tens permissão para usar esta linha.' });
  } else if (req.user.role === 'supervisor') {
    // Supervisor: mesma lógica do frontend — linha sem dept OK (administrativa),
    // linha com dept exige ser membro.
    const line = db.prepare('SELECT department_id FROM lines WHERE id = ?').get(lineId);
    if (line?.department_id) {
      const isMember = db.prepare('SELECT 1 FROM user_departments WHERE department_id = ? AND user_id = ?').get(line.department_id, req.user.id);
      if (!isMember) return res.status(403).json({ error: 'Não tens permissão para usar esta linha.' });
    }
  }

  // Normaliza o número: remove espaços, traços, parênteses
  const cleanPhone = phone.trim().replace(/[\s\-().]/g, '');
  // Variante sem prefixo 55 para pesquisa
  const phoneNoPrefix = cleanPhone.replace(/^55/, '');

  // Upsert contacto — procura por número (com/sem prefixo) ou wa_id exacto
  // Usar LIKE causava falsos positivos com contactos LID (ex: wa_id='559691412115@lid')
  let contact = db.prepare(`
    SELECT * FROM contacts
    WHERE phone = ? OR phone = ?
       OR wa_id = ? OR wa_id = ?
       OR wa_id = ? OR wa_id = ?
  `).get(
    cleanPhone, phoneNoPrefix,
    `${cleanPhone}@s.whatsapp.net`, `${phoneNoPrefix}@s.whatsapp.net`,
    `${cleanPhone}@c.us`, `${phoneNoPrefix}@c.us`
  );

  let isNewContact = false;
  if (!contact) {
    db.prepare('INSERT INTO contacts (phone, name) VALUES (?, ?)').run(cleanPhone, cleanPhone);
    contact = db.prepare('SELECT * FROM contacts WHERE phone = ?').get(cleanPhone);
    isNewContact = true;
  }

  // Cria conversa (ou reabre a última fechada) — filtrada por linha
  // Inclui line_id IS NULL para compatibilidade com conversas criadas antes da migração de schema
  let conversation = db.prepare(`SELECT * FROM conversations WHERE contact_id = ? AND (line_id = ? OR line_id IS NULL) AND status != 'closed' ORDER BY id DESC LIMIT 1`).get(contact.id, lineId);

  // Conflito: já existe conversa aberta atribuída a outro utilizador
  const originalAssigneeId = (conversation && conversation.assigned_to && conversation.assigned_to !== req.user.id) ? conversation.assigned_to : null;

  if (originalAssigneeId && !force) {
    const assignedUser = db.prepare('SELECT name FROM users WHERE id = ?').get(originalAssigneeId);
    return res.status(409).json({
      conflict: true,
      conversation_id: conversation.id,
      assigned_to_name: assignedUser?.name || 'outro atendente',
    });
  }

  if (!conversation) {
    // Herdar o departamento da linha (se a linha tiver dept fixo). Sem isto,
    // conversas outbound ficavam sem department_id e invisíveis a supervisores
    // (216 conversas órfãs no supermercados antes deste fix).
    const lineDept = db.prepare('SELECT department_id FROM lines WHERE id = ?').get(lineId)?.department_id || null;
    try {
      db.prepare(`INSERT INTO conversations (contact_id, assigned_to, status, line_id, department_id) VALUES (?, ?, 'open', ?, ?)`).run(contact.id, req.user.id, lineId, lineDept);
    } catch (constraintErr) {
      // UNIQUE constraint failed: já existe conversa aberta para este contact+line.
      // Em vez de crashar, reutilizamos a existente.
      console.warn('[outbound] UNIQUE constraint ao criar conversa, reutilizando existente.');
    }
    conversation = db.prepare("SELECT * FROM conversations WHERE contact_id = ? AND (line_id = ? OR line_id IS NULL) AND status != 'closed' ORDER BY id DESC LIMIT 1").get(contact.id, lineId);
    if (!conversation) return res.status(500).json({ error: 'Não foi possível criar ou encontrar a conversa' });
  }

  // Envia mensagem pelo WhatsApp na linha escolhida
  let waMessageId;
  try {
    waMessageId = await sendMessage(lineId, contact.wa_id || cleanPhone, message);
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao enviar: ' + err.message });
  }

  // Extrair wa_id real do destinatário a partir do ID da mensagem enviada
  // Formato: "true_<waId>_<hash>" — permite detectar se é @lid ou @c.us diferente do que temos
  // Corre sempre (não apenas para contactos novos) para manter wa_id actualizado quando muda para LID
  if (waMessageId) {
    const parts = waMessageId.split('_');
    if (parts.length >= 2) {
      const recipientWaId = parts[1]; // ex: "88244750422224@lid" ou "559684078116@c.us"
      if (recipientWaId && recipientWaId.includes('@')) {
        const existingContact = db.prepare('SELECT * FROM contacts WHERE wa_id = ? AND id != ?').get(recipientWaId, contact.id);
        if (existingContact) {
          // Já existe contacto com este wa_id — mover a conversa para ele e apagar o duplicado
          console.log(`[outbound] Contacto duplicado detectado: ${cleanPhone} = ${existingContact.phone} (${recipientWaId}). A fundir.`);
          db.prepare('UPDATE conversations SET contact_id = ?, assigned_to = ?, status = ? WHERE id = ?')
            .run(existingContact.id, req.user.id, 'open', conversation.id);
          db.prepare('DELETE FROM contacts WHERE id = ?').run(contact.id);
          contact = existingContact;
          conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversation.id);
        } else if (isNewContact || recipientWaId.endsWith('@lid') || !contact.wa_id) {
          // Actualizar wa_id: sempre para contactos novos, ou quando Baileys devolve LID (mais autoritativo)
          db.prepare('UPDATE contacts SET wa_id = ? WHERE id = ?').run(recipientWaId, contact.id);
          contact = { ...contact, wa_id: recipientWaId };
          // Guardar mapeamento LID em memória + disco. Sem actualizar a
          // memória, o próximo handleIncomingMessage não vê o mapping e cria
          // contacto duplicado (bug Elly 2026-05-29).
          if (recipientWaId.endsWith('@lid')) {
            registerLidMapping(lineId, recipientWaId, contact.phone);
            console.log(`[outbound] LID mapeado: ${recipientWaId} → ${contact.phone}`);
          }
        }
      }
    }
  }

  // Guarda mensagem
  db.prepare('INSERT INTO messages (conversation_id, from_me, sender_id, body, wa_message_id) VALUES (?, 1, ?, ?, ?)').run(conversation.id, req.user.id, message, waMessageId || null);
  db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP, assigned_to = ?, status = ? WHERE id = ?').run(req.user.id, 'open', conversation.id);

  const fullConv = db.prepare(conversationQuery('WHERE conv.id = ?')).get(conversation.id);
  const msg = db.prepare('SELECT m.*, u.name as sender_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT 1').get(conversation.id);

  const io = ioInstance.get();
  if (io) {
    io.emit('message:new', { message: msg, conversation: fullConv });
    // Notificar atendente original que perdeu a conversa (takeover)
    if (originalAssigneeId && force) {
      const takenByUser = db.prepare('SELECT name FROM users WHERE id = ?').get(req.user.id);
      io.to(`user:${originalAssigneeId}`).emit('conversation:taken', {
        conversation_id: fullConv.id,
        contact_name: fullConv.contact_name || fullConv.phone,
        taken_by_name: takenByUser?.name || 'outro atendente',
      });
    }
  }
  res.json(fullConv);
});

// GET /conversations/:id/messages
// Query params (opcionais):
//   ?limit=50         — quantas msgs devolver (default 100, max 200)
//   ?before_id=<n>    — só msgs com id < n (paginação para trás)
//   ?q=<text>         — busca substring em body (case-insensitive)
// Devolve sempre em ORDER ASC para o frontend renderizar como antes.
router.get('/:id/messages', authMiddleware, (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });

  if (req.user.role === 'attendant' && conv.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
  const beforeId = req.query.before_id ? parseInt(req.query.before_id, 10) : null;
  const q = req.query.q?.trim() || null;

  const conds = ['m.conversation_id = ?'];
  const params = [req.params.id];
  if (beforeId) { conds.push('m.id < ?'); params.push(beforeId); }
  if (q) { conds.push('LOWER(m.body) LIKE ?'); params.push(`%${q.toLowerCase()}%`); }

  // Pega DESC (últimas N antes do cursor), depois inverte ASC no JS.
  const rows = db.prepare(`
    SELECT m.*, u.name as sender_name,
      qm.body as quoted_body, qm.from_me as quoted_from_me,
      qu.name as quoted_sender_name, qm.media_type as quoted_media_type
    FROM messages m
    LEFT JOIN users u ON u.id = m.sender_id
    LEFT JOIN messages qm ON qm.id = m.reply_to_id
    LEFT JOIN users qu ON qu.id = qm.sender_id
    WHERE ${conds.join(' AND ')}
    ORDER BY m.id DESC
    LIMIT ?
  `).all(...params, limit);

  const messages = rows.reverse();

  // Mark as read — só na carga inicial (sem cursor) para não disparar em
  // paginação para trás ou busca.
  if (!beforeId && !q) {
    db.prepare('UPDATE messages SET read = 1 WHERE conversation_id = ? AND from_me = 0').run(req.params.id);
  }

  res.json(messages);
});

// POST /conversations/:id/notes
router.post('/:id/notes', authMiddleware, (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'body obrigatório' });

  const conv = db.prepare('SELECT conv.*, con.name as contact_name, con.phone FROM conversations conv JOIN contacts con ON con.id = conv.contact_id WHERE conv.id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  if (conv.status === 'closed') return res.status(409).json({ error: 'Conversa fechada. Reabre para adicionar notas.' });
  if (req.user.role === 'attendant' && conv.assigned_to !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });

  const result = db.prepare('INSERT INTO messages (conversation_id, from_me, sender_id, body, is_internal) VALUES (?, 1, ?, ?, 1)')
    .run(req.params.id, req.user.id, body);
  const message = db.prepare('SELECT m.*, u.name as sender_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = ?').get(result.lastInsertRowid);

  // Emitir apenas para quem está na sala da conversa (notas são internas — não notificar globalmente)
  const fullConv = db.prepare(conversationQuery('WHERE conv.id = ?')).get(req.params.id);
  const io = ioInstance.get();
  if (io) {
    io.to(`conv:${req.params.id}`).emit('message:new', { message, conversation: fullConv });
  }

  // Processar @menções: emitir mention:new para cada utilizador mencionado
  const allUsers = db.prepare('SELECT id, name FROM users WHERE active = 1').all();
  for (const u of allUsers) {
    if (u.id !== req.user.id && body.includes(`@${u.name}`)) {
      ioInstance.get()?.to(`user:${u.id}`).emit('mention:new', {
        message,
        conversation: { id: conv.id, contact_name: conv.contact_name || conv.phone },
        mentioned_by: req.user.name,
      });
      push.sendToUser(u.id, {
        title: `${req.user.name} mencionou-te`,
        body: `${conv.contact_name || conv.phone}: ${body.slice(0, 140)}`,
        tag: `mention-${conv.id}`,
        url: `/?conv=${conv.id}`,
        urgent: true, // menções furam quiet hours
      });
    }
  }

  res.json(message);
});

// POST /conversations/:id/send-media — enviar ficheiro/imagem
router.post('/:id/send-media', authMiddleware, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Ficheiro demasiado grande (máximo 32 MB)' });
      }
      return res.status(400).json({ error: err.message || 'Erro ao processar ficheiro' });
    }
    next();
  });
}, async (req, res) => {
  const conv = db.prepare('SELECT conv.*, con.phone, con.wa_id FROM conversations conv JOIN contacts con ON con.id = conv.contact_id WHERE conv.id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  if (conv.status === 'closed') return res.status(409).json({ error: 'Conversa fechada. Reabre para responder.' });
  if (req.user.role === 'attendant' && conv.assigned_to !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });

  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Ficheiro obrigatório' });

  const caption = req.body.caption || '';
  const mediaUrl = `/uploads/${file.filename}`;

  try {
    const waMessageId = await sendMedia(conv.line_id, conv.wa_id || conv.phone, file.path, file.originalname, caption);

    const result = db.prepare('INSERT INTO messages (conversation_id, from_me, sender_id, body, media_url, media_type, media_filename, wa_message_id) VALUES (?, 1, ?, ?, ?, ?, ?, ?)')
      .run(conv.id, req.user.id, caption, mediaUrl, file.mimetype, file.originalname || null, waMessageId || null);
    db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conv.id);

    const message = db.prepare('SELECT m.*, u.name as sender_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = ?').get(result.lastInsertRowid);
    const fullConv = db.prepare(conversationQuery('WHERE conv.id = ?')).get(conv.id);

    ioInstance.get()?.emit('message:new', { message, conversation: fullConv });
    res.json(message);
  } catch (err) {
    console.error(`[send-media] Erro ao enviar ficheiro "${file?.originalname}" (${file?.mimetype}):`, err.message || err);
    try { fs.unlinkSync(file.path); } catch (_) {}
    const msg = err?.message || err?.toString() || 'Erro desconhecido ao enviar ficheiro';
    res.status(500).json({ error: msg });
  }
});

// GET /conversations/contact/:phone
router.get('/contact/:phone', authMiddleware, (req, res) => {
  const contact = db.prepare('SELECT * FROM contacts WHERE phone = ? OR wa_id LIKE ?').get(req.params.phone, `${req.params.phone}%`);
  if (!contact) return res.json([]);

  // Scope por papel: atendente só vê as conversas atribuídas a si; supervisor
  // só as do(s) seu(s) departamento(s); owner vê todas. Sem isto, qualquer
  // atendente podia obter (pelo telefone) o ID e os metadados de conversas de
  // outros setores — fuga de privacidade e vector para transferências indevidas.
  let scope = '';
  const params = [contact.id];
  if (req.user.role === 'attendant') {
    scope = 'AND conv.assigned_to = ?';
    params.push(req.user.id);
  } else if (req.user.role === 'supervisor') {
    scope = 'AND conv.department_id IN (SELECT department_id FROM user_departments WHERE user_id = ?)';
    params.push(req.user.id);
  }

  const convs = db.prepare(`
    SELECT conv.*, u.name as attendant_name,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = conv.id) as message_count
    FROM conversations conv
    LEFT JOIN users u ON u.id = conv.assigned_to
    WHERE conv.contact_id = ? ${scope}
    ORDER BY conv.created_at DESC
  `).all(...params);
  res.json(convs);
});

// POST /conversations/:id/transfer
router.post('/:id/transfer', authMiddleware, async (req, res) => {
  const { attendant_id, notify = true } = req.body;
  if (!attendant_id) return res.status(400).json({ error: 'attendant_id obrigatório' });

  // Scope: só pode transferir uma conversa a que tem acesso (atendente: as suas;
  // supervisor: as do seu depto; owner: todas). O bulk/transfer já tinha esta
  // guarda (filterAllowedIds); o transfer singular tinha ficado sem ela, o que
  // permitia a qualquer utilizador transferir qualquer conversa por ID.
  const convToTransfer = db.prepare('SELECT id, assigned_to, department_id FROM conversations WHERE id = ?').get(req.params.id);
  if (!convToTransfer) return res.status(404).json({ error: 'Conversa não encontrada' });
  if (!userCanAccessConv(convToTransfer, req.user)) {
    return res.status(403).json({ error: 'Sem permissão para transferir esta conversa' });
  }

  const attendant = db.prepare("SELECT id, name, role FROM users WHERE id = ? AND role IN ('attendant', 'supervisor') AND active = 1").get(attendant_id);
  if (!attendant) return res.status(404).json({ error: 'Utilizador não encontrado' });

  // Inferir departamento e linha do novo atendente para actualizar a conversa
  const attendantDept = db.prepare(`
    SELECT ud.department_id, l.id AS line_id
    FROM user_departments ud
    LEFT JOIN lines l ON l.department_id = ud.department_id AND l.active = 1
    WHERE ud.user_id = ?
    ORDER BY ud.department_id
    LIMIT 1
  `).get(attendant_id);

  const prevConv = db.prepare('SELECT assigned_to FROM conversations WHERE id = ?').get(req.params.id);

  if (attendantDept?.line_id) {
    db.prepare(`UPDATE conversations SET assigned_to = ?, department_id = ?, line_id = ?, status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(attendant_id, attendantDept.department_id, attendantDept.line_id, req.params.id);
  } else if (attendantDept?.department_id) {
    db.prepare(`UPDATE conversations SET assigned_to = ?, department_id = ?, status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(attendant_id, attendantDept.department_id, req.params.id);
  } else {
    db.prepare(`UPDATE conversations SET assigned_to = ?, status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(attendant_id, req.params.id);
  }

  // Log de transferência
  db.prepare('INSERT INTO transfer_logs (conversation_id, from_user_id, to_user_id, transferred_by) VALUES (?, ?, ?, ?)')
    .run(req.params.id, prevConv?.assigned_to || null, attendant_id, req.user.id);
  logAction(req, 'conversation.transfer', { type: 'conversation', id: parseInt(req.params.id, 10), details: { from: prevConv?.assigned_to || null, to: attendant_id, notified_client: !!notify } });

  const conv = db.prepare(conversationQuery('WHERE conv.id = ?')).get(req.params.id);

  if (notify) {
    const notifyText = `Olá! O seu atendimento foi transferido para *${attendant.name.trim()}*, que irá continuar a ajudá-lo em breve. 😊`;
    try {
      const waMessageId = await sendMessage(conv.line_id, conv.wa_id || conv.phone, notifyText);
      db.prepare('INSERT INTO messages (conversation_id, from_me, body, wa_message_id) VALUES (?, 1, ?, ?)')
        .run(conv.id, notifyText, waMessageId || null);
    } catch (err) {
      console.error('Aviso: notificação de transferência não enviada:', err.message);
    }
  }

  const io = ioInstance.get();
  if (io) {
    // Notifica todos os clientes para actualizar a conversa
    io.emit('conversation:updated', conv);
    // Notifica o novo atendente para ADICIONAR a conversa à lista (não estava na lista dele)
    io.to(`user:${attendant_id}`).emit('conversation:assigned', { conversation: conv });
    // Notifica o atendente anterior especificamente (para remover da lista)
    if (prevConv?.assigned_to && prevConv.assigned_to !== attendant_id) {
      io.to(`user:${prevConv.assigned_to}`).emit('conversation:unassigned', { id: conv.id });
    }
  }

  res.json(conv);
});

// PATCH /conversations/:id/assign — atribuição directa (owner only, sem log de transferência)
router.patch('/:id/assign', authMiddleware, ownerOnly, (req, res) => {
  const { attendant_id } = req.body;
  if (!attendant_id) return res.status(400).json({ error: 'attendant_id obrigatório' });

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });

  const attendant = db.prepare("SELECT id, name FROM users WHERE id = ? AND role IN ('attendant', 'supervisor') AND active = 1").get(attendant_id);
  if (!attendant) return res.status(404).json({ error: 'Utilizador não encontrado' });

  db.prepare("UPDATE conversations SET assigned_to = ?, status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(attendant_id, req.params.id);

  const updated = db.prepare(conversationQuery('WHERE conv.id = ?')).get(req.params.id);
  const io = ioInstance.get();
  if (io) {
    io.emit('conversation:updated', updated);
    io.to(`user:${attendant_id}`).emit('conversation:assigned', { conversation: updated });
  }
  res.json(updated);
});

// PATCH /conversations/:id/close
router.patch('/:id/close', authMiddleware, async (req, res) => {
  const conv = db.prepare('SELECT conv.*, con.wa_id, con.phone FROM conversations conv JOIN contacts con ON con.id = conv.contact_id WHERE conv.id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  if (req.user.role === 'attendant' && conv.assigned_to !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });

  const ratingEnabled = db.prepare("SELECT value FROM settings WHERE key = 'rating_enabled'").get()?.value === '1';

  db.prepare(`UPDATE conversations SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(req.params.id);

  // Enviar mensagem de avaliação se ativado
  if (ratingEnabled) {
    const ratingMsg = db.prepare("SELECT value FROM settings WHERE key = 'rating_message'").get()?.value
      || 'Como avaliaria o nosso atendimento? Responda com 1 (Muito mau) a 5 (Excelente).';
    const dest = conv.wa_id || conv.phone;
    if (dest) {
      try {
        const waMessageId = await sendMessage(conv.line_id, dest, ratingMsg);
        db.prepare('INSERT INTO messages (conversation_id, from_me, body, wa_message_id) VALUES (?, 1, ?, ?)')
          .run(conv.id, ratingMsg, waMessageId || null);
        db.prepare('UPDATE conversations SET awaiting_rating = 1 WHERE id = ?').run(conv.id);
        const io = ioInstance.get();
        if (io) {
          const ratingMsgRow = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(conv.id);
          io.emit('message:new', { message: ratingMsgRow, conversation: db.prepare(conversationQuery('WHERE conv.id = ?')).get(conv.id) });
        }
      } catch (err) {
        console.error('[rating] Erro ao enviar mensagem de avaliação:', err.message);
      }
    }
  }

  const updated = db.prepare(conversationQuery('WHERE conv.id = ?')).get(req.params.id);
  ioInstance.get()?.emit('conversation:updated', updated);
  res.json(updated);
});

// PATCH /conversations/:id/reopen
router.patch('/:id/reopen', authMiddleware, (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  if (req.user.role === 'attendant' && conv.assigned_to !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });

  // Índice único parcial idx_one_active_conv_per_contact_line impede duas
  // conversas não-fechadas para o mesmo (contact_id, line_id). Antes de
  // reabrir, verificar se já existe outra aberta para o mesmo par. Se sim,
  // devolver 409 com a referência — o frontend redirige para essa.
  const existing = db.prepare(
    `SELECT id FROM conversations WHERE contact_id = ? AND line_id IS ? AND status != 'closed' AND id != ? LIMIT 1`
  ).get(conv.contact_id, conv.line_id, req.params.id);
  if (existing) {
    return res.status(409).json({
      error: 'Já existe uma conversa aberta para este contacto nesta linha',
      conflict: true,
      existing_id: existing.id,
    });
  }

  try {
    db.prepare(`UPDATE conversations SET status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(req.params.id);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Conflito de unicidade ao reabrir', conflict: true });
    }
    throw err;
  }
  const updated = db.prepare(conversationQuery('WHERE conv.id = ?')).get(req.params.id);
  ioInstance.get()?.emit('conversation:updated', updated);
  res.json(updated);
});

// PATCH /conversations/:id/priority
router.patch('/:id/priority', authMiddleware, (req, res) => {
  const { priority } = req.body;
  if (!['urgent', 'normal', 'low'].includes(priority)) return res.status(400).json({ error: 'priority deve ser urgent, normal ou low' });

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  if (req.user.role === 'attendant' && conv.assigned_to !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });

  db.prepare('UPDATE conversations SET priority = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(priority, req.params.id);
  const updated = db.prepare(conversationQuery('WHERE conv.id = ?')).get(req.params.id);
  ioInstance.get()?.emit('conversation:updated', updated);
  res.json(updated);
});

// GET /conversations/mutes — lista IDs mutados pelo utilizador actual.
// Frontend usa para filtrar notificações localmente (o broadcast do
// message:new é global; is_muted per-user não cabe num emit broadcast).
router.get('/mutes', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT conversation_id FROM conversation_mutes WHERE user_id = ?').all(req.user.id);
  res.json(rows.map(r => r.conversation_id));
});

// POST /conversations/:id/mute — silencia notificações desta conversa para
// o utilizador actual (não afecta outros utilizadores).
router.post('/:id/mute', authMiddleware, (req, res) => {
  const conv = db.prepare('SELECT id FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  db.prepare('INSERT OR IGNORE INTO conversation_mutes (user_id, conversation_id) VALUES (?, ?)').run(req.user.id, req.params.id);
  const io = ioInstance.get();
  io?.to(`user:${req.user.id}`).emit('conversation:mute_change', { conversation_id: parseInt(req.params.id, 10), muted: true });
  res.json({ ok: true, muted: true });
});

// DELETE /conversations/:id/mute — remove o mute do utilizador actual.
router.delete('/:id/mute', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM conversation_mutes WHERE user_id = ? AND conversation_id = ?').run(req.user.id, req.params.id);
  const io = ioInstance.get();
  io?.to(`user:${req.user.id}`).emit('conversation:mute_change', { conversation_id: parseInt(req.params.id, 10), muted: false });
  res.json({ ok: true, muted: false });
});

// PATCH /conversations/:id/snooze
router.patch('/:id/snooze', authMiddleware, (req, res) => {
  const { snoozed_until } = req.body; // ISO string or null to unsnooze

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  if (req.user.role === 'attendant' && conv.assigned_to !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });

  db.prepare('UPDATE conversations SET snoozed_until = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(snoozed_until || null, req.params.id);
  const updated = db.prepare(conversationQuery('WHERE conv.id = ?')).get(req.params.id);
  ioInstance.get()?.emit('conversation:updated', updated);
  res.json(updated);
});

// DELETE /conversations/:id
// POST /conversations/:id/merge — fundir com outra conversa (owner only)
// Body: { into_id } — todas as mensagens de :id são movidas para into_id, e :id é eliminada
router.post('/:id/merge', authMiddleware, ownerOnly, (req, res) => {
  const { into_id } = req.body;
  if (!into_id) return res.status(400).json({ error: 'into_id obrigatório' });

  const src = db.prepare('SELECT id FROM conversations WHERE id = ?').get(req.params.id);
  const dst = db.prepare('SELECT id FROM conversations WHERE id = ?').get(into_id);
  if (!src || !dst) return res.status(404).json({ error: 'Conversa não encontrada' });
  if (src.id === dst.id) return res.status(400).json({ error: 'Não é possível fundir uma conversa consigo própria' });

  const merge = db.transaction(() => {
    // Mover mensagens e notas
    db.prepare('UPDATE messages SET conversation_id = ? WHERE conversation_id = ?').run(into_id, src.id);
    // Mover tags (ignorar duplicados)
    db.prepare(`INSERT OR IGNORE INTO conversation_tags (conversation_id, tag_id)
                SELECT ?, tag_id FROM conversation_tags WHERE conversation_id = ?`).run(into_id, src.id);
    // Eliminar conversa de origem
    db.prepare('DELETE FROM conversation_tags WHERE conversation_id = ?').run(src.id);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(src.id);
    // Actualizar updated_at da destino
    db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(into_id);
  });
  merge();

  const io = ioInstance.get();
  io?.emit('conversation:deleted', { id: src.id });

  const result = db.prepare(`
    SELECT conv.*, con.phone, con.wa_id, con.name as contact_name, u.name as attendant_name
    FROM conversations conv
    JOIN contacts con ON con.id = conv.contact_id
    LEFT JOIN users u ON u.id = conv.assigned_to
    WHERE conv.id = ?
  `).get(into_id);
  io?.emit('conversation:updated', result);

  res.json(result);
});

// ─── Bulk actions (têm de vir ANTES de DELETE /:id ou Express trata "bulk" como id) ─
// Helper: valida que o utilizador pode operar em todas as conversas pedidas
// (owner pode em qualquer; atendente apenas nas suas). Devolve { ids, denied }.
function filterAllowedIds(rawIds, user) {
  if (!Array.isArray(rawIds) || rawIds.length === 0) return { ids: [], denied: [] };
  const ids = rawIds.map(n => parseInt(n, 10)).filter(Number.isInteger);
  if (ids.length === 0) return { ids: [], denied: [] };
  if (user.role === 'owner') return { ids, denied: [] };
  // Atendente: filtrar apenas as assigned_to ele
  const placeholders = ids.map(() => '?').join(',');
  const allowed = db.prepare(`SELECT id FROM conversations WHERE id IN (${placeholders}) AND assigned_to = ?`).all(...ids, user.id).map(r => r.id);
  const allowedSet = new Set(allowed);
  return { ids: allowed, denied: ids.filter(i => !allowedSet.has(i)) };
}

// Verifica se o utilizador pode aceder a uma conversa específica.
//   owner      → todas
//   supervisor → só as dos seus departamentos
//   atendente  → só as atribuídas a si
// `conv` deve conter pelo menos { assigned_to, department_id }.
function userCanAccessConv(conv, user) {
  if (!conv) return false;
  if (user.role === 'owner') return true;
  if (user.role === 'supervisor') {
    if (conv.department_id == null) return false;
    return !!db.prepare(
      'SELECT 1 FROM user_departments WHERE user_id = ? AND department_id = ?'
    ).get(user.id, conv.department_id);
  }
  return conv.assigned_to === user.id;
}

// POST /conversations/bulk/close — fecha N conversas
router.post('/bulk/close', authMiddleware, (req, res) => {
  const { ids: rawIds } = req.body;
  const { ids, denied } = filterAllowedIds(rawIds, req.user);
  if (ids.length === 0) return res.status(400).json({ error: 'Nenhuma conversa permitida', denied });

  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`UPDATE conversations SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(...ids);

  // Emitir conversation:updated para cada uma (frontend remove/actualiza)
  const io = ioInstance.get();
  if (io) for (const id of ids) io.emit('conversation:updated', { id, status: 'closed' });
  res.json({ ok: true, updated: result.changes, denied });
});

// POST /conversations/bulk/transfer — atribui N conversas a um atendente
// body: { ids, attendant_id }
router.post('/bulk/transfer', authMiddleware, (req, res) => {
  const { ids: rawIds, attendant_id } = req.body;
  if (!attendant_id) return res.status(400).json({ error: 'attendant_id obrigatório' });
  const attendant = db.prepare("SELECT id, name FROM users WHERE id = ? AND role IN ('attendant', 'supervisor') AND active = 1").get(attendant_id);
  if (!attendant) return res.status(404).json({ error: 'Utilizador não encontrado' });

  const { ids, denied } = filterAllowedIds(rawIds, req.user);
  if (ids.length === 0) return res.status(400).json({ error: 'Nenhuma conversa permitida', denied });

  const placeholders = ids.map(() => '?').join(',');
  const tx = db.transaction(() => {
    // Log de transferência para cada
    const prev = db.prepare(`SELECT id, assigned_to FROM conversations WHERE id IN (${placeholders})`).all(...ids);
    const insertLog = db.prepare('INSERT INTO transfer_logs (conversation_id, from_user_id, to_user_id, transferred_by) VALUES (?, ?, ?, ?)');
    for (const p of prev) insertLog.run(p.id, p.assigned_to || null, attendant_id, req.user.id);
    db.prepare(`UPDATE conversations SET assigned_to = ?, status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(attendant_id, ...ids);
  });
  tx();

  const io = ioInstance.get();
  if (io) {
    for (const id of ids) io.emit('conversation:updated', { id, assigned_to: attendant_id });
    io.to(`user:${attendant_id}`).emit('conversation:assigned', { bulk: true, count: ids.length, from: req.user.name });
  }
  res.json({ ok: true, updated: ids.length, denied, attendant_name: attendant.name });
});

// POST /conversations/bulk/tag — aplica uma tag a N conversas (idempotente)
// body: { ids, tag_id }
router.post('/bulk/tag', authMiddleware, (req, res) => {
  const { ids: rawIds, tag_id } = req.body;
  if (!tag_id) return res.status(400).json({ error: 'tag_id obrigatório' });
  const tag = db.prepare('SELECT id FROM tags WHERE id = ?').get(tag_id);
  if (!tag) return res.status(404).json({ error: 'Etiqueta não encontrada' });

  const { ids, denied } = filterAllowedIds(rawIds, req.user);
  if (ids.length === 0) return res.status(400).json({ error: 'Nenhuma conversa permitida', denied });

  const ins = db.prepare('INSERT OR IGNORE INTO conversation_tags (conversation_id, tag_id) VALUES (?, ?)');
  const tx = db.transaction(() => { for (const id of ids) ins.run(id, tag_id); });
  tx();

  // Emitir update de tags para cada
  const io = ioInstance.get();
  if (io) {
    for (const id of ids) {
      const tags = db.prepare(`SELECT t.id, t.name, t.color FROM tags t INNER JOIN conversation_tags ct ON ct.tag_id = t.id WHERE ct.conversation_id = ?`).all(id);
      io.emit('conversation:tags_updated', { conversation_id: id, tags });
    }
  }
  res.json({ ok: true, updated: ids.length, denied });
});

// POST /conversations/bulk/department — muda dept de N conversas (owner-only via ownerOnly)
// body: { ids, department_id }
router.post('/bulk/department', authMiddleware, ownerOnly, (req, res) => {
  const { ids: rawIds, department_id } = req.body;
  if (department_id != null) {
    const dept = db.prepare('SELECT id FROM departments WHERE id = ? AND active = 1').get(department_id);
    if (!dept) return res.status(400).json({ error: 'Departamento inválido' });
  }
  const ids = (rawIds || []).map(n => parseInt(n, 10)).filter(Number.isInteger);
  if (ids.length === 0) return res.status(400).json({ error: 'ids obrigatório' });

  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`UPDATE conversations SET department_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(department_id || null, ...ids);

  const io = ioInstance.get();
  if (io) for (const id of ids) io.emit('conversation:updated', { id, department_id: department_id || null });
  res.json({ ok: true, updated: result.changes });
});

// DELETE /conversations/bulk — apaga N conversas (owner only)
// body: { ids }
router.delete('/bulk', authMiddleware, ownerOnly, (req, res) => {
  const ids = (req.body?.ids || []).map(n => parseInt(n, 10)).filter(Number.isInteger);
  if (ids.length === 0) return res.status(400).json({ error: 'ids obrigatório' });

  const placeholders = ids.map(() => '?').join(',');
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM scheduled_messages WHERE conversation_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM messages WHERE conversation_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM conversation_tags WHERE conversation_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM conversations WHERE id IN (${placeholders})`).run(...ids);
  });
  tx();

  const io = ioInstance.get();
  if (io) for (const id of ids) io.emit('conversation:deleted', { id });
  logAction(req, 'conversation.bulk_delete', { type: 'conversation', details: { count: ids.length, ids } });
  res.json({ ok: true, deleted: ids.length });
});

// DELETE /:id — single (mantido aqui depois das bulk para Express resolver na ordem certa)
router.delete('/:id', authMiddleware, ownerOnly, (req, res) => {
  const conv = db.prepare('SELECT id FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  // scheduled_messages e messages referenciam conversations sem ON DELETE CASCADE
  // (FK NO ACTION). Têm de ser apagados antes para evitar FOREIGN KEY violation.
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM scheduled_messages WHERE conversation_id = ?').run(req.params.id);
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(req.params.id);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
  });
  tx();
  ioInstance.get()?.emit('conversation:deleted', { id: parseInt(req.params.id, 10) });
  logAction(req, 'conversation.delete', { type: 'conversation', id: parseInt(req.params.id, 10) });
  res.json({ ok: true });
});

// GET /conversations/dashboard — dados ao vivo para o dashboard principal
// Supervisor: vê apenas dados dos departamentos a que pertence.
// Owner: vê tudo.
router.get('/dashboard', authMiddleware, supervisorOrOwner, (req, res) => {
  const slaMinutes = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'sla_minutes'").get()?.value || '30', 10);

  // Filtro condicional por departamento (só para supervisor). Helpers para
  // injectar a clause certa dependendo do nome da tabela na query.
  const isSupervisor = req.user.role === 'supervisor';
  const userDeptIds = isSupervisor
    ? db.prepare('SELECT department_id FROM user_departments WHERE user_id = ?').all(req.user.id).map(r => r.department_id)
    : [];
  // Se supervisor sem departamentos, devolve dashboard vazio para evitar
  // SQL `IN ()` que é erro de sintaxe.
  if (isSupervisor && userDeptIds.length === 0) {
    return res.json({
      live: { waiting: 0, open: 0, total_today: 0, closed_today: 0, sla_breached: 0 },
      tmaToday: null, firstResponseToday: null, hourly: [], attendants: [],
      atRisk: [], slaMinutes, totals: { total: 0, waiting: 0, open: 0, closed: 0 },
      byDepartment: [],
      _supervisor_without_depts: true,
    });
  }
  const deptPlaceholders = userDeptIds.map(() => '?').join(',');
  // Para queries com FROM conversations (sem alias)
  const fDept = isSupervisor ? `AND department_id IN (${deptPlaceholders})` : '';
  // Para queries com FROM conversations conv ou alias c.
  const cDept = (alias) => isSupervisor ? `AND ${alias}.department_id IN (${deptPlaceholders})` : '';
  // Helper para concatenar params dinâmicos
  const dp = isSupervisor ? userDeptIds : [];

  // Contagens ao vivo
  const live = db.prepare(`
    SELECT
      COUNT(CASE WHEN status = 'waiting' THEN 1 END) as waiting,
      COUNT(CASE WHEN status = 'open'    THEN 1 END) as open,
      COUNT(CASE WHEN date(created_at,'localtime') = date('now','localtime') THEN 1 END) as total_today,
      COUNT(CASE WHEN status = 'closed' AND date(updated_at,'localtime') = date('now','localtime') THEN 1 END) as closed_today
    FROM conversations
    WHERE (snoozed_until IS NULL OR snoozed_until <= CURRENT_TIMESTAMP) ${fDept}
  `).get(...dp);

  // SLA: conversas abertas/em espera há mais de X minutos sem resposta do atendente
  const slaBreached = db.prepare(`
    SELECT COUNT(*) as c FROM conversations
    WHERE status IN ('open','waiting')
    AND (snoozed_until IS NULL OR snoozed_until <= CURRENT_TIMESTAMP)
    AND sla_alerted_at IS NULL
    AND (julianday('now') - julianday(created_at)) * 24 * 60 > ?
    ${fDept}
  `).get(slaMinutes, ...dp)?.c || 0;

  // TMA médio hoje
  const tmaToday = db.prepare(`
    SELECT ROUND(AVG((julianday(updated_at)-julianday(created_at))*24*60),1) as avg
    FROM conversations
    WHERE status='closed' AND date(updated_at,'localtime')=date('now','localtime') ${fDept}
  `).get(...dp)?.avg || null;

  // Tempo médio 1ª resposta hoje
  const firstResponseToday = db.prepare(`
    SELECT ROUND(AVG(response_seconds)/60.0,1) as avg FROM (
      SELECT (strftime('%s', MIN(CASE WHEN m.from_me=1 THEN m.timestamp END))
             -strftime('%s', MIN(CASE WHEN m.from_me=0 THEN m.timestamp END))) as response_seconds
      FROM conversations c JOIN messages m ON m.conversation_id=c.id
      WHERE date(c.created_at,'localtime')=date('now','localtime') ${cDept('c')}
      GROUP BY c.id HAVING response_seconds>0 AND response_seconds<86400
    )
  `).get(...dp)?.avg || null;

  // Volume por hora hoje
  const hourly = db.prepare(`
    SELECT strftime('%H',created_at,'localtime') as hour, COUNT(*) as total
    FROM conversations WHERE date(created_at,'localtime')=date('now','localtime') ${fDept}
    GROUP BY hour ORDER BY hour ASC
  `).all(...dp);

  // Atendentes com contagem de conversas abertas
  // Para supervisor: só atendentes dos seus departamentos
  const supDeptJoinAtt = isSupervisor
    ? `AND u.id IN (SELECT user_id FROM user_departments WHERE department_id IN (${deptPlaceholders}))`
    : '';
  const attendants = db.prepare(`
    SELECT u.id, u.name, u.status, u.on_shift,
      COUNT(CASE WHEN c.status IN ('open','waiting') ${cDept('c')} THEN 1 END) as active_count
    FROM users u
    LEFT JOIN conversations c ON c.assigned_to=u.id AND c.status IN ('open','waiting')
    WHERE u.role='attendant' AND u.active=1 ${supDeptJoinAtt}
    GROUP BY u.id ORDER BY u.status='online' DESC, active_count DESC
  `).all(...dp, ...dp);

  // Últimas 5 conversas abertas/espera mais antigas (SLA risk)
  const atRisk = db.prepare(`
    SELECT conv.id, con.name as contact_name, con.phone,
      conv.status, conv.created_at,
      u.name as attendant_name,
      ROUND((julianday('now')-julianday(conv.created_at))*24*60,0) as minutes_open
    FROM conversations conv
    JOIN contacts con ON con.id=conv.contact_id
    LEFT JOIN users u ON u.id=conv.assigned_to
    WHERE conv.status IN ('open','waiting')
    AND (conv.snoozed_until IS NULL OR conv.snoozed_until<=CURRENT_TIMESTAMP)
    ${cDept('conv')}
    ORDER BY conv.created_at ASC LIMIT 5
  `).all(...dp);

  // Totais históricos (todos os tempos)
  const totals = db.prepare(`
    SELECT COUNT(*) as total,
      COUNT(CASE WHEN status='waiting' THEN 1 END) as waiting,
      COUNT(CASE WHEN status='open'    THEN 1 END) as open,
      COUNT(CASE WHEN status='closed'  THEN 1 END) as closed
    FROM conversations
    ${isSupervisor ? `WHERE department_id IN (${deptPlaceholders})` : ''}
  `).get(...dp);

  // Breakdown por departamento — apenas conversas activas (open/waiting, não snoozed).
  // sla_breached usa o flag sla_alerted_at (preenchido pelo cron quando excedeu o
  // limite efectivo do dept ou o global). Inclui sla_effective = dept SLA ou global.
  const byDepartment = db.prepare(`
    SELECT d.id, d.name, d.color, d.sla_minutes,
      COALESCE(d.sla_minutes, ?) AS sla_effective,
      COUNT(CASE WHEN c.status = 'open'    THEN 1 END) AS open_count,
      COUNT(CASE WHEN c.status = 'waiting' THEN 1 END) AS waiting_count,
      COUNT(CASE WHEN c.status IN ('open','waiting') AND c.sla_alerted_at IS NOT NULL THEN 1 END) AS sla_breached
    FROM departments d
    LEFT JOIN conversations c ON c.department_id = d.id
      AND (c.snoozed_until IS NULL OR c.snoozed_until <= CURRENT_TIMESTAMP)
    WHERE d.active = 1 ${isSupervisor ? `AND d.id IN (${deptPlaceholders})` : ''}
    GROUP BY d.id
    ORDER BY d.is_default DESC, d.name ASC
  `).all(slaMinutes, ...dp);

  res.json({ live: { ...live, sla_breached: slaBreached }, tmaToday, firstResponseToday, hourly, attendants, atRisk, slaMinutes, totals, byDepartment });
});

// GET /conversations/metrics
router.get('/metrics', authMiddleware, ownerOnly, (req, res) => {
  const metrics = db.prepare(`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN status = 'waiting' THEN 1 END) as waiting,
      COUNT(CASE WHEN status = 'open' THEN 1 END) as open,
      COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed
    FROM conversations
  `).get();
  res.json(metrics);
});

// GET /conversations/export — CSV com histórico
// Owner: tudo. Supervisor: só conversas dos seus departamentos.
router.get('/export', authMiddleware, supervisorOrOwner, (req, res) => {
  const isSupervisor = req.user.role === 'supervisor';
  const userDeptIds = isSupervisor
    ? db.prepare('SELECT department_id FROM user_departments WHERE user_id = ?').all(req.user.id).map(r => r.department_id)
    : [];
  const dphold = userDeptIds.map(() => '?').join(',');
  const dp = isSupervisor ? userDeptIds : [];
  const deptWhere = isSupervisor
    ? (userDeptIds.length ? `WHERE conv.department_id IN (${dphold})` : 'WHERE 1=0')
    : '';

  const rows = db.prepare(`
    SELECT conv.id, con.name as contact_name, con.phone, conv.status,
      u.name as attendant_name, conv.created_at, conv.updated_at,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = conv.id) as msg_count,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = conv.id AND from_me = 0) as client_msgs,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = conv.id AND from_me = 1) as agent_msgs
    FROM conversations conv
    JOIN contacts con ON con.id = conv.contact_id
    LEFT JOIN users u ON u.id = conv.assigned_to
    ${deptWhere}
    ORDER BY conv.created_at DESC
  `).all(...dp);

  const header = 'ID,Contacto,Telefone,Status,Atendente,Criado em,Última actualização,Total msgs,Msgs cliente,Msgs atendente';
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map(r => [r.id, r.contact_name || '', r.phone, r.status, r.attendant_name || '', r.created_at, r.updated_at, r.msg_count, r.client_msgs, r.agent_msgs].map(escape).join(','));

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="conversas-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send('﻿' + [header, ...lines].join('\r\n')); // BOM para Excel
});

// GET /conversations/transfer-logs
router.get('/transfer-logs', authMiddleware, ownerOnly, (req, res) => {
  const logs = db.prepare(`
    SELECT tl.id, tl.created_at,
      conv.id as conversation_id, con.name as contact_name, con.phone,
      fu.name as from_name, tu.name as to_name, bu.name as by_name
    FROM transfer_logs tl
    JOIN conversations conv ON conv.id = tl.conversation_id
    JOIN contacts con ON con.id = conv.contact_id
    LEFT JOIN users fu ON fu.id = tl.from_user_id
    JOIN users tu ON tu.id = tl.to_user_id
    JOIN users bu ON bu.id = tl.transferred_by
    ORDER BY tl.created_at DESC
    LIMIT 200
  `).all();
  res.json(logs);
});

// GET /conversations/reports?period=today|week|month|all
// Owner: todos os dados. Supervisor: restrito aos departamentos dele.
router.get('/reports', authMiddleware, supervisorOrOwner, (req, res) => {
  const VALID = ['today', 'week', 'month', 'all'];
  const period = VALID.includes(req.query.period) ? req.query.period : 'month';

  // Filtro de departamento — só para supervisor
  const isSupervisor = req.user.role === 'supervisor';
  const userDeptIds = isSupervisor
    ? db.prepare('SELECT department_id FROM user_departments WHERE user_id = ?').all(req.user.id).map(r => r.department_id)
    : [];
  if (isSupervisor && userDeptIds.length === 0) {
    return res.json({ period, summary: {}, byAttendant: [], byHour: [], byDay: [], avgResponse: {} });
  }
  const dphold = userDeptIds.map(() => '?').join(',');
  const dp = isSupervisor ? userDeptIds : [];
  // Clauses de dept para cada forma de referenciar a tabela
  const fDept = isSupervisor ? ` AND department_id IN (${dphold})` : '';
  const cDept = isSupervisor ? ` AND c.department_id IN (${dphold})` : '';

  // Period WHERE clause (applied directly to conversations table)
  const PERIOD = {
    today: `date(created_at, 'localtime') = date('now', 'localtime')`,
    week:  `created_at >= datetime('now', 'localtime', '-7 days')`,
    month: `created_at >= datetime('now', 'localtime', '-30 days')`,
    all:   '1=1',
  };
  // Same with table alias c.
  const PERIOD_C = {
    today: `date(c.created_at, 'localtime') = date('now', 'localtime')`,
    week:  `c.created_at >= datetime('now', 'localtime', '-7 days')`,
    month: `c.created_at >= datetime('now', 'localtime', '-30 days')`,
    all:   '1=1',
  };

  const w   = PERIOD[period];
  const wc  = PERIOD_C[period];
  // For LEFT JOIN condition (no WHERE keyword)
  const joinCond = (period === 'all' ? '' : `AND ${PERIOD_C[period]}`) + cDept;

  // Summary metrics
  const summary = db.prepare(`
    SELECT
      COUNT(*) as total_conversations,
      COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_conversations,
      COUNT(CASE WHEN status = 'open'   THEN 1 END) as open_conversations,
      ROUND(AVG(CASE WHEN status = 'closed'
        THEN (julianday(updated_at) - julianday(created_at)) * 24 * 60
      END), 1) as avg_tma_minutes
    FROM conversations WHERE ${w}${fDept}
  `).get(...dp);

  // Average first response time (client msg → first agent reply)
  const avgResponse = db.prepare(`
    SELECT ROUND(AVG(response_seconds) / 60.0, 1) as avg_minutes
    FROM (
      SELECT c.id,
        (strftime('%s', MIN(CASE WHEN m.from_me = 1 THEN m.timestamp END)) -
         strftime('%s', MIN(CASE WHEN m.from_me = 0 THEN m.timestamp END))) as response_seconds
      FROM conversations c
      JOIN messages m ON m.conversation_id = c.id
      WHERE ${wc}${cDept}
      GROUP BY c.id
      HAVING response_seconds > 0 AND response_seconds < 86400
    )
  `).get(...dp);

  // Per attendant: count + TMA. Supervisor só vê atendentes dos seus deptos.
  const attDeptFilter = isSupervisor
    ? `AND u.id IN (SELECT user_id FROM user_departments WHERE department_id IN (${dphold}))`
    : '';
  const byAttendant = db.prepare(`
    SELECT u.name,
      COUNT(c.id)                                                     as total,
      COUNT(CASE WHEN c.status = 'open'   THEN 1 END)                as open,
      COUNT(CASE WHEN c.status = 'closed' THEN 1 END)                as closed,
      ROUND(AVG(CASE WHEN c.status = 'closed'
        THEN (julianday(c.updated_at) - julianday(c.created_at)) * 24 * 60
      END), 1)                                                        as avg_tma_minutes
    FROM users u
    LEFT JOIN conversations c ON c.assigned_to = u.id ${joinCond}
    WHERE u.role = 'attendant' AND u.active = 1 ${attDeptFilter}
    GROUP BY u.id ORDER BY total DESC
  `).all(...dp, ...dp);

  // Volume by hour of day
  const byHour = db.prepare(`
    SELECT strftime('%H', created_at, 'localtime') as hour, COUNT(*) as total
    FROM conversations WHERE ${w}${fDept}
    GROUP BY hour ORDER BY hour ASC
  `).all(...dp);

  // Volume by day
  const byDay = db.prepare(`
    SELECT strftime('%Y-%m-%d', created_at, 'localtime') as day, COUNT(*) as total
    FROM conversations WHERE ${w}${fDept}
    GROUP BY day ORDER BY day ASC
  `).all(...dp);

  res.json({ period, summary, byAttendant, byHour, byDay, avgResponse });
});

// GET /conversations/ratings?period=today|week|month|all
// Owner: todos. Supervisor: só ratings das conversas dos seus departamentos.
router.get('/ratings', authMiddleware, supervisorOrOwner, (req, res) => {
  const VALID = ['today', 'week', 'month', 'all'];
  const period = VALID.includes(req.query.period) ? req.query.period : 'month';
  const PERIOD = {
    today: `date(r.created_at, 'localtime') = date('now', 'localtime')`,
    week:  `r.created_at >= datetime('now', 'localtime', '-7 days')`,
    month: `r.created_at >= datetime('now', 'localtime', '-30 days')`,
    all:   '1=1',
  };
  const w = PERIOD[period];

  // Filtro de dept para supervisor — ratings ligam-se à conversa, filtramos
  // pelo department_id da conversa avaliada.
  const isSupervisor = req.user.role === 'supervisor';
  const userDeptIds = isSupervisor
    ? db.prepare('SELECT department_id FROM user_departments WHERE user_id = ?').all(req.user.id).map(r => r.department_id)
    : [];
  if (isSupervisor && userDeptIds.length === 0) {
    return res.json({ summary: {}, byAttendant: [], recent: [] });
  }
  const dphold = userDeptIds.map(() => '?').join(',');
  const dp = isSupervisor ? userDeptIds : [];
  const rDept = isSupervisor
    ? ` AND r.conversation_id IN (SELECT id FROM conversations WHERE department_id IN (${dphold}))`
    : '';
  const attDeptFilter = isSupervisor
    ? `AND u.id IN (SELECT user_id FROM user_departments WHERE department_id IN (${dphold}))`
    : '';

  const summary = db.prepare(`
    SELECT COUNT(*) as total, ROUND(AVG(score), 2) as avg_score,
      COUNT(CASE WHEN score = 5 THEN 1 END) as score5,
      COUNT(CASE WHEN score = 4 THEN 1 END) as score4,
      COUNT(CASE WHEN score = 3 THEN 1 END) as score3,
      COUNT(CASE WHEN score = 2 THEN 1 END) as score2,
      COUNT(CASE WHEN score = 1 THEN 1 END) as score1
    FROM ratings r WHERE ${w}${rDept}
  `).get(...dp);

  const byAttendant = db.prepare(`
    SELECT u.name,
      COUNT(r.id) as total,
      ROUND(AVG(r.score), 2) as avg_score
    FROM users u
    LEFT JOIN ratings r ON r.attendant_id = u.id AND ${w}${rDept}
    WHERE u.role IN ('attendant', 'owner') AND u.active = 1 ${attDeptFilter}
    GROUP BY u.id ORDER BY avg_score DESC NULLS LAST
  `).all(...dp, ...dp);

  const recent = db.prepare(`
    SELECT r.id, r.score, r.created_at, r.conversation_id,
      con.name as contact_name, con.phone,
      u.name as attendant_name
    FROM ratings r
    JOIN contacts con ON con.id = r.contact_id
    LEFT JOIN users u ON u.id = r.attendant_id
    WHERE ${w}${rDept}
    ORDER BY r.created_at DESC LIMIT 20
  `).all(...dp);

  res.json({ summary, byAttendant, recent });
});

module.exports = router;
