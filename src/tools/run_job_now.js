module.exports = {
  name: 'run_job_now',
  description: 'Run a scheduled job immediately (for debugging). Requires task_id. Only the task owner can run it.',
  parameters: {
    type: 'object',
    properties: {
      task_id: { type: 'integer', description: 'ID of the scheduled task to run now' },
    },
    required: ['task_id'],
  },

  async execute(params, userId) {
    console.log(`[TOOL:run_job_now] execute() called by ${userId} for task ${params.task_id}`);
    const { runNow } = require('../services/scheduler');
    const res = await runNow(params.task_id, userId);
    console.log(`[TOOL:run_job_now] runNow returned: ${JSON.stringify(res)}`);
    return res;
  },
};
