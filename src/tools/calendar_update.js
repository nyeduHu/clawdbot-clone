const { getCalendar } = require('../services/google-auth');

module.exports = {
  name: 'calendar_update',
  description: 'Update an existing event on the user\'s Google Calendar. Only the provided fields will be changed.',
  parameters: {
    type: 'object',
    properties: {
      eventId: {
        type: 'string',
        description: 'The ID of the event to update (obtained from calendar_list).',
      },
      summary: {
        type: 'string',
        description: 'New title for the event.',
      },
      startDateTime: {
        type: 'string',
        description: 'New start date/time in ISO 8601 format.',
      },
      endDateTime: {
        type: 'string',
        description: 'New end date/time in ISO 8601 format.',
      },
      description: {
        type: 'string',
        description: 'New description for the event.',
      },
      location: {
        type: 'string',
        description: 'New location for the event.',
      },
    },
    required: ['eventId'],
  },

  async execute({ eventId, summary, startDateTime, endDateTime, description, location }) {
    const calendar = await getCalendar();
    if (!calendar) {
      return { error: 'Google Calendar is not configured. Run `npm run auth` to set up.' };
    }

    const patchBody = {};
    if (summary !== undefined) patchBody.summary = summary;
    if (description !== undefined) patchBody.description = description;
    if (location !== undefined) patchBody.location = location;
    if (startDateTime !== undefined) patchBody.start = { dateTime: startDateTime };
    if (endDateTime !== undefined) patchBody.end = { dateTime: endDateTime };

    try {
      const res = await calendar.events.patch({
        calendarId: 'primary',
        eventId,
        requestBody: patchBody,
      });

      return {
        message: 'Event updated successfully.',
        event: {
          id: res.data.id,
          summary: res.data.summary,
          start: res.data.start.dateTime || res.data.start.date,
          end: res.data.end.dateTime || res.data.end.date,
          htmlLink: res.data.htmlLink,
        },
      };
    } catch (err) {
      return { error: `Failed to update event: ${err.message}` };
    }
  },
};
