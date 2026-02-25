const { getCalendar } = require('../services/google-auth');

module.exports = {
  name: 'calendar_delete',
  description: 'Delete an event from the user\'s Google Calendar by its event ID.',
  parameters: {
    type: 'object',
    properties: {
      eventId: {
        type: 'string',
        description: 'The ID of the event to delete (obtained from calendar_list).',
      },
    },
    required: ['eventId'],
  },

  async execute({ eventId }) {
    const calendar = await getCalendar();
    if (!calendar) {
      return { error: 'Google Calendar is not configured. Run `npm run auth` to set up.' };
    }

    try {
      await calendar.events.delete({
        calendarId: 'primary',
        eventId,
      });

      return { message: `Event ${eventId} deleted successfully.` };
    } catch (err) {
      return { error: `Failed to delete event: ${err.message}` };
    }
  },
};
