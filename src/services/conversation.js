const { PERSONAS, MAX_HISTORY } = require('../config');

/**
 * Per-user conversation state.
 * @type {Map<string, { persona: string, history: Array<{ role: string, parts: Array }> }>}
 */
const conversations = new Map();

/**
 * Get or create a conversation state for a user.
 * @param {string} userId
 * @returns {{ persona: string, history: Array }}
 */
function getConversation(userId) {
  if (!conversations.has(userId)) {
    conversations.set(userId, {
      persona: 'default',
      history: [],
    });
  }
  return conversations.get(userId);
}

/**
 * Add a message to the user's history.
 * @param {string} userId
 * @param {'user' | 'model'} role
 * @param {Array} parts - Content parts (text, images, function calls, etc.)
 */
function addToHistory(userId, role, parts) {
  const conv = getConversation(userId);
  conv.history.push({ role, parts });

  // Trim history if too long (keep recent turns)
  if (conv.history.length > MAX_HISTORY * 2) {
    // Keep at least the last MAX_HISTORY exchanges
    conv.history = conv.history.slice(-MAX_HISTORY * 2);
  }
}

/**
 * Get the conversation history for a user.
 * @param {string} userId
 * @returns {Array<{ role: string, parts: Array }>}
 */
function getHistory(userId) {
  return getConversation(userId).history;
}

/**
 * Clear conversation history for a user.
 * @param {string} userId
 */
function clearHistory(userId) {
  const conv = getConversation(userId);
  conv.history = [];
}

/**
 * Set the active persona for a user.
 * @param {string} userId
 * @param {string} personaName
 * @returns {boolean} Whether the persona exists
 */
function setPersona(userId, personaName) {
  if (!PERSONAS[personaName]) return false;
  const conv = getConversation(userId);
  conv.persona = personaName;
  conv.history = []; // Reset history on persona change
  return true;
}

/**
 * Get the active persona name for a user.
 * @param {string} userId
 * @returns {string}
 */
function getPersona(userId) {
  return getConversation(userId).persona;
}

/**
 * Get the system instruction text for a user's active persona.
 * @param {string} userId
 * @returns {string}
 */
function getSystemInstruction(userId) {
  const personaName = getPersona(userId);
  return PERSONAS[personaName] || PERSONAS.default;
}

/**
 * Get all available persona names.
 * @returns {string[]}
 */
function getAvailablePersonas() {
  return Object.keys(PERSONAS);
}

module.exports = {
  getConversation,
  addToHistory,
  getHistory,
  clearHistory,
  setPersona,
  getPersona,
  getSystemInstruction,
  getAvailablePersonas,
};
