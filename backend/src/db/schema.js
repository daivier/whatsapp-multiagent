const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../../../database.sqlite'));

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

  CREATE INDEX IF NOT EXISTS idx_conversations_assigned ON conversations(assigned_to);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_transfer_logs_conv ON transfer_logs(conversation_id);
`);

// Migrations
try { db.exec(`ALTER TABLE users ADD COLUMN preferred_status TEXT NOT NULL DEFAULT 'online'`); } catch (_) {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN notes TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN email TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE messages ADD COLUMN media_url TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE messages ADD COLUMN media_type TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE messages ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
try { db.exec(`ALTER TABLE conversations ADD COLUMN tags TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE conversations ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'`); } catch (_) {}
try { db.exec(`ALTER TABLE conversations ADD COLUMN snoozed_until DATETIME`); } catch (_) {}
try { db.exec(`ALTER TABLE quick_replies ADD COLUMN category TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN on_shift INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
try { db.exec(`ALTER TABLE conversations ADD COLUMN sla_alerted_at DATETIME`); } catch (_) {}

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
];
const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
for (const [key, value] of settingsDefaults) insertSetting.run(key, value);

module.exports = db;
