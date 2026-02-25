const { getGmail } = require('../services/google-auth');

module.exports = {
  name: 'gmail_list',
  description: 'Search and list emails from the user\'s Gmail inbox. Uses Gmail search query syntax (same as the Gmail search bar).',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Gmail search query (e.g., "from:alice@example.com", "subject:invoice", "is:unread", "after:2026/01/01"). Leave empty for recent emails.',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of emails to return. Defaults to 10.',
      },
    },
  },

  async execute({ query = '', maxResults = 10 }) {
    const gmail = await getGmail();
    if (!gmail) {
      return { error: 'Gmail is not configured. Run `npm run auth` to set up.' };
    }

    try {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: query || undefined,
        maxResults,
      });

      const messages = res.data.messages || [];
      if (messages.length === 0) {
        return { message: 'No emails found matching the query.', emails: [] };
      }

      // Fetch metadata for each message
      const emails = await Promise.all(
        messages.map(async (msg) => {
          const detail = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['From', 'To', 'Subject', 'Date'],
          });

          const headers = detail.data.payload.headers;
          const getHeader = (name) => headers.find(h => h.name === name)?.value || '';

          return {
            id: msg.id,
            threadId: msg.threadId,
            from: getHeader('From'),
            to: getHeader('To'),
            subject: getHeader('Subject'),
            date: getHeader('Date'),
            snippet: detail.data.snippet,
            labelIds: detail.data.labelIds,
          };
        })
      );

      return {
        message: `Found ${emails.length} email(s).`,
        emails,
      };
    } catch (err) {
      return { error: `Failed to list emails: ${err.message}` };
    }
  },
};
