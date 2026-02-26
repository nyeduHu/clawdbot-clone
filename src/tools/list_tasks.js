module.exports = {
  name: 'list_tasks',
  description: 'List all scheduled recurring tasks for the current user.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },

  async execute(params, userId) {
    const { listTasks } = require('../services/scheduler');
    const tasks = await listTasks(userId);

    if (!tasks.length) {
      return { message: 'You have no scheduled tasks.' };
    }

    return {
      tasks: tasks.map(t => ({
        id: t.id,
        schedule: t.cron_expression,
        description: t.task_description,
        channel: t.channel_id,
        created: t.created_at,
      })),
    };
  },
};
