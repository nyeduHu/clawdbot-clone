const { getCalendar } = require('../services/google-auth');

module.exports = {
  name: 'calendar_create',
  description: 'Create a new event on the user\'s Google Calendar.',
  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'Title/name of the event.',
      },
      startDateTime: {
        type: 'string',
        description: 'Start date/time in ISO 8601 format (e.g., "2026-02-25T14:00:00+01:00").',
      },
      endDateTime: {
        type: 'string',
        description: 'End date/time in ISO 8601 format.',
      },
      description: {
        type: 'string',
        description: 'Description/notes for the event.',
      },
      location: {
        type: 'string',
        description: 'Location of the event.',
      },
      allDay: {
        type: 'boolean',
        description: 'If true, create an all-day event. Use startDate/endDate format (YYYY-MM-DD).',
      },
    },
    required: ['summary', 'startDateTime', 'endDateTime'],
  },

  async execute({ summary, startDateTime, endDateTime, description, location, allDay }) {
    const calendar = await getCalendar();
    if (!calendar) {
      return { error: 'Google Calendar is not configured. Run `npm run auth` to set up.' };
    }

    const event = {
      summary,
      description: description || undefined,
      location: location || undefined,
    };

    if (allDay) {
      // All-day events use date (YYYY-MM-DD) not dateTime
      event.start = { date: startDateTime.split('T')[0] };
      event.end = { date: endDateTime.split('T')[0] };
    } else {
      event.start = { dateTime: startDateTime };
      event.end = { dateTime: endDateTime };
    }

    try {
      const res = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
      });

      return {
        message: 'Event created successfully.',
        event: {
          id: res.data.id,
          summary: res.data.summary,
          start: res.data.start.dateTime || res.data.start.date,
          end: res.data.end.dateTime || res.data.end.date,
          htmlLink: res.data.htmlLink,
        },
      };
    } catch (err) {
      return { error: `Failed to create event: ${err.message}` };
    }
  },
};
