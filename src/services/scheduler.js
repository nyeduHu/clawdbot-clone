const cron = require('node-cron');
const {
  getAllScheduledTasks,
  addScheduledTask,
  getScheduledTasksByUser,
  removeScheduledTask,
} = require('./database');
const { splitMessage } = require('../utils/messageSplitter');
const { ensureToolResponses } = require('./gemini');

/** @type {Map<number, import('node-cron').ScheduledTask>} */
const activeJobs = new Map();

/** @type {Map<number, object>} */
const taskStore = new Map();

/** @type {import('discord.js').Client | null} */
let discordClient = null;

/**
 * Set the Discord client reference (called from index.js to avoid circular deps).
 * @param {import('discord.js').Client} client
 */
function setClient(client) {
  discordClient = client;
  console.log(`[SCHEDULER] setClient called — client user: ${client?.user?.tag ?? 'NOT READY'}`);
}

/**
 * Start a single cron job for a task row.
 */
function startJob(task) {
  console.log(`[SCHEDULER] startJob called for task #${task.id}, cron="${task.cron_expression}", channel=${task.channel_id}, user=${task.user_id}`);
  console.log(`[SCHEDULER] startJob task description: "${task.task_description}"`);
  
  if (!cron.validate(task.cron_expression)) {
    console.error(`[SCHEDULER] ❌ CRON VALIDATION FAILED for task #${task.id}: "${task.cron_expression}"`);
    return;
  }
  console.log(`[SCHEDULER] ✅ Cron expression valid: "${task.cron_expression}"`);

  // Store the task object so it can be triggered manually later
  taskStore.set(task.id, task);

  const job = cron.schedule(task.cron_expression, async () => {
    await performTask(task);
  });

  activeJobs.set(task.id, job);
  console.log(`[SCHEDULER] ✅ Cron job registered and ACTIVE for task #${task.id}`);
  console.log(`[SCHEDULER]   Expression: "${task.cron_expression}"`);
  console.log(`[SCHEDULER]   Description: "${task.task_description.slice(0, 100)}"`);
  console.log(`[SCHEDULER]   Active jobs count: ${activeJobs.size}`);
}

/**
 * Perform the work for a scheduled task (extracted so it can be run manually).
 * @param {object} task
 */
async function performTask(task) {
  console.log(`[SCHEDULER] ⏰ performTask called for #${task.id} at ${new Date().toISOString()}`);
  console.log(`[SCHEDULER]   Description: "${task.task_description}"`);
  console.log(`[SCHEDULER]   Channel: ${task.channel_id}, User: ${task.user_id}`);

  console.log(`[SCHEDULER]   discordClient available: ${!!discordClient}`);
  if (!discordClient) {
    console.error(`[SCHEDULER] ❌ Task #${task.id}: Discord client is NULL — cannot send messages`);
    return;
  }
  try {
    console.log(`[SCHEDULER]   Fetching channel ${task.channel_id}...`);
    const channel = await discordClient.channels.fetch(task.channel_id);
    console.log(`[SCHEDULER]   Channel fetched: ${channel?.id ?? 'NULL'}, type=${channel?.type}, sendable=${typeof channel?.send}`);
    if (!channel || !channel.send) {
      console.error(`[SCHEDULER] ❌ Task #${task.id}: Channel ${task.channel_id} not found or not text-based`);
      return;
    }

    // First attempt: if a generated tool `generate_voiceover_transcriptions` exists, call it directly
    try {
      const { handleFunctionCall, registry } = require('../tools/_registry');
      if (registry.has('generate_voiceover_transcriptions')) {
        console.log(`[SCHEDULER] Detected tool generate_voiceover_transcriptions — calling directly`);
        const genRes = await handleFunctionCall('generate_voiceover_transcriptions', { prompt: null }, task.user_id, task.channel_id, true);
        console.log(`[SCHEDULER] generate_voiceover_transcriptions returned: ${JSON.stringify(genRes).slice(0,300)}`);
        if (genRes && Array.isArray(genRes.transcriptions) && genRes.transcriptions.length) {
          for (const t of genRes.transcriptions) {
            await channel.send(t);
          }
          console.log(`[SCHEDULER] ✅ Task #${task.id} sent ${genRes.transcriptions.length} generated transcription(s)`);
          return;
        }
      }
    } catch (err) {
      console.log(`[SCHEDULER] generate_voiceover_transcriptions tool call failed or not available: ${err?.message}`);
    }

    // Lazy-require to avoid circular dependency
    const { processMessage } = require('./gemini');
    console.log(`[SCHEDULER]   processMessage loaded, calling with userId=${task.user_id}...`);

    const prompt = `[SCHEDULED TASK] Perform the following task and post the result:\n\n${task.task_description}`;
    console.log(`[SCHEDULER]   Prompt: "${prompt.slice(0, 120)}..."`);
    const result = await processMessage(task.user_id, prompt, [], task.channel_id);
    console.log(`[SCHEDULER]   processMessage returned ${result ? result.length : 0} chars`);

    if (result && result.trim()) {
      const chunks = splitMessage(result);
      console.log(`[SCHEDULER]   Sending ${chunks.length} message chunk(s) to channel...`);
      for (const chunk of chunks) {
        await channel.send(chunk);
      }
      console.log(`[SCHEDULER]   ✅ Task #${task.id} output sent to channel successfully`);
    } else {
      console.log(`[SCHEDULER]   ⚠️ Task #${task.id}: processMessage returned empty result`);
    }

    // Ensure tool responses are handled
    const msgs = await getMessagesForTask(task.id);
    ensureToolResponses(msgs);
  } catch (err) {
    console.error(`[SCHEDULER] ❌ Scheduled task #${task.id} failed:`, err.message);
    console.error(`[SCHEDULER]   Stack:`, err.stack);
  }
}

/**
 * Retrieve messages for a specific task ID.
 * @param {number} taskId - The ID of the task.
 * @returns {Promise<Array>} - A promise that resolves to an array of messages.
 */
async function getMessagesForTask(taskId) {
  try {
    console.log(`[SCHEDULER] Retrieving messages for task #${taskId}`);
    // Example implementation: Replace with actual database or storage logic
    const messages = await getMessages(taskId); // Assuming getMessages is defined elsewhere
    return messages;
  } catch (error) {
    console.error(`[SCHEDULER] Failed to retrieve messages for task #${taskId}:`, error.message);
    throw error;
  }
}

/**
 * Initialise the scheduler: load all saved tasks from DB and start their cron jobs.
 */
async function init() {
  console.log(`[SCHEDULER] init() called — loading tasks from DB...`);
  const tasks = await getAllScheduledTasks();
  console.log(`[SCHEDULER] Found ${tasks.length} task(s) in DB:`, JSON.stringify(tasks.map(t => ({ id: t.id, cron: t.cron_expression, desc: t.task_description?.slice(0, 50) }))));
  for (const task of tasks) {
    startJob(task);
  }
  console.log(`[SCHEDULER] ✅ Scheduler init complete — ${activeJobs.size} active cron job(s)`);
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
  console.log(`[SCHEDULER] scheduleTask() called:`);
  console.log(`[SCHEDULER]   userId=${userId}`);
  console.log(`[SCHEDULER]   channelId=${channelId}`);
  console.log(`[SCHEDULER]   cronExpression="${cronExpression}"`);
  console.log(`[SCHEDULER]   description="${description}"`);
  
  if (!cron.validate(cronExpression)) {
    console.log(`[SCHEDULER] ❌ Cron validation FAILED for "${cronExpression}"`);
    return { error: `Invalid cron expression: "${cronExpression}". Use standard 5-field cron (minute hour day month weekday). Examples: "0 2 * * *" = 2 AM daily, "0 9 * * 1" = 9 AM every Monday.` };
  }
  console.log(`[SCHEDULER] ✅ Cron validation passed for "${cronExpression}"`);

  console.log(`[SCHEDULER] Saving task to DB...`);
  const { id } = await addScheduledTask(userId, channelId, cronExpression, description);
  console.log(`[SCHEDULER] ✅ Task saved to DB with id=${id}`);
  
  startJob({ id, user_id: userId, channel_id: channelId, cron_expression: cronExpression, task_description: description });

  const result = { id, cronExpression, description };
  console.log(`[SCHEDULER] scheduleTask() returning:`, JSON.stringify(result));
  return result;
}

/**
 * List tasks for a user.
 * @param {string} userId
 * @returns {Promise<Array>}
 */
async function listTasks(userId) {
  console.log(`[SCHEDULER] listTasks() called for userId=${userId}`);
  const tasks = await getScheduledTasksByUser(userId);
  console.log(`[SCHEDULER] listTasks() found ${tasks.length} task(s):`, JSON.stringify(tasks));
  return tasks;
}

/**
 * Remove a task.
 * @param {string} userId
 * @param {number} taskId
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function cancelTask(userId, taskId) {
  console.log(`[SCHEDULER] cancelTask() called: userId=${userId}, taskId=${taskId}`);
  const removed = await removeScheduledTask(taskId, userId);
  console.log(`[SCHEDULER] removeScheduledTask returned: ${removed}`);
  if (!removed) {
    console.log(`[SCHEDULER] ❌ Task #${taskId} not found or not owned by ${userId}`);
    return { success: false, error: `Task #${taskId} not found or you don't own it.` };
  }

  const job = activeJobs.get(taskId);
  console.log(`[SCHEDULER] Active job for #${taskId}: ${!!job}`);
  if (job) {
    job.stop();
    activeJobs.delete(taskId);
    console.log(`[SCHEDULER] ✅ Cron job #${taskId} stopped and removed`);
  }

  console.log(`[SCHEDULER] ✅ Task #${taskId} cancelled — active jobs remaining: ${activeJobs.size}`);
  return { success: true, message: `Task #${taskId} cancelled.` };
}

module.exports = { setClient, init, scheduleTask, listTasks, cancelTask };

// Also export a runNow helper for debugging (calls the task handler immediately)
module.exports.runNow = async function runNow(taskId, callerUserId) {
  console.log(`[SCHEDULER] runNow() called for taskId=${taskId} by user=${callerUserId}`);
  const task = taskStore.get(Number(taskId));
  if (!task) {
    console.log(`[SCHEDULER] runNow: task ${taskId} not in memory; loading from DB`);
    const tasks = await getAllScheduledTasks();
    const found = tasks.find(t => t.id === Number(taskId));
    if (!found) return { error: 'Task not found' };
    taskStore.set(found.id, found);
    await performTask(found);
    return { success: true };
  }
  await performTask(task);
  return { success: true };
};

module.exports.getMessagesForTask = getMessagesForTask;
