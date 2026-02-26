const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '..', '..', 'bot.db');

let db = null;
let dbReady = null;
let saveTimer = null;

/**
 * Persist the in-memory database to disk.
 */
function saveToDisk() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

/**
 * Schedule a debounced save (coalesces rapid writes).
 */
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveToDisk, 500);
}

/**
 * Initialise sql.js, open (or create) the database, run schema migrations.
 * @returns {Promise<void>}
 */
function getDb() {
  if (dbReady) return dbReady;

  dbReady = (async () => {
    const SQL = await initSqlJs();

    // Load existing file or start fresh
    let buffer;
    try {
      buffer = fs.readFileSync(DB_PATH);
    } catch {}

    db = buffer ? new SQL.Database(buffer) : new SQL.Database();

    // Pragmas
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA foreign_keys = ON');

    // Schema
    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        tool_calls TEXT,
        tool_call_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        CONSTRAINT valid_role CHECK (role IN ('user', 'assistant', 'tool', 'system'))
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)');

    db.run(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY,
        persona TEXT DEFAULT 'default',
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        content TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(user_id, category)');

    saveToDisk();
    console.log('✅ Database initialized:', DB_PATH);
  })();

  return dbReady;
}

// ──────────────────────────────────────
// Helpers (all sync after init guard)
// ──────────────────────────────────────

/**
 * Run a SELECT and return all matching rows as objects.
 */
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/**
 * Run a SELECT and return the first row (or undefined).
 */
function queryGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : undefined;
  stmt.free();
  return row;
}

/**
 * Run an INSERT/UPDATE/DELETE, return { lastID, changes }.
 */
function runSql(sql, params = []) {
  db.run(sql, params);
  const lastID = db.exec('SELECT last_insert_rowid()')[0]?.values[0][0] ?? 0;
  const changes = db.exec('SELECT changes()')[0]?.values[0][0] ?? 0;
  scheduleSave();
  return { lastID, changes };
}

// ──────────────────────────────────────
// Messages
// ──────────────────────────────────────

/**
 * @param {string} userId
 * @param {object} message
 * @returns {Promise<void>}
 */
async function saveMessage(userId, message) {
  await getDb();
  runSql(
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
 * @param {string} userId
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function loadMessages(userId, limit = 100) {
  await getDb();
  const rows = queryAll(
    `SELECT role, content, tool_calls, tool_call_id FROM messages
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT ?`,
    [userId, limit],
  );

  return rows.reverse().map(row => {
    const msg = { role: row.role };

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
 * @param {string} userId
 * @returns {Promise<void>}
 */
async function deleteMessages(userId) {
  await getDb();
  runSql('DELETE FROM messages WHERE user_id = ?', [userId]);
}

// ──────────────────────────────────────
// User Settings
// ──────────────────────────────────────

/**
 * @param {string} userId
 * @returns {Promise<string>}
 */
async function getUserPersona(userId) {
  await getDb();
  const row = queryGet('SELECT persona FROM user_settings WHERE user_id = ?', [userId]);
  return row?.persona || 'default';
}

/**
 * @param {string} userId
 * @param {string} persona
 * @returns {Promise<void>}
 */
async function setUserPersona(userId, persona) {
  await getDb();
  runSql(
    `INSERT INTO user_settings (user_id, persona, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET persona = ?, updated_at = datetime('now')`,
    [userId, persona, persona],
  );
}

// ──────────────────────────────────────
// Memories
// ──────────────────────────────────────

/**
 * @param {string} userId
 * @param {string} content
 * @param {string} [category='general']
 * @returns {Promise<{ id: number }>}
 */
async function storeMemory(userId, content, category = 'general') {
  await getDb();
  const result = runSql(
    'INSERT INTO memories (user_id, category, content) VALUES (?, ?, ?)',
    [userId, category, content],
  );
  return { id: result.lastID };
}

/**
 * @param {string} userId
 * @param {string} [category]
 * @param {string} [search]
 * @param {number} [limit=20]
 * @returns {Promise<Array>}
 */
async function recallMemories(userId, category, search, limit = 20) {
  await getDb();
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

  return queryAll(query, params);
}

/**
 * @param {string} userId
 * @param {number} memoryId
 * @returns {Promise<boolean>}
 */
async function deleteMemory(userId, memoryId) {
  await getDb();
  const result = runSql('DELETE FROM memories WHERE id = ? AND user_id = ?', [memoryId, userId]);
  return result.changes > 0;
}

/**
 * @param {string} userId
 * @returns {Promise<Array>}
 */
async function getAllMemories(userId) {
  await getDb();
  return queryAll(
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
