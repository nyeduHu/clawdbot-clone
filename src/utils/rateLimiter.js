const { RATE_LIMIT } = require('../config');

// Map<userId, number[]> — sliding window of request timestamps
const userWindows = new Map();

/**
 * Check if a user is rate-limited.
 * @param {string} userId
 * @returns {{ limited: boolean, retryAfterMs: number }}
 */
function checkRateLimit(userId) {
  const now = Date.now();
  const timestamps = userWindows.get(userId) || [];

  // Remove timestamps outside the window
  const validTimestamps = timestamps.filter(t => now - t < RATE_LIMIT.windowMs);

  if (validTimestamps.length >= RATE_LIMIT.maxRequests) {
    const oldestInWindow = validTimestamps[0];
    const retryAfterMs = RATE_LIMIT.windowMs - (now - oldestInWindow);
    return { limited: true, retryAfterMs };
  }

  // Record this request
  validTimestamps.push(now);
  userWindows.set(userId, validTimestamps);

  return { limited: false, retryAfterMs: 0 };
}

/**
 * Reset rate limit for a user (admin use).
 * @param {string} userId
 */
function resetRateLimit(userId) {
  userWindows.delete(userId);
}

module.exports = { checkRateLimit, resetRateLimit };
