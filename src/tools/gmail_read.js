const { getGmail } = require('../services/google-auth');

module.exports = {
  name: 'gmail_read',
  description: 'Read the full content of a specific email by its message ID (obtained from gmail_list).',
  parameters: {
    type: 'object',
    properties: {
      messageId: {
        type: 'string',
        description: 'The Gmail message ID to read.',
      },
    },
    required: ['messageId'],
  },

  async execute({ messageId }) {
    const gmail = await getGmail();
    if (!gmail) {
      return { error: 'Gmail is not configured. Run `npm run auth` to set up.' };
    }

    try {
      const res = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      const headers = res.data.payload.headers;
      const getHeader = (name) => headers.find(h => h.name === name)?.value || '';

      const body = extractBody(res.data.payload);

      return {
        id: res.data.id,
        threadId: res.data.threadId,
        from: getHeader('From'),
        to: getHeader('To'),
        subject: getHeader('Subject'),
        date: getHeader('Date'),
        body: body || res.data.snippet || '(No body content)',
        labelIds: res.data.labelIds,
      };
    } catch (err) {
      return { error: `Failed to read email: ${err.message}` };
    }
  },
};

/**
 * Recursively extract the text body from a Gmail message payload.
 * Prefers text/plain, falls back to text/html (stripped).
 */
function extractBody(payload) {
  if (!payload) return '';

  // Direct body
  if (payload.body && payload.body.data) {
    const decoded = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
    if (payload.mimeType === 'text/plain') return decoded;
    if (payload.mimeType === 'text/html') return stripHtml(decoded);
  }

  // Multipart — search parts
  if (payload.parts && payload.parts.length > 0) {
    // First try text/plain
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
    }

    // Then try text/html
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = Buffer.from(part.body.data, 'base64url').toString('utf-8');
        return stripHtml(html);
      }
    }

    // Recurse into nested parts
    for (const part of payload.parts) {
      const result = extractBody(part);
      if (result) return result;
    }
  }

  return '';
}

/**
 * Basic HTML tag stripping.
 */
function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
