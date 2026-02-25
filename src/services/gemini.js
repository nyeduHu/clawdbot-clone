const { GoogleGenAI } = require('@google/genai');
const { GEMINI_API_KEY, GEMINI_MODEL } = require('../config');
const { buildGeminiTools, handleFunctionCall } = require('../tools/_registry');
const {
  addToHistory,
  getHistory,
  getSystemInstruction,
} = require('./conversation');

// Lazy initialization — only create when first used
let ai = null;
function getAI() {
  if (!ai) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set in .env');
    ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return ai;
}

// Maximum function-call loop iterations to prevent infinite loops
const MAX_TOOL_ROUNDS = 10;

/**
 * Process a user message through Gemini with full function-calling support.
 *
 * @param {string} userId - Discord user ID
 * @param {string} text - User's text message
 * @param {Array} [imageParts=[]] - Gemini-compatible image parts (inlineData)
 * @returns {Promise<string>} The final text response from Gemini
 */
async function processMessage(userId, text, imageParts = []) {
  const systemInstruction = getSystemInstruction(userId);
  const tools = buildGeminiTools();

  // Build the user message parts
  const userParts = [];
  if (imageParts.length > 0) {
    userParts.push(...imageParts);
  }

  // Add date context + user text
  const dateContext = `[Current date/time: ${new Date().toISOString()}]\n\n`;
  userParts.push({ text: dateContext + text });

  // Add to conversation history
  addToHistory(userId, 'user', userParts);

  // Build full contents from history
  const contents = getHistory(userId);

  try {
    let response = await getAI().models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction,
        tools,
        thinkingConfig: { thinkingLevel: 'low' },
      },
    });

    // Function calling loop
    let rounds = 0;
    while (rounds < MAX_TOOL_ROUNDS) {
      const candidate = response.candidates?.[0];
      if (!candidate?.content?.parts) break;

      // Check for function calls
      const functionCalls = candidate.content.parts.filter(p => p.functionCall);
      if (functionCalls.length === 0) break;

      // Record the model's function call response in history
      addToHistory(userId, 'model', candidate.content.parts);

      // Execute all function calls
      const functionResponses = [];
      for (const part of functionCalls) {
        const { name, args } = part.functionCall;
        console.log(`🔧 Tool call: ${name}(${JSON.stringify(args).slice(0, 200)})`);

        let result;
        try {
          result = await handleFunctionCall(name, args || {});
        } catch (err) {
          result = { error: err.message };
          console.error(`❌ Tool error (${name}):`, err.message);
        }

        console.log(`   → Result: ${JSON.stringify(result).slice(0, 200)}`);
        functionResponses.push({
          functionResponse: {
            name,
            response: result,
          },
        });
      }

      // Send function results back to Gemini
      addToHistory(userId, 'user', functionResponses);

      response = await getAI().models.generateContent({
        model: GEMINI_MODEL,
        contents: getHistory(userId),
        config: {
          systemInstruction,
          tools,
          thinkingConfig: { thinkingLevel: 'low' },
        },
      });

      rounds++;
    }

    // Extract final text response
    const finalParts = response.candidates?.[0]?.content?.parts || [];
    const textParts = finalParts.filter(p => p.text).map(p => p.text);
    const finalText = textParts.join('') || '(No response generated)';

    // Record model response in history
    addToHistory(userId, 'model', finalParts);

    return finalText;
  } catch (err) {
    console.error('Gemini API error:', err);

    // Handle common errors gracefully
    if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) {
      return '⚠️ Rate limit reached on the Gemini free tier. Please wait a moment and try again.';
    }
    if (err.message?.includes('API key')) {
      return '⚠️ Invalid Gemini API key. Please check your `.env` file.';
    }

    return `⚠️ An error occurred while processing your message: ${err.message}`;
  }
}

module.exports = { processMessage };
