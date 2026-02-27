const cron = require('node-cron');
const {
  getAllScheduledTasks,
  addScheduledTask,
  getScheduledTasksByUser,
  removeScheduledTask,
} = require('./database');
const { splitMessage } = require('../utils/messageSplitter');
const { getMessages } = require('./conversation');

/** @type {Map<number, object>} */
const taskStore = new Map();

/** @type {import('discord.js').Client | null} */
let discordClient = null;

/** @type {NodeJS.Timeout | null} */
let pollingJob = null;

/** @type {Map<number, string>} taskId -> last-run minute key (YYYY-MM-DDTHH:MM) */
const lastRunKeyByTask = new Map();

function getMinuteKey(date) {
  return date.toISOString().slice(0, 16);
}

function parseCronField(field, min, max) {
  const values = new Set();
  const parts = field.split(',');

  for (const part of parts) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? parseInt(stepPart, 10) || 1 : 1;

    if (rangePart === '*') {
      for (let v = min; v <= max; v += step) values.add(v);
      continue;
    }

    if (rangePart.includes('-')) {
      const [startStr, endStr] = rangePart.split('-');
      let start = parseInt(startStr, 10);
      let end = parseInt(endStr, 10);
      if (Number.isNaN(start) || Number.isNaN(end)) continue;
      if (start < min) start = min;
      if (end > max) end = max;
      for (let v = start; v <= end; v += step) values.add(v);
    } else {
      let v = parseInt(rangePart, 10);
      if (!Number.isNaN(v) && v >= min && v <= max) {
        values.add(v);
      }
    }
  }

  return values;
}

/**
 * Minimal cron matcher (5 fields: m h dom mon dow) with support for:
 * - '*'
 * - exact numbers
 * - ranges (a-b)
 * - lists (a,b,c)
 * - simple step values (for example every N minutes or ranges with steps)
 */
function cronMatchesNow(cronExpression, date) {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minField, hourField, domField, monField, dowField] = parts;

  const minute = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const mon = date.getMonth() + 1; // JS months 0-11
  let dow = date.getDay(); // 0-6 (Sun-Sat)
  // In cron, both 0 and 7 can represent Sunday. We'll allow 0 and 7 in expressions.

  const mins = parseCronField(minField, 0, 59);
  const hours = parseCronField(hourField, 0, 23);
  const doms = parseCronField(domField, 1, 31);
  const mons = parseCronField(monField, 1, 12);
  const dows = parseCronField(dowField, 0, 7);

  const dowMatch = dows.has(dow) || (dow === 0 && dows.has(7));

  return mins.has(minute) && hours.has(hour) && doms.has(dom) && mons.has(mon) && dowMatch;
}

/**
 * Set the Discord client reference (called from index.js to avoid circular deps).
 * @param {import('discord.js').Client} client
 */
function setClient(client) {
  discordClient = client;
  console.log(`[SCHEDULER] setClient called — client user: ${client?.user?.tag ?? 'NOT READY'}`);
}

/**
 * Register a task in memory so it can be triggered manually or by the polling loop.
 */
function startJob(task) {
  console.log(`[SCHEDULER] startJob called for task #${task.id}, cron="${task.cron_expression}", channel=${task.channel_id}, user=${task.user_id}`);
  console.log(`[SCHEDULER] startJob task description: "${task.task_description}"`);
  
  if (!cron.validate(task.cron_expression)) {
    console.error(`[SCHEDULER] ❌ CRON VALIDATION FAILED for task #${task.id}: "${task.cron_expression}"`);
    return;
  }
  console.log(`[SCHEDULER] ✅ Cron expression valid: "${task.cron_expression}"`);

  // Store the task object so it can be triggered manually or by the polling loop
  taskStore.set(task.id, task);
  console.log(`[SCHEDULER] ✅ Task registered in memory for polling scheduler (no per-task cron job).`);
  console.log(`[SCHEDULER]   Expression: "${task.cron_expression}"`);
  console.log(`[SCHEDULER]   Description: "${task.task_description.slice(0, 100)}"`);
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

    const { processMessage } = require('./gemini');
    console.log(`[SCHEDULER]   Sending scheduled prompt as user message (same as chat)...`);

    const prompt = task.task_description;
    console.log(`[SCHEDULER]   Prompt: "${prompt.slice(0, 120)}${prompt.length > 120 ? '...' : ''}"`);
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
      console.log(`[SCHEDULER]   ⚠️ Task #${task.id}: empty result`);
    }
  } catch (err) {
    console.error(`[SCHEDULER] ❌ Scheduled task #${task.id} failed:`, err.message);
    console.error(`[SCHEDULER]   Stack:`, err.stack);
  }
}

/**
 * Polling tick: runs every minute and checks which tasks should fire.
 */
async function pollingTick() {
  const now = new Date();
  const minuteKey = getMinuteKey(now);
  try {
    const tasks = await getAllScheduledTasks();
    console.log(`[SCHEDULER] pollingTick at ${now.toISOString()} — checking ${tasks.length} task(s)`);
    for (const task of tasks) {
      if (!task.cron_expression) {
        console.log(`[SCHEDULER]   Task #${task.id} has no cron_expression, skipping`);
        continue;
      }
      console.log(`[SCHEDULER]   Checking task #${task.id} (cron="${task.cron_expression}") for this minute...`);
      const matches = cronMatchesNow(task.cron_expression, now);
      if (!matches) {
        console.log(`[SCHEDULER]   → Not scheduled for this minute.`);
        continue;
      }

      const lastKey = lastRunKeyByTask.get(task.id);
      if (lastKey === minuteKey) {
        console.log(`[SCHEDULER]   → Already ran this minute (lastRunKey=${lastKey}), skipping.`);
        continue;
      }

      console.log(`[SCHEDULER]   → Should run now. Previous lastRunKey=${lastKey || 'none'}.`);
      lastRunKeyByTask.set(task.id, minuteKey);
      const stored = taskStore.get(task.id) || task;
      if (!taskStore.has(task.id)) taskStore.set(task.id, task);
      console.log(`[SCHEDULER] 🔄 pollingTick firing task #${task.id} at ${now.toISOString()}`);
      await performTask(stored);
    }
  } catch (e) {
    console.error('[SCHEDULER] pollingTick error:', e?.message || e);
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
  if (!pollingJob) {
    // Run once immediately, then every 60 seconds
    console.log('[SCHEDULER] ✅ Starting polling scheduler with setInterval (every 60s).');
    pollingTick().catch(err => {
      console.error('[SCHEDULER] initial pollingTick error:', err?.message || err);
    });
    pollingJob = setInterval(() => {
      pollingTick().catch(err => {
        console.error('[SCHEDULER] pollingTick error in interval:', err?.message || err);
      });
    }, 60_000);
  }
  console.log(`[SCHEDULER] ✅ Scheduler init complete — ${tasks.length} task(s) registered for polling`);
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

  taskStore.delete(taskId);
  lastRunKeyByTask.delete(taskId);
  console.log(`[SCHEDULER] ✅ Task #${taskId} cancelled.`);
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
