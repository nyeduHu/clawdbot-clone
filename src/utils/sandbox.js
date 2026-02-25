const path = require('path');
const fs = require('fs');
const { SANDBOX_ROOT } = require('../config');

// Ensure sandbox directory exists
if (!fs.existsSync(SANDBOX_ROOT)) {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
}

/**
 * Resolve a user-provided path to an absolute path within the sandbox.
 * Prevents path traversal attacks.
 * @param {string} userPath - The user/bot-provided relative path
 * @returns {string} Absolute path guaranteed to be within SANDBOX_ROOT
 * @throws {Error} If the path escapes the sandbox
 */
function safePath(userPath) {
  if (!userPath || typeof userPath !== 'string') {
    throw new Error('Invalid path: must be a non-empty string');
  }

  // Reject null bytes
  if (userPath.includes('\0')) {
    throw new Error('Invalid path: null bytes not allowed');
  }

  // Resolve to absolute path within sandbox
  const resolved = path.resolve(SANDBOX_ROOT, userPath);

  // Check prefix (with trailing separator to prevent /workspace2 matching /workspace)
  const sandboxWithSep = SANDBOX_ROOT.endsWith(path.sep)
    ? SANDBOX_ROOT
    : SANDBOX_ROOT + path.sep;

  if (resolved !== SANDBOX_ROOT && !resolved.startsWith(sandboxWithSep)) {
    throw new Error(`Path traversal blocked: "${userPath}" resolves outside the sandbox`);
  }

  return resolved;
}

/**
 * Same as safePath but also resolves symlinks.
 * Use this for operations that follow symlinks (read, write).
 * @param {string} userPath
 * @returns {string}
 */
function safeRealPath(userPath) {
  const resolved = safePath(userPath);

  // If file exists, resolve symlinks and re-check
  if (fs.existsSync(resolved)) {
    const real = fs.realpathSync(resolved);
    const sandboxWithSep = SANDBOX_ROOT.endsWith(path.sep)
      ? SANDBOX_ROOT
      : SANDBOX_ROOT + path.sep;

    if (real !== SANDBOX_ROOT && !real.startsWith(sandboxWithSep)) {
      throw new Error(`Symlink traversal blocked: "${userPath}" points outside the sandbox`);
    }
    return real;
  }

  return resolved;
}

module.exports = { safePath, safeRealPath, SANDBOX_ROOT };
