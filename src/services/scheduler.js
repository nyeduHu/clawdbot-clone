const cron = require('node-cron');
const {
  getAllScheduledTasks,
  addScheduledTask,
  getScheduledTasksByUser,
  removeScheduledTask,
} = require('./database');
const { splitMessage } = require('../utils/messageSplitter');

/** @type {Map<number, import('node-cron').ScheduledTask>} */
const activeJobs = new Map();

/** @type {import('discord.js').Client | null} */
let discordClient = null;

/**
 * Set the Discord client reference (called from index.js to avoid circular deps).
 * @param {import('discord.js').Client} client
 */
function setClient(client) {
  discordClient = client;
}

/**
 * Start a single cron job for a task row.
 */
function startJob(task) {
  if (!cron.validate(task.cron_expression)) {
    console.error(`❌ Invalid cron for task #${task.id}: ${task.cron_expression}`);
    return;
  }

  const job = cron.schedule(task.cron_expression, async () => {
    console.log(`⏰ Running scheduled task #${task.id}: "${task.task_description}"`);

    if (!discordClient) {
      console.error(`❌ Task #${task.id}: Discord client not available`);
      return;
    }

    try {
      const channel = await discordClient.channels.fetch(task.channel_id);
      if (!channel || !channel.send) {
        console.error(`❌ Task #${task.id}: Channel ${task.channel_id} not found or not text-based`);
        return;
      }

      // Lazy-require to avoid circular dependency
      const { processMessage } = require('./gemini');

      const prompt = `[SCHEDULED TASK] Perform the following task and post the result:\n\n${task.task_description}`;
      const result = await processMessage(task.user_id, prompt, [], task.channel_id);

      if (result && result.trim()) {
        const chunks = splitMessage(result);
        for (const chunk of chunks) {
          await channel.send(chunk);
        }
      }
    } catch (err) {
      console.error(`❌ Scheduled task #${task.id} failed:`, err.message);
    }
  });

  activeJobs.set(task.id, job);
  console.log(`⏰ Task #${task.id} scheduled: "${task.cron_expression}" → "${task.task_description.slice(0, 60)}"`);
}

/**
 * Initialise the scheduler: load all saved tasks from DB and start their cron jobs.
 */
async function init() {
  const tasks = await getAllScheduledTasks();
  for (const task of tasks) {
    startJob(task);
  }
  console.log(`⏰ Scheduler loaded ${tasks.length} task(s)`);
}

/**
 * Schedule a new recurring task.
 * @param {string} userId
 * @param {string} channelId
 * @param {string} cronExpression
 * @param {string} description
 * @returns {Promise<{ id: number } | { error: string }>}
 */
async function scheduleTask(userId, channelId, cronExpression, description) {
  if (!cron.validate(cronExpression)) {
    return { error: `Invalid cron expression: "${cronExpression}". Use standard 5-field cron (minute hour day month weekday). Examples: "0 2 * * *" = 2 AM daily, "0 9 * * 1" = 9 AM every Monday.` };
  }

  const { id } = await addScheduledTask(userId, channelId, cronExpression, description);
  startJob({ id, user_id: userId, channel_id: channelId, cron_expression: cronExpression, task_description: description });

  return { id, cronExpression, description };
}

/**
 * List tasks for a user.
 * @param {string} userId
 * @returns {Promise<Array>}
 */
async function listTasks(userId) {
  return getScheduledTasksByUser(userId);
}

/**
 * Remove a task.
 * @param {string} userId
 * @param {number} taskId
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function cancelTask(userId, taskId) {
  const removed = await removeScheduledTask(taskId, userId);
  if (!removed) {
    return { success: false, error: `Task #${taskId} not found or you don't own it.` };
  }

  const job = activeJobs.get(taskId);
  if (job) {
    job.stop();
    activeJobs.delete(taskId);
  }

  return { success: true, message: `Task #${taskId} cancelled.` };
}

module.exports = { setClient, init, scheduleTask, listTasks, cancelTask };
