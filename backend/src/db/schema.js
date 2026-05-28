const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../../database.sqlite');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'attendant', -- 'owner' | 'attendant'
    status TEXT NOT NULL DEFAULT 'offline', -- 'online' | 'busy' | 'away' | 'offline'
    preferred_status TEXT NOT NULL DEFAULT 'online', -- last status chosen by user (never 'offline')
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    name TEXT,
    wa_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER NOT NULL REFERENCES contacts(id),
    assigned_to INTEGER REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'waiting', -- 'waiting' | 'open' | 'closed'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id),
    from_me INTEGER NOT NULL DEFAULT 0,
    sender_id INTEGER REFERENCES users(id),
    body TEXT NOT NULL DEFAULT '',
    media_url TEXT,
    media_type TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    read INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS quick_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shortcut TEXT NOT NULL UNIQUE,
    body TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#6b7280'
  );

  CREATE TABLE IF NOT EXISTS conversation_tags (
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (conversation_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS scheduled_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER REFERENCES conversations(id),
    wa_id TEXT NOT NULL,
    body TEXT NOT NULL,
    scheduled_at DATETIME NOT NULL,
    sent_at DATETIME,
    cancelled INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS transfer_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    from_user_id INTEGER REFERENCES users(id),
    to_user_id INTEGER NOT NULL REFERENCES users(id),
    transferred_by INTEGER NOT NULL REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS keyword_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT NOT NULL,
    response TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL UNIQUE,
    wa_id TEXT,
    reason TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    attendant_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#6b7280',
    is_default INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_departments (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, department_id)
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_assigned ON conversations(assigned_to);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_transfer_logs_conv ON transfer_logs(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_ratings_attendant ON ratings(attendant_id);
  CREATE INDEX IF NOT EXISTS idx_user_departments_dept ON user_departments(department_id);
`);

// Migrations
try { db.exec(`ALTER TABLE users ADD COLUMN preferred_status TEXT NOT NULL DEFAULT 'online'`); } catch (_) {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN notes TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN email TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE messages ADD COLUMN media_url TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE messages ADD COLUMN media_type TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE messages ADD COLUMN media_filename TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE messages ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
try { db.exec(`ALTER TABLE conversations ADD COLUMN tags TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE conversations ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'`); } catch (_) {}
try { db.exec(`ALTER TABLE conversations ADD COLUMN snoozed_until DATETIME`); } catch (_) {}
try { db.exec(`ALTER TABLE quick_replies ADD COLUMN category TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN on_shift INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
try { db.exec(`ALTER TABLE conversations ADD COLUMN sla_alerted_at DATETIME`); } catch (_) {}
try { db.exec(`ALTER TABLE messages ADD COLUMN wa_message_id TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE messages ADD COLUMN edited_at DATETIME`); } catch (_) {}
try { db.exec(`ALTER TABLE messages ADD COLUMN failed INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
try { db.exec(`ALTER TABLE messages ADD COLUMN reply_to_id INTEGER`); } catch (_) {}
try { db.exec(`ALTER TABLE messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
try { db.exec(`ALTER TABLE conversations ADD COLUMN awaiting_rating INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
try { db.exec(`ALTER TABLE conversations ADD COLUMN department_id INTEGER REFERENCES departments(id)`); } catch (_) {}
try { db.exec(`ALTER TABLE keyword_rules ADD COLUMN department_id INTEGER REFERENCES departments(id)`); } catch (_) {}
try { db.exec(`ALTER TABLE keyword_rules ADD COLUMN priority INTEGER NOT NULL DEFAULT 100`); } catch (_) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_department ON conversations(department_id)`); } catch (_) {}
try { db.exec(`ALTER TABLE departments ADD COLUMN sla_minutes INTEGER`); } catch (_) {}
try { db.exec(`ALTER TABLE keyword_rules ADD COLUMN tag_id INTEGER REFERENCES tags(id)`); } catch (_) {}
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#25D366',
      session_path TEXT NOT NULL UNIQUE,
      is_default INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
} catch (_) {}
try { db.exec(`ALTER TABLE conversations ADD COLUMN line_id INTEGER REFERENCES lines(id)`); } catch (_) {}
try { db.exec(`ALTER TABLE scheduled_messages ADD COLUMN line_id INTEGER REFERENCES lines(id)`); } catch (_) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_line ON conversations(line_id)`); } catch (_) {}
try { db.exec(`ALTER TABLE lines ADD COLUMN department_id INTEGER REFERENCES departments(id)`); } catch (_) {}
try { db.exec(`ALTER TABLE quick_replies ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`); } catch (_) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_quick_replies_owner ON quick_replies(owner_user_id)`); } catch (_) {}
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
  `);
} catch (_) {}

// Seed default settings
const settingsDefaults = [
  ['bot_enabled', '0'],
  ['sla_minutes', '30'],
  ['bot_message', 'Olá! No momento estamos fora do horário de atendimento. Retornaremos em breve!'],
  ['hours_0', 'closed'],          // Domingo
  ['hours_1', '08:00-18:00'],     // Segunda
  ['hours_2', '08:00-18:00'],     // Terça
  ['hours_3', '08:00-18:00'],     // Quarta
  ['hours_4', '08:00-18:00'],     // Quinta
  ['hours_5', '08:00-18:00'],     // Sexta
  ['hours_6', '09:00-13:00'],     // Sábado
  ['rating_enabled', '0'],
  ['rating_message', 'Obrigado pelo atendimento! 😊 Como avaliaria o nosso serviço?\n\nResponda apenas com um número:\n1 - 😞 Muito mau\n2 - 😕 Mau\n3 - 😐 Razoável\n4 - 😊 Bom\n5 - 😄 Excelente'],
  ['signature_enabled', '0'],
  ['signature_message', 'Olá! 😊 Meu nome é *{{nome}}* e estou aqui para ajudá-lo. Como posso ser útil?'],
  ['reopen_window_days', '1'],
];
const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
for (const [key, value] of settingsDefaults) insertSetting.run(key, value);

module.exports = db;

// Migracao: bot de triagem por linha
try {
  db.exec(`CREATE TABLE IF NOT EXISTS line_bot_settings (
    line_id INTEGER PRIMARY KEY REFERENCES lines(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    hours_0 TEXT DEFAULT 'closed',
    hours_1 TEXT DEFAULT '07:00-18:00',
    hours_2 TEXT DEFAULT '07:00-18:00',
    hours_3 TEXT DEFAULT '07:00-18:00',
    hours_4 TEXT DEFAULT '07:00-18:00',
    hours_5 TEXT DEFAULT '07:00-18:00',
    hours_6 TEXT DEFAULT '07:00-12:00'
  )`);
  // Migrar config global existente para a linha 1 (Help Desk)
  const existingBot = db.prepare("SELECT id FROM line_bot_settings WHERE line_id = 1").get();
  if (!existingBot) {
    const enabled = db.prepare("SELECT value FROM settings WHERE key = 'bot_enabled'").get()?.value || '0';
    const message = db.prepare("SELECT value FROM settings WHERE key = 'bot_message'").get()?.value || '';
    const getH = (k) => db.prepare("SELECT value FROM settings WHERE key = ?").get(k)?.value || 'closed';
    db.prepare(`INSERT OR IGNORE INTO line_bot_settings
      (line_id, enabled, message, hours_0, hours_1, hours_2, hours_3, hours_4, hours_5, hours_6)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        enabled === '1' ? 1 : 0, message,
        getH('hours_0'), getH('hours_1'), getH('hours_2'), getH('hours_3'),
        getH('hours_4'), getH('hours_5'), getH('hours_6')
      );
  }
} catch (_) {}

// Migração: etiquetas por departamento
try { db.exec(`ALTER TABLE tags ADD COLUMN department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE`); } catch (_) {}

// Migração: tabelas do chat interno (threads, members, messages, reactions)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS internal_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'channel',
      name TEXT,
      department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS internal_thread_members (
      thread_id INTEGER NOT NULL REFERENCES internal_threads(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      muted INTEGER NOT NULL DEFAULT 0,
      last_read_message_id INTEGER,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (thread_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS internal_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL REFERENCES internal_threads(id) ON DELETE CASCADE,
      from_user_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL DEFAULT '',
      media_url TEXT,
      media_type TEXT,
      media_filename TEXT,
      reply_to_id INTEGER REFERENCES internal_messages(id),
      edited INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS internal_reactions (
      message_id INTEGER NOT NULL REFERENCES internal_messages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (message_id, user_id, emoji)
    );
    CREATE INDEX IF NOT EXISTS idx_internal_messages_thread ON internal_messages(thread_id);
    CREATE INDEX IF NOT EXISTS idx_internal_thread_members_user ON internal_thread_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_internal_reactions_msg ON internal_reactions(message_id);
  `);
} catch (_) {}

// Seed do canal "Geral" com todos os utilizadores activos
try {
  const generalExists = db.prepare("SELECT id FROM internal_threads WHERE type = 'channel' AND name = 'Geral'").get();
  if (!generalExists) {
    const ownerRow = db.prepare("SELECT id FROM users WHERE role = 'owner' LIMIT 1").get();
    if (ownerRow) {
      const r = db.prepare("INSERT INTO internal_threads (type, name, created_by) VALUES ('channel', 'Geral', ?)").run(ownerRow.id);
      const threadId = r.lastInsertRowid;
      const allUsers = db.prepare("SELECT id FROM users WHERE active = 1").all();
      const addMember = db.prepare("INSERT OR IGNORE INTO internal_thread_members (thread_id, user_id) VALUES (?, ?)");
      for (const u of allUsers) addMember.run(threadId, u.id);
    }
  }
} catch (_) {}

// Migração: histórico de disparos em massa (broadcast logs)
try {
  db.exec(`CREATE TABLE IF NOT EXISTS broadcast_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_name TEXT,
    line_id INTEGER,
    line_name TEXT,
    message TEXT,
    total INTEGER DEFAULT 0,
    sent INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME
  )`);
} catch (_) {}

// Migração: status da mensagem outbound no WhatsApp.
// Valores: 0=pending, 2=server_ack, 3=delivered, 4=read, 5=played
// Reflete ACKs vindos via Baileys messages.update — só interessa para from_me=1.
try { db.exec(`ALTER TABLE messages ADD COLUMN wa_status INTEGER NOT NULL DEFAULT 0`); } catch (_) {}

// Migração: reacções em mensagens WhatsApp (JSON serializado).
// Formato: [{ emoji: '👍', users: [{id:1,name:'Sávio'}|{id:null,name:'Cliente'}], count: 2 }]
// id:null representa o contacto externo (cliente WhatsApp).
try { db.exec(`ALTER TABLE messages ADD COLUMN reactions TEXT`); } catch (_) {}

// Migração: contactos têm autor (quem os criou) para audit/LGPD.
// Pode ser NULL para contactos criados antes desta migração ou via inbound.
try { db.exec(`ALTER TABLE contacts ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL`); } catch (_) {}

// Migração: sentiment analysis. anger_score acumula msgs negativas seguidas
// do cliente. >= 2 mostra flag visual "😡 Irritado" na ConversationList.
try { db.exec(`ALTER TABLE conversations ADD COLUMN anger_score INTEGER NOT NULL DEFAULT 0`); } catch (_) {}

// Migração: Bot FAQ semântico. Items com pergunta canónica + resposta +
// variações (frases parecidas, uma por linha). Activa por dept (NULL = todos).
try {
  db.exec(`CREATE TABLE IF NOT EXISTS faq_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    variations TEXT,
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    active INTEGER NOT NULL DEFAULT 1,
    hit_count INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_faq_dept ON faq_items(department_id);
  CREATE INDEX IF NOT EXISTS idx_faq_active ON faq_items(active);`);
} catch (_) {}
// Flag em conversations para não responder FAQ duas vezes na mesma conv.
try { db.exec(`ALTER TABLE conversations ADD COLUMN faq_responded INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
