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

// Maximum function-call loop iterations to prevent infinite loops
const MAX_TOOL_ROUNDS = 10;
// How many times to attempt inserting placeholders before removing tool_calls
const CLEANUP_RETRIES = 2;

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

// Ensure tool response messages exist for any assistant tool_calls (safety net)
async function ensureToolResponses(msgs) {
  try {
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m && m.tool_calls && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        for (const tc of m.tool_calls) {
          const id = tc.id;
          let found = false;
          for (let j = i + 1; j < msgs.length; j++) {
            const later = msgs[j];
            if (later && later.role === 'tool' && later.tool_call_id === id) {
              found = true;
              break;
            }
          }
          if (!found) {
            console.warn(`[GEMINI] Missing tool response for tool_call_id=${id}.`);
            // Avoid retrying tools that may trigger scheduler recursion or external state
            const fname = tc.function?.name;
            if (fname === 'run_job_now' || fname === 'run_now' || fname === 'runJobNow') {
              console.warn(`[GEMINI] Skipping retry for recursive tool ${fname} (id=${id}). Inserting placeholder.`);
              const placeholder = { role: 'tool', tool_call_id: id, name: fname || 'auto', content: JSON.stringify({ error: 'Tool response skipped to avoid recursion' }) };
              msgs.splice(i + 1, 0, placeholder);
            } else {
              try {
                const toolResult = await handleFunctionCall(fname, JSON.parse(tc.function.arguments || '{}'), m.userId, m.channelId);
                const toolMessage = {
                  role: 'tool',
                  name: fname,
                  tool_call_id: id,
                  content: JSON.stringify(toolResult),
                };
                msgs.splice(i + 1, 0, toolMessage);
                console.log(`[GEMINI] Successfully retried tool execution for tool_call_id=${id}`);
              } catch (retryError) {
                console.error(`[GEMINI] Retry failed for tool_call_id=${id}:`, retryError?.message);
                const placeholder = { role: 'tool', tool_call_id: id, name: fname || 'auto', content: JSON.stringify({ error: 'Tool response missing; auto-inserted placeholder' }) };
                msgs.splice(i + 1, 0, placeholder);
                console.warn(`[GEMINI] Inserted placeholder tool response for tool_call_id=${id}`);
              }
            }
            i++; // Skip over the inserted response
          }
        }
      }
    }
  } catch (e) {
    console.error('[GEMINI] ensureToolResponses failed:', e?.message);
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

  // Call sanitizeMessages before validateMessages
  sanitizeMessages(messages);

  try {
    // ensureToolResponses is defined at module scope

    function findMissingToolCalls(msgs) {
      const missingMap = new Map();
      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        if (m && m.tool_calls && Array.isArray(m.tool_calls)) {
          for (const tc of m.tool_calls) {
            const id = tc.id;
            let found = false;
            for (let j = i + 1; j < msgs.length; j++) {
              const later = msgs[j];
              if (later && later.role === 'tool' && later.tool_call_id === id) {
                found = true;
                break;
              }
            }
            if (!found) {
              if (!missingMap.has(i)) missingMap.set(i, []);
              missingMap.get(i).push(id);
            }
          }
        }
      }
      return missingMap;
    }

    function cleanupMissingToolCalls(msgs) {
      const missing = findMissingToolCalls(msgs);
      if (missing.size === 0) return false;
      for (const [idx, ids] of missing.entries()) {
        const m = msgs[idx];
        if (!m) continue;
        delete m.tool_calls;
        console.warn(`[GEMINI] removed ${ids.length} missing tool_calls from assistant message at index ${idx}`);
      }
      return true;
    }

    function removeRecursiveToolCalls(msgs) {
      const recursiveNames = new Set(['run_job_now', 'run_now', 'runJobNow']);
      let removed = 0;
      for (const m of msgs) {
        if (!m || !m.tool_calls || !Array.isArray(m.tool_calls)) continue;
        const before = m.tool_calls.length;
        m.tool_calls = m.tool_calls.filter(tc => {
          const name = tc?.function?.name;
          return !recursiveNames.has(name);
        });
        if (m.tool_calls.length === 0) delete m.tool_calls;
        removed += before - (m.tool_calls?.length || 0);
      }
      if (removed > 0) console.warn(`[GEMINI] removed ${removed} recursive tool_calls from messages to avoid recursion`);
      return removed;
    }

    async function prepareMessagesForApi(msgs) {
      // Ensure placeholders appear immediately after assistant tool_calls
      await ensureToolResponses(msgs);
      // Remove recursive tool_calls that could cause scheduler recursion or invalid tool responses
      removeRecursiveToolCalls(msgs);
      for (let attempt = 0; attempt <= CLEANUP_RETRIES; attempt++) {
        const missing = findMissingToolCalls(msgs);
        if (missing.size === 0) return msgs;
        if (attempt < CLEANUP_RETRIES) {
          // try to insert placeholders again (no-op if already inserted)
          await ensureToolResponses(msgs);
        } else {
          // final fallback: remove tool_calls from problematic assistant messages
          cleanupMissingToolCalls(msgs);
          persistMessages('messages_before_cleanup', msgs);
          return msgs;
        }
      }
      return msgs;
    }

    await prepareMessagesForApi(messages);

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

      // Call again with updated messages
      const updatedMessages = [
        { role: 'system', content: systemInstruction },
        ...(await getMessages(userId)),
      ];

      await prepareMessagesForApi(updatedMessages);

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

function sanitizeMessages(messages) {
  for (const msg of messages) {
    if (msg.role === 'assistant' && (msg.content === null || msg.content === undefined)) {
      console.warn(`[GEMINI] Replacing null content in assistant message with placeholder.`);
      msg.content = '(No content provided)';
    }
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

module.exports = { processMessage, ensureToolResponses };
