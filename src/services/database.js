const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.resolve(__dirname, '..', '..', 'bot.db');

let db = null;

/** Promise that resolves once the schema is ready. */
let dbReady = null;

/**
 * Get or create the SQLite database connection.
 * Returns a promise that resolves to the db instance once schema is set up.
 * @returns {Promise<sqlite3.Database>}
 */
function getDb() {
  if (dbReady) return dbReady;

  dbReady = new Promise((resolve, reject) => {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) return reject(err);

      // Enable WAL and foreign keys
      db.run('PRAGMA journal_mode = WAL', () => {
        db.run('PRAGMA foreign_keys = ON', () => {
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
          `, (execErr) => {
            if (execErr) return reject(execErr);
            console.log('✅ Database initialized:', DB_PATH);
            resolve(db);
          });
        });
      });
    });
  });

  return dbReady;
}

// ──────────────────────────────────────
// Promise helpers
// ──────────────────────────────────────

/** Run an INSERT/UPDATE/DELETE and resolve with { lastID, changes }. */
function dbRun(sql, params = []) {
  return getDb().then(db => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  }));
}

/** Run a SELECT and resolve with all rows. */
function dbAll(sql, params = []) {
  return getDb().then(db => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  }));
}

/** Run a SELECT and resolve with the first row (or undefined). */
function dbGet(sql, params = []) {
  return getDb().then(db => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  }));
}

// ──────────────────────────────────────
// Messages
// ──────────────────────────────────────

/**
 * Save a message to the database.
 * @param {string} userId
 * @param {object} message - OpenAI message object
 * @returns {Promise<void>}
 */
async function saveMessage(userId, message) {
  await dbRun(
    `INSERT INTO messages (user_id, role, content, tool_calls, tool_call_id)
     VALUES (?, ?, ?, ?, ?)`,
    [
      userId,
      message.role,
      typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
      message.tool_calls ? JSON.stringify(message.tool_calls) : null,
      message.tool_call_id || null,
    ],
  );
}

/**
 * Load recent messages for a user.
 * @param {string} userId
 * @param {number} limit - Max messages to load
 * @returns {Promise<Array>} OpenAI-format messages
 */
async function loadMessages(userId, limit = 100) {
  const rows = await dbAll(
    `SELECT role, content, tool_calls, tool_call_id FROM messages
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT ?`,
    [userId, limit],
  );

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
 * @returns {Promise<void>}
 */
async function deleteMessages(userId) {
  await dbRun('DELETE FROM messages WHERE user_id = ?', [userId]);
}

// ──────────────────────────────────────
// User Settings
// ──────────────────────────────────────

/**
 * Get user's persona preference.
 * @param {string} userId
 * @returns {Promise<string>}
 */
async function getUserPersona(userId) {
  const row = await dbGet('SELECT persona FROM user_settings WHERE user_id = ?', [userId]);
  return row?.persona || 'default';
}

/**
 * Set user's persona preference.
 * @param {string} userId
 * @param {string} persona
 * @returns {Promise<void>}
 */
async function setUserPersona(userId, persona) {
  await dbRun(
    `INSERT INTO user_settings (user_id, persona, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET persona = ?, updated_at = datetime('now')`,
    [userId, persona, persona],
  );
}

// ──────────────────────────────────────
// Memories (long-term facts)
// ──────────────────────────────────────

/**
 * Store a memory/fact about a user.
 * @param {string} userId
 * @param {string} content - The fact to remember
 * @param {string} [category='general'] - Category (e.g., 'preference', 'name', 'project')
 * @returns {Promise<{ id: number }>}
 */
async function storeMemory(userId, content, category = 'general') {
  const result = await dbRun(
    'INSERT INTO memories (user_id, category, content) VALUES (?, ?, ?)',
    [userId, category, content],
  );
  return { id: result.lastID };
}

/**
 * Search/recall memories for a user.
 * @param {string} userId
 * @param {string} [category] - Optional category filter
 * @param {string} [search] - Optional text search
 * @param {number} [limit=20]
 * @returns {Promise<Array<{ id: number, category: string, content: string, created_at: string }>>}
 */
async function recallMemories(userId, category, search, limit = 20) {
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

  return dbAll(query, params);
}

/**
 * Delete a specific memory by ID.
 * @param {string} userId
 * @param {number} memoryId
 * @returns {Promise<boolean>}
 */
async function deleteMemory(userId, memoryId) {
  const result = await dbRun('DELETE FROM memories WHERE id = ? AND user_id = ?', [memoryId, userId]);
  return result.changes > 0;
}

/**
 * Get all memories for a user (for system prompt injection).
 * @param {string} userId
 * @returns {Promise<Array<{ id: number, category: string, content: string }>>}
 */
async function getAllMemories(userId) {
  return dbAll(
    'SELECT id, category, content FROM memories WHERE user_id = ? ORDER BY category, created_at',
    [userId],
  );
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
