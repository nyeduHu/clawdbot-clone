const { PERSONAS, MAX_HISTORY } = require('../config');

/**
 * Per-user conversation state.
 * Stores messages in OpenAI format: { role, content, tool_calls?, tool_call_id? }
 * @type {Map<string, { persona: string, messages: Array }>}
 */
const conversations = new Map();

/**
 * Get or create a conversation state for a user.
 * @param {string} userId
 * @returns {{ persona: string, messages: Array }}
 */
function getConversation(userId) {
  if (!conversations.has(userId)) {
    conversations.set(userId, {
      persona: 'default',
      messages: [],
    });
  }
  return conversations.get(userId);
}

/**
 * Add an OpenAI-format message to the user's history.
 * @param {string} userId
 * @param {object} message - OpenAI message object (role, content, tool_calls, etc.)
 */
function addMessage(userId, message) {
  const conv = getConversation(userId);
  conv.messages.push(message);

  // Trim history if too long (keep recent messages)
  if (conv.messages.length > MAX_HISTORY * 2) {
    conv.messages = conv.messages.slice(-MAX_HISTORY * 2);
  }
}

/**
 * Get the conversation messages for a user.
 * @param {string} userId
 * @returns {Array}
 */
function getMessages(userId) {
  return getConversation(userId).messages;
}

/**
 * Clear conversation history for a user.
 * @param {string} userId
 */
function clearHistory(userId) {
  const conv = getConversation(userId);
  conv.messages = [];
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
  conv.messages = []; // Reset history on persona change
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
  addMessage,
  getMessages,
  clearHistory,
  setPersona,
  getPersona,
  getSystemInstruction,
  getAvailablePersonas,
};
