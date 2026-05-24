require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const db = require('./db/schema');
const { initWhatsApp, getStatus, getAllStatuses, disconnectWhatsApp, getWAContacts } = require('./whatsapp/client');
const { initSocket } = require('./socket/handlers');
const { authMiddleware, ownerOnly } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const conversationsRoutes = require('./routes/conversations');
const messagesRoutes = require('./routes/messages');
const quickRepliesRoutes = require('./routes/quick-replies');
const tagsRoutes = require('./routes/tags');
const settingsRoutes = require('./routes/settings');
const scheduledMessagesRoutes = require('./routes/scheduled-messages');
const contactsRoutes = require('./routes/contacts');
const searchRoutes = require('./routes/search');
const keywordRulesRoutes = require('./routes/keyword-rules');
const blacklistRoutes = require('./routes/blacklist');
const broadcastRoutes = require('./routes/broadcast');
const departmentsRoutes = require('./routes/departments');
const pushRoutes = require('./routes/push');
const linesRoutes = require('./routes/lines');
const { startScheduledMessagesCron } = require('./scheduled/cron');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true },
});

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use('/uploads', express.static(require('path').join(__dirname, '../../uploads')));

// Seed: criar conta do dono se não existir
const owner = db.prepare("SELECT id FROM users WHERE role = 'owner'").get();
if (!owner) {
  const hash = bcrypt.hashSync(process.env.OWNER_PASSWORD || 'admin123', 10);
  db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'owner')")
    .run(process.env.OWNER_NAME || 'Dono', process.env.OWNER_EMAIL || 'dono@loja.com', hash);
  console.log('Conta do dono criada:', process.env.OWNER_EMAIL || 'dono@loja.com', '/ senha:', process.env.OWNER_PASSWORD || 'admin123');
}

// Seed/migration: garantir que existe pelo menos uma linha. Para tenants
// existentes (single-line antes desta feature), cria "Linha principal" usando
// o WA_SESSION_PATH legado e atribui todas as conversas órfãs a ela.
// Para tenants novos sem conversas, cria a mesma linha como ponto de partida.
const linesCount = db.prepare("SELECT COUNT(*) AS c FROM lines WHERE active = 1").get().c;
if (linesCount === 0) {
  const legacySessionPath = process.env.WA_SESSION_PATH || require('path').join(__dirname, '../baileys-session');
  const r = db.prepare("INSERT INTO lines (name, color, session_path, is_default) VALUES ('Linha principal', '#25D366', ?, 1)").run(legacySessionPath);
  const lineId = r.lastInsertRowid;
  const orphans = db.prepare("UPDATE conversations SET line_id = ? WHERE line_id IS NULL").run(lineId);
  if (orphans.changes > 0) {
    console.log(`[migration-lines] criou Linha principal (id=${lineId}) usando ${legacySessionPath}`);
    console.log(`[migration-lines] ${orphans.changes} conversa(s) órfã(s) atribuídas`);
  } else {
    console.log(`[migration-lines] criou Linha principal (id=${lineId}) usando ${legacySessionPath}`);
  }
}

// Rotas
app.use('/auth', authRoutes);
app.use('/users', usersRoutes);
app.use('/conversations', conversationsRoutes);
app.use('/messages', messagesRoutes);
app.use('/quick-replies', quickRepliesRoutes);
app.use('/tags', tagsRoutes);
app.use('/settings', settingsRoutes);
app.use('/scheduled-messages', scheduledMessagesRoutes);
app.use('/contacts', contactsRoutes);
app.use('/search', searchRoutes);
app.use('/keyword-rules', keywordRulesRoutes);
app.use('/blacklist', blacklistRoutes);
app.use('/broadcast', broadcastRoutes);
app.use('/departments', departmentsRoutes);
app.use('/push', pushRoutes);
app.use('/lines', linesRoutes);

// Health check — sem auth, designed para monitoring/uptime probes (UptimeRobot, etc).
// Devolve 200 se DB responde; 503 se algo crítico está down. Nunca expõe dados sensíveis.
app.get('/health', (req, res) => {
  const wa = getStatus();
  const push = require('./push');
  const transcribe = require('./whatsapp/transcribe');
  let dbOk = false;
  try { db.prepare('SELECT 1').get(); dbOk = true; } catch (_) {}

  let pkgVersion = null;
  try { pkgVersion = require('../package.json').version || null; } catch (_) {}

  const body = {
    ok: dbOk,
    db: dbOk ? 'ok' : 'fail',
    whatsapp: { ready: wa.isReady, hasQr: wa.hasQr },
    push: push.isReady() ? 'configured' : 'unconfigured',
    transcribe: transcribe.isReady() ? 'configured' : 'unconfigured',
    uptime_seconds: Math.round(process.uptime()),
    version: pkgVersion,
    timestamp: new Date().toISOString(),
  };
  res.status(dbOk ? 200 : 503).json(body);
});

// WhatsApp status — sem line_id devolve estado da linha padrão (back-compat).
// Com ?line_id=X devolve dessa linha. Endpoint /whatsapp/statuses devolve TODAS.
app.get('/whatsapp/status', authMiddleware, (req, res) => {
  const lineId = req.query.line_id ? parseInt(req.query.line_id, 10) : null;
  res.json(getStatus(lineId));
});
app.get('/whatsapp/statuses', authMiddleware, (req, res) => {
  res.json(getAllStatuses());
});

// WhatsApp disconnect (owner only) — ?line_id=X para uma específica; sem param desconecta a padrão
app.post('/whatsapp/disconnect', authMiddleware, ownerOnly, async (req, res) => {
  const lineId = req.query.line_id ? parseInt(req.query.line_id, 10) : null;
  await disconnectWhatsApp(lineId);
  res.json({ ok: true });
});

// Listar contactos da agenda do WhatsApp (em memória, populado pelo contacts.upsert)
// Sem line_id usa a padrão.
app.get('/whatsapp/contacts', authMiddleware, ownerOnly, (req, res) => {
  const lineId = req.query.line_id ? parseInt(req.query.line_id, 10) : null;
  const all = getWAContacts(lineId);
  // Marcar quais já existem na BD
  const existing = new Set(
    db.prepare('SELECT phone FROM contacts').all().map(r => r.phone)
  );
  const result = all.map(c => ({ ...c, already_imported: existing.has(c.phone) }));
  res.json(result);
});

// Importar contactos seleccionados da agenda WA para a BD
app.post('/whatsapp/contacts/import', authMiddleware, ownerOnly, (req, res) => {
  const { contacts } = req.body; // [{ phone, name, wa_id }]
  if (!Array.isArray(contacts) || contacts.length === 0)
    return res.status(400).json({ error: 'Lista de contactos vazia' });

  let imported = 0;
  let skipped = 0;
  const stmt = db.prepare('INSERT OR IGNORE INTO contacts (phone, name, wa_id) VALUES (?, ?, ?)');
  for (const c of contacts) {
    if (!c.phone) continue;
    const result = stmt.run(c.phone, c.name || c.phone, c.wa_id || null);
    if (result.changes > 0) imported++;
    else skipped++;
  }
  res.json({ imported, skipped });
});

// Disponibiliza o io globalmente para rotas
require('./io-instance').set(io);

// Socket.io
initSocket(io);

// WhatsApp
initWhatsApp(io);

// Cron de mensagens agendadas
startScheduledMessagesCron(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Servidor a correr em http://localhost:${PORT}`);
  // Sinaliza ao PM2 que o processo está pronto (usado com wait_ready: true)
  if (process.send) process.send('ready');
});

// Graceful shutdown — PM2 envia SIGINT no reload
process.on('SIGINT', async () => {
  console.log('[shutdown] A fechar gracefully...');
  server.close(() => {
    console.log('[shutdown] HTTP server fechado');
    process.exit(0);
  });
  // Forçar saída após 8 segundos se algo travar
  setTimeout(() => { console.log('[shutdown] Timeout — a forçar saída'); process.exit(0); }, 8000);
});
