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

  CREATE INDEX IF NOT EXISTS idx_conversations_assigned ON conversations(assigned_to);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
`);

// Migrations
try { db.exec(`ALTER TABLE users ADD COLUMN preferred_status TEXT NOT NULL DEFAULT 'online'`); } catch (_) {}
try { db.exec(`ALTER TABLE messages ADD COLUMN media_url TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE messages ADD COLUMN media_type TEXT`); } catch (_) {}

module.exports = db;
