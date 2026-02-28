module.exports = {
  name: 'schedule_task',
  description:
    'Schedule a recurring task. Only use when the user explicitly asks to schedule or repeat something (e.g. "schedule this", "run every day", "every minute"). Do NOT use for one-off requests—those should be done now with other tools. At each scheduled time the stored prompt is sent as if the user had just said it. Create only one task unless the user asks for multiple.',
  parameters: {
    type: 'object',
    properties: {
      cron_expression: {
        type: 'string',
        description: 'When to run: 5-field cron (minute hour day month weekday). E.g. "0 6 * * *" = 6 AM daily, "*/1 * * * *" = every minute, "0 9 * * 1" = 9 AM Mondays.',
      },
      task_description: {
        type: 'string',
        description: "The exact prompt to run at each time. Use the user's own words only (e.g. 'search the web and give me the weather for Budapest'). Do NOT expand into a long spec, action list, or instructions—store only what the user asked to run.",
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

    // Extract a clean executable prompt from the provided task_description so we
    // don't persist wrapper text like "please schedule the following" which
    // would cause the scheduler to re-run scheduling instructions.
    function extractPrompt(text) {
      if (!text || typeof text !== 'string') return text;
      // 1) If there's a triple-backtick codeblock, use its first occurrence
      const codeblockMatch = text.match(/```(?:[\s\S]*?)```/);
      if (codeblockMatch) {
        return codeblockMatch[0].replace(/```/g, '').trim();
      }

      // 2) Remove leading polite scheduling phrases up to the first colon
      const cleanedLeading = text.replace(/^[\s\S]{0,200}?\b(schedule|scheduled|please schedule|create a schedule|create scheduled)\b[\s\S]*?:/i, '').trim();
      if (cleanedLeading && cleanedLeading.length < text.length) return cleanedLeading;

      // 3) If the text has multiple paragraphs, assume the last paragraph is the executable prompt
      const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
      if (paragraphs.length > 1) return paragraphs[paragraphs.length - 1];

      // 4) Fallback: return the original trimmed text
      return text.trim();
    }

    const { scheduleTask } = require('../services/scheduler');
    const cleanedDescription = extractPrompt(params.task_description);
    console.log(`[TOOL:schedule_task] Calling scheduleTask() with cleanedDescription=${JSON.stringify(cleanedDescription).slice(0,300)}`);
    const result = await scheduleTask(userId, channelId, params.cron_expression, cleanedDescription);
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
