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
    const { cancelTask } = require('../services/scheduler');
    return await cancelTask(userId, params.task_id);
  },
};
