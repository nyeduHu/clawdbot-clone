module.exports = {
  name: 'remove_task',
  description: 'Cancel and remove a scheduled recurring task by its ID. Use list_tasks first to see task IDs.',
  parameters: {
    type: 'object',
    properties: {
      task_id: {
        type: 'integer',
        description: 'The ID of the task to remove.',
      },
    },
    required: ['task_id'],
  },

  async execute(params, userId) {
    console.log(`[TOOL:remove_task] execute() called: userId=${userId}, task_id=${params.task_id}`);
    const { cancelTask } = require('../services/scheduler');
    const result = await cancelTask(userId, params.task_id);
    console.log(`[TOOL:remove_task] cancelTask returned:`, JSON.stringify(result));
    return result;
  },
};
