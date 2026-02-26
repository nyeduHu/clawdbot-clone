module.exports = {
  name: 'list_tasks',
  description: 'List all scheduled recurring tasks for the current user.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },

  async execute(params, userId) {
    console.log(`[TOOL:list_tasks] execute() called for userId=${userId}`);
    const { listTasks } = require('../services/scheduler');
    const tasks = await listTasks(userId);
    console.log(`[TOOL:list_tasks] Got ${tasks.length} task(s)`);

    if (!tasks.length) {
      console.log(`[TOOL:list_tasks] No tasks found for user`);
      return { message: 'You have no scheduled tasks.' };
    }

    const result = {
      tasks: tasks.map(t => ({
        id: t.id,
        schedule: t.cron_expression,
        description: t.task_description,
        channel: t.channel_id,
        created: t.created_at,
      })),
    };
    console.log(`[TOOL:list_tasks] Returning:`, JSON.stringify(result));
    return result;
  },
};
