const { getCalendar } = require('../services/google-auth');

module.exports = {
  name: 'calendar_list',
  description: 'List upcoming events from the user\'s Google Calendar. Can filter by date range.',
  parameters: {
    type: 'object',
    properties: {
      timeMin: {
        type: 'string',
        description: 'Start of time range in ISO 8601 format (e.g., "2026-02-25T00:00:00Z"). Defaults to now.',
      },
      timeMax: {
        type: 'string',
        description: 'End of time range in ISO 8601 format. Defaults to 7 days from now.',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of events to return. Defaults to 10.',
      },
      query: {
        type: 'string',
        description: 'Free text search query to filter events.',
      },
    },
  },

  async execute({ timeMin, timeMax, maxResults = 10, query }) {
    const calendar = await getCalendar();
    if (!calendar) {
      return { error: 'Google Calendar is not configured. Run `npm run auth` to set up.' };
    }

    const now = new Date();
    const params = {
      calendarId: 'primary',
      timeMin: timeMin || now.toISOString(),
      timeMax: timeMax || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      maxResults,
      singleEvents: true,
      orderBy: 'startTime',
    };

    if (query) params.q = query;

    try {
      const res = await calendar.events.list(params);
      const events = res.data.items || [];

      if (events.length === 0) {
        return { message: 'No events found in the specified time range.', events: [] };
      }

      return {
        message: `Found ${events.length} event(s).`,
        events: events.map(event => ({
          id: event.id,
          summary: event.summary || '(No title)',
          start: event.start.dateTime || event.start.date,
          end: event.end.dateTime || event.end.date,
          location: event.location || null,
          description: event.description || null,
          status: event.status,
          htmlLink: event.htmlLink,
        })),
      };
    } catch (err) {
      return { error: `Failed to list calendar events: ${err.message}` };
    }
  },
};
