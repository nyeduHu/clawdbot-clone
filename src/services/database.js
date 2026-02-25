const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '..', '..', 'bot.db');

let db = null;

/**
 * Get or create the SQLite database connection.
 * @returns {import('better-sqlite3').Database}
 */
function getDb() {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL'); // Better concurrent performance
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    -- Conversation messages (OpenAI format)
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      tool_calls TEXT,
      tool_call_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      CONSTRAINT valid_role CHECK (role IN ('user', 'assistant', 'tool', 'system'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

    -- Per-user persona preferences
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      persona TEXT DEFAULT 'default',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Long-term memory: key facts the bot remembers about users
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
    CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(user_id, category);
  `);

  console.log('✅ Database initialized:', DB_PATH);
  return db;
}

// ──────────────────────────────────────
// Messages
// ──────────────────────────────────────

/**
 * Save a message to the database.
 * @param {string} userId
 * @param {object} message - OpenAI message object
 */
function saveMessage(userId, message) {
  const db = getDb();
  db.prepare(`
    INSERT INTO messages (user_id, role, content, tool_calls, tool_call_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    userId,
    message.role,
    typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
    message.tool_calls ? JSON.stringify(message.tool_calls) : null,
    message.tool_call_id || null,
  );
}

/**
 * Load recent messages for a user.
 * @param {string} userId
 * @param {number} limit - Max messages to load
 * @returns {Array} OpenAI-format messages
 */
function loadMessages(userId, limit = 100) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT role, content, tool_calls, tool_call_id FROM messages
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(userId, limit);

  // Reverse to chronological order
  return rows.reverse().map(row => {
    const msg = { role: row.role };

    // Parse content back
    if (row.content !== null) {
      try {
        const parsed = JSON.parse(row.content);
        msg.content = Array.isArray(parsed) ? parsed : row.content;
      } catch {
        msg.content = row.content;
      }
    } else {
      msg.content = null;
    }

    if (row.tool_calls) {
      msg.tool_calls = JSON.parse(row.tool_calls);
    }
    if (row.tool_call_id) {
      msg.tool_call_id = row.tool_call_id;
    }

    return msg;
  });
}

/**
 * Delete all messages for a user.
 * @param {string} userId
 */
function deleteMessages(userId) {
  const db = getDb();
  db.prepare('DELETE FROM messages WHERE user_id = ?').run(userId);
}

// ──────────────────────────────────────
// User Settings
// ──────────────────────────────────────

/**
 * Get user's persona preference.
 * @param {string} userId
 * @returns {string}
 */
function getUserPersona(userId) {
  const db = getDb();
  const row = db.prepare('SELECT persona FROM user_settings WHERE user_id = ?').get(userId);
  return row?.persona || 'default';
}

/**
 * Set user's persona preference.
 * @param {string} userId
 * @param {string} persona
 */
function setUserPersona(userId, persona) {
  const db = getDb();
  db.prepare(`
    INSERT INTO user_settings (user_id, persona, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET persona = ?, updated_at = datetime('now')
  `).run(userId, persona, persona);
}

// ──────────────────────────────────────
// Memories (long-term facts)
// ──────────────────────────────────────

/**
 * Store a memory/fact about a user.
 * @param {string} userId
 * @param {string} content - The fact to remember
 * @param {string} [category='general'] - Category (e.g., 'preference', 'name', 'project')
 * @returns {{ id: number }}
 */
function storeMemory(userId, content, category = 'general') {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO memories (user_id, category, content)
    VALUES (?, ?, ?)
  `).run(userId, category, content);
  return { id: result.lastInsertRowid };
}

/**
 * Search/recall memories for a user.
 * @param {string} userId
 * @param {string} [category] - Optional category filter
 * @param {string} [search] - Optional text search
 * @param {number} [limit=20]
 * @returns {Array<{ id: number, category: string, content: string, created_at: string }>}
 */
function recallMemories(userId, category, search, limit = 20) {
  const db = getDb();
  let query = 'SELECT id, category, content, created_at FROM memories WHERE user_id = ?';
  const params = [userId];

  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  if (search) {
    query += ' AND content LIKE ?';
    params.push(`%${search}%`);
  }

  query += ' ORDER BY updated_at DESC LIMIT ?';
  params.push(limit);

  return db.prepare(query).all(...params);
}

/**
 * Delete a specific memory by ID.
 * @param {string} userId
 * @param {number} memoryId
 * @returns {boolean}
 */
function deleteMemory(userId, memoryId) {
  const db = getDb();
  const result = db.prepare('DELETE FROM memories WHERE id = ? AND user_id = ?').run(memoryId, userId);
  return result.changes > 0;
}

/**
 * Get all memories for a user (for system prompt injection).
 * @param {string} userId
 * @returns {Array<{ id: number, category: string, content: string }>}
 */
function getAllMemories(userId) {
  const db = getDb();
  return db.prepare(
    'SELECT id, category, content FROM memories WHERE user_id = ? ORDER BY category, created_at'
  ).all(userId);
}

module.exports = {
  getDb,
  saveMessage,
  loadMessages,
  deleteMessages,
  getUserPersona,
  setUserPersona,
  storeMemory,
  recallMemories,
  deleteMemory,
  getAllMemories,
};
