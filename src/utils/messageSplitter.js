const { DISCORD_MAX_LENGTH } = require('../config');

/**
 * Split a long message into chunks that fit Discord's 2000 char limit.
 * Tries to split on newlines, then on spaces, then hard-cuts.
 * @param {string} text
 * @param {number} [maxLen=2000]
 * @returns {string[]}
 */
function splitMessage(text, maxLen = DISCORD_MAX_LENGTH) {
  if (text.length <= maxLen) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf('\n', maxLen);
    if (splitIndex < maxLen * 0.3) {
      splitIndex = remaining.lastIndexOf(' ', maxLen);
    }
    if (splitIndex < maxLen * 0.3) {
      splitIndex = maxLen;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}

module.exports = { splitMessage };
