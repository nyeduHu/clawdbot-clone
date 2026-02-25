const { PERSONAS, MAX_HISTORY } = require('../config');
const {
  saveMessage,
  loadMessages,
  deleteMessages,
  getUserPersona,
  setUserPersona,
  getAllMemories,
} = require('./database');

/**
 * In-memory cache of loaded conversations (to avoid re-reading DB every call).
 * @type {Map<string, Array>}
 */
const messageCache = new Map();

/**
 * Add an OpenAI-format message to the user's history.
 * Persists to SQLite and keeps in-memory cache.
 * @param {string} userId
 * @param {object} message - OpenAI message object (role, content, tool_calls, etc.)
 */
function addMessage(userId, message) {
  // Save to database
  saveMessage(userId, message);

  // Update cache
  if (!messageCache.has(userId)) {
    messageCache.set(userId, []);
  }
  const cached = messageCache.get(userId);
  cached.push(message);

  // Trim cache if too long
  if (cached.length > MAX_HISTORY * 2) {
    messageCache.set(userId, cached.slice(-MAX_HISTORY * 2));
  }
}

/**
 * Get the conversation messages for a user.
 * Loads from DB on first access, then uses cache.
 * @param {string} userId
 * @returns {Array}
 */
function getMessages(userId) {
  if (!messageCache.has(userId)) {
    // Load from database (last MAX_HISTORY*2 messages)
    const messages = loadMessages(userId, MAX_HISTORY * 2);
    messageCache.set(userId, messages);
  }
  return messageCache.get(userId);
}

/**
 * Clear conversation history for a user.
 * Clears both DB and cache.
 * @param {string} userId
 */
function clearHistory(userId) {
  deleteMessages(userId);
  messageCache.set(userId, []);
}

/**
 * Set the active persona for a user.
 * Persists to DB. Clears history on persona change.
 * @param {string} userId
 * @param {string} personaName
 * @returns {boolean} Whether the persona exists
 */
function setPersona(userId, personaName) {
  if (!PERSONAS[personaName]) return false;
  setUserPersona(userId, personaName);
  clearHistory(userId);
  return true;
}

/**
 * Get the active persona name for a user (from DB).
 * @param {string} userId
 * @returns {string}
 */
function getPersona(userId) {
  return getUserPersona(userId);
}

/**
 * Get the system instruction text for a user's active persona.
 * Includes any stored memories about the user.
 * @param {string} userId
 * @returns {string}
 */
function getSystemInstruction(userId) {
  const personaName = getPersona(userId);
  let instruction = PERSONAS[personaName] || PERSONAS.default;

  // Inject long-term memories into the system prompt
  const memories = getAllMemories(userId);
  if (memories.length > 0) {
    const memoryLines = memories.map(m => `- [${m.category}] ${m.content}`).join('\n');
    instruction += `\n\n## Known facts about this user (from long-term memory):\n${memoryLines}`;
  }

  return instruction;
}

/**
 * Get all available persona names.
 * @returns {string[]}
 */
function getAvailablePersonas() {
  return Object.keys(PERSONAS);
}

module.exports = {
  addMessage,
  getMessages,
  clearHistory,
  setPersona,
  getPersona,
  getSystemInstruction,
  getAvailablePersonas,
};
