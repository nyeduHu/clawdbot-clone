const OpenAI = require('openai');
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

      // Call again with updated messages
      const updatedMessages = [
        { role: 'system', content: systemInstruction },
        ...(await getMessages(userId)),
      ];

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

    if (err.status === 429) {
      return '⚠️ Rate limit reached. Please wait a moment and try again.';
    }
    if (err.message?.includes('API key') || err.status === 401) {
      return '⚠️ Invalid OpenAI API key. Please check your `.env` file.';
    }

    return `⚠️ An error occurred: ${err.message}`;
  }
}

module.exports = { processMessage };
