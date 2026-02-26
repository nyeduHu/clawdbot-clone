module.exports = {
  name: 'schedule_task',
  description:
    'Schedule a recurring task. The bot will automatically perform the described task at the specified times and post the result in the current channel. Use standard 5-field cron expressions (minute hour day month weekday). Examples: "0 2 * * *" = 2 AM daily, "0 9 * * 1" = 9 AM every Monday, "*/30 * * * *" = every 30 minutes, "0 14 * * 1-5" = 2 PM weekdays.',
  parameters: {
    type: 'object',
    properties: {
      cron_expression: {
        type: 'string',
        description: 'Cron expression for when to run (e.g., "0 2 * * *" for 2 AM daily).',
      },
      task_description: {
        type: 'string',
        description: 'What the bot should do each time the task runs. Be specific and detailed.',
      },
    },
    required: ['cron_expression', 'task_description'],
  },

  async execute(params, userId, channelId) {
    console.log(`[TOOL:schedule_task] execute() called`);
    console.log(`[TOOL:schedule_task]   params=${JSON.stringify(params)}`);
    console.log(`[TOOL:schedule_task]   userId=${userId}`);
    console.log(`[TOOL:schedule_task]   channelId=${channelId}`);
    
    if (!channelId) {
      console.log(`[TOOL:schedule_task] ❌ channelId is falsy! Cannot schedule.`);
      return { error: 'Cannot schedule a task without a channel context.' };
    }

    const { scheduleTask } = require('../services/scheduler');
    console.log(`[TOOL:schedule_task] Calling scheduleTask()...`);
    const result = await scheduleTask(userId, channelId, params.cron_expression, params.task_description);
    console.log(`[TOOL:schedule_task] scheduleTask() returned:`, JSON.stringify(result));

    if (result.error) {
      console.log(`[TOOL:schedule_task] ❌ Error from scheduleTask: ${result.error}`);
      return { error: result.error };
    }

    const response = {
      success: true,
      taskId: result.id,
      schedule: result.cronExpression,
      description: result.description,
      message: `Task #${result.id} scheduled! It will run on cron "${result.cronExpression}" in this channel.`,
    };
    console.log(`[TOOL:schedule_task] ✅ Returning success:`, JSON.stringify(response));
    return response;
  },
};
