const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { OPENAI_API_KEY, AI_MODEL } = require('../config');
const { buildTools, handleFunctionCall } = require('../tools/_registry');
const {
  addMessage,
  getMessages,
  getSystemInstruction,
} = require('./conversation');

// Lazy initialization
let client = null;
function getClient() {
  if (!client) {
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set in .env');
    client = new OpenAI({ apiKey: OPENAI_API_KEY });
  }
  return client;
}

const MAX_TOOL_ROUNDS = 10;
/** Tool names to hide when running a scheduled task (avoids model re-calling scheduler). */
const SCHEDULED_TASK_EXCLUDED_TOOLS = ['run_job_now', 'list_tasks', 'add_scheduled_task', 'remove_scheduled_task'];

const LOG_DIR = path.resolve(__dirname, '..', '..', 'logs');

function persistMessages(name, obj) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(LOG_DIR, `${name}_${ts}.json`);
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
    const latest = path.join(LOG_DIR, `${name}_latest.json`);
    fs.writeFileSync(latest, JSON.stringify(obj, null, 2));
    console.log(`[GEMINI] persisted messages to ${file}`);
  } catch (e) {
    console.error('[GEMINI] failed to persist messages:', e?.message);
  }
}

/**
 * Process a user message through OpenAI with full function-calling support.
 *
 * @param {string} userId - Discord user ID
 * @param {string} text - User's text message
 * @param {Array} [imageParts=[]] - Image parts as { base64, mimeType }
 * @param {string} [channelId=null] - Discord channel ID (for tools that need it)
 * @returns {Promise<string>} The final text response
 */
async function processMessage(userId, text, imageParts = [], channelId = null) {
  console.log(`[GEMINI] processMessage() called: userId=${userId}, channelId=${channelId}, textLen=${text?.length}, images=${imageParts.length}`);
  const systemInstruction = await getSystemInstruction(userId);
  const tools = buildTools();

  // Build the user message content
  const dateContext = `[Current date/time: ${new Date().toISOString()}]\n\n`;
  const userContent = [];

  // Add images if any (for vision-capable models)
  for (const img of imageParts) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
    });
  }

  // Add text
  userContent.push({ type: 'text', text: dateContext + text });

  // Add user message to history
  const userMessage = {
    role: 'user',
    content: imageParts.length > 0 ? userContent : dateContext + text,
  };
  await addMessage(userId, userMessage);

  // Build full messages array with system prompt
  const messages = [
    { role: 'system', content: systemInstruction },
    ...(await getMessages(userId)),
  ];

  sanitizeMessages(messages);
  stripInvalidToolCalls(messages);

  try {

    let response = await getClient().chat.completions.create({
      model: AI_MODEL,
      messages,
      tools: tools || undefined,
    });

    let assistantMessage = response.choices[0].message;

    // Function calling loop
    let rounds = 0;
    while (assistantMessage.tool_calls && rounds < MAX_TOOL_ROUNDS) {
      // Record assistant's tool call message
      await addMessage(userId, assistantMessage);

      // Execute all tool calls
      for (const toolCall of assistantMessage.tool_calls) {
        const name = toolCall.function.name;
        let args = {};
        try {
          args = JSON.parse(toolCall.function.arguments || '{}');
        } catch {}

        console.log(`🔧 Tool call: ${name}(${JSON.stringify(args).slice(0, 200)})`);

        let result;
        try {
          result = await handleFunctionCall(name, args, userId, channelId);
        } catch (err) {
          result = { error: err.message };
          console.error(`❌ Tool error (${name}):`, err.message);
        }

        console.log(`   → Result: ${JSON.stringify(result).slice(0, 200)}`);

        // Add tool result message (include tool name so OpenAI accepts the follow-up)
        await addMessage(userId, {
          role: 'tool',
          name,
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }

      const updatedMessages = [
        { role: 'system', content: systemInstruction },
        ...(await getMessages(userId)),
      ];
      sanitizeMessages(updatedMessages);
      stripInvalidToolCalls(updatedMessages);

      response = await getClient().chat.completions.create({
        model: AI_MODEL,
        messages: updatedMessages,
        tools: tools || undefined,
      });

      assistantMessage = response.choices[0].message;
      rounds++;
    }

    // Extract final text
    const finalText = assistantMessage.content || '(No response generated)';

    // Record assistant response in history
    await addMessage(userId, assistantMessage);

    return finalText;
  } catch (err) {
    console.error('OpenAI API error:', err);
    try {
      // Persist the last messages for post-mortem analysis
      persistMessages('openai_error', { error: err && err.message, requestID: err && err.requestID, messages });
    } catch (e) {
      console.error('[GEMINI] failed to persist error messages:', e?.message);
    }

    if (err.status === 429) {
      return '⚠️ Rate limit reached. Please wait a moment and try again.';
    }
    if (err.message?.includes('API key') || err.status === 401) {
      return '⚠️ Invalid OpenAI API key. Please check your `.env` file.';
    }

    return `⚠️ An error occurred: ${err.message}`;
  }
}

/**
 * Run a scheduled task: one-shot completion with no conversation history and no scheduler tools.
 * Used by the scheduler so the model cannot call run_job_now again (no recursion).
 *
 * @param {string} userId - Discord user ID (for system instruction / persona)
 * @param {string} channelId - Discord channel ID (for tools that need it)
 * @param {string} taskDescription - Full task text
 * @returns {Promise<string>} Final assistant text
 */
async function runScheduledTask(userId, channelId, taskDescription) {
  console.log(`[GEMINI] runScheduledTask() called: userId=${userId}, channelId=${channelId}, taskLen=${taskDescription?.length}`);
  const systemInstruction = await getSystemInstruction(userId);
  const tools = buildTools({ exclude: SCHEDULED_TASK_EXCLUDED_TOOLS });

  const dateContext = `[Current date/time: ${new Date().toISOString()}]\n\n`;
  const prompt = `[SCHEDULED TASK] Perform the following task and post the result:\n\n${taskDescription}`;
  const messages = [
    { role: 'system', content: systemInstruction },
    { role: 'user', content: dateContext + prompt },
  ];

  try {
    let response = await getClient().chat.completions.create({
      model: AI_MODEL,
      messages,
      tools: tools || undefined,
    });
    let assistantMessage = response.choices[0].message;

    let rounds = 0;
    while (assistantMessage.tool_calls && rounds < MAX_TOOL_ROUNDS) {
      for (const toolCall of assistantMessage.tool_calls) {
        const name = toolCall.function.name;
        let args = {};
        try {
          args = JSON.parse(toolCall.function.arguments || '{}');
        } catch {}
        console.log(`🔧 [scheduled] Tool call: ${name}(${JSON.stringify(args).slice(0, 200)})`);
        let result;
        try {
          result = await handleFunctionCall(name, args, userId, channelId);
        } catch (err) {
          result = { error: err.message };
          console.error(`❌ Tool error (${name}):`, err.message);
        }
        console.log(`   → Result: ${JSON.stringify(result).slice(0, 200)}`);
        messages.push(assistantMessage);
        messages.push({
          role: 'tool',
          name,
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
      response = await getClient().chat.completions.create({
        model: AI_MODEL,
        messages,
        tools: tools || undefined,
      });
      assistantMessage = response.choices[0].message;
      rounds++;
    }

    const finalText = assistantMessage.content || '(No response generated)';
    return finalText;
  } catch (err) {
    console.error('[GEMINI] runScheduledTask OpenAI error:', err);
    if (err.status === 429) return '⚠️ Rate limit reached. Please try again later.';
    if (err.message?.includes('API key') || err.status === 401) return '⚠️ Invalid API key.';
    return `⚠️ Error: ${err.message}`;
  }
}

function sanitizeMessages(messages) {
  for (const msg of messages) {
    if (msg.role === 'assistant' && (msg.content === null || msg.content === undefined)) {
      console.warn(`[GEMINI] Replacing null content in assistant message with placeholder.`);
      msg.content = '(No content provided)';
    }
  }
}

/**
 * Make message list valid for the API: never send assistant + tool_calls without exact tool responses.
 * If an assistant has tool_calls but the next N messages aren't exactly the matching tool messages in order,
 * remove that assistant's tool_calls and remove all consecutive tool messages after it.
 */
function stripInvalidToolCalls(msgs) {
  if (!Array.isArray(msgs)) return;
  let i = 0;
  while (i < msgs.length) {
    const m = msgs[i];
    if (!m || m.role !== 'assistant' || !m.tool_calls || !Array.isArray(m.tool_calls)) {
      i++;
      continue;
    }
    const ids = m.tool_calls.map(tc => tc.id);
    let j = i + 1;
    let valid = true;
    for (const id of ids) {
      if (j >= msgs.length || !msgs[j] || msgs[j].role !== 'tool' || msgs[j].tool_call_id !== id) {
        valid = false;
        break;
      }
      j++;
    }
    if (!valid) {
      delete m.tool_calls;
      while (i + 1 < msgs.length && msgs[i + 1]?.role === 'tool') {
        msgs.splice(i + 1, 1);
      }
    }
    i++;
  }
}

function validateMessages(messages) {
  for (const msg of messages) {
    if (!msg.content || typeof msg.content !== 'string') {
      console.error(`[GEMINI] Invalid message content detected:`, msg);
      throw new Error(`Invalid message content: expected a string, got ${typeof msg.content}`);
    }
  }
}

module.exports = { processMessage, runScheduledTask };
