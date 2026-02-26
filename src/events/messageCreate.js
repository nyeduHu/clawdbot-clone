const { processMessage } = require('../services/gemini');
const { checkRateLimit } = require('../utils/rateLimiter');
const { processImages } = require('../utils/imageProcessor');
const { splitMessage } = require('../utils/messageSplitter');
const { AI_CHANNEL_IDS } = require('../config');

module.exports = {
  name: 'messageCreate',

  async execute(message, client) {
    // Ignore bots
    if (message.author.bot) return;

    // Determine if we should respond:
    // 1. Bot is mentioned
    // 2. Message is a DM
    // 3. Message is in a designated AI channel
    const isMentioned = message.mentions.has(client.user);
    const isDM = !message.guild;
    const isAIChannel = AI_CHANNEL_IDS.includes(message.channelId);

    if (!isMentioned && !isDM && !isAIChannel) return;

    // Rate limit check
    const { limited, retryAfterMs } = checkRateLimit(message.author.id);
    if (limited) {
      const seconds = Math.ceil(retryAfterMs / 1000);
      await message.reply(`⏳ You're sending messages too fast. Try again in ${seconds}s.`);
      return;
    }

    // Extract text (remove bot mention if present)
    let text = message.content;
    if (isMentioned && client.user) {
      text = text.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
    }

    // Ignore empty messages (just a mention with no text and no images)
    if (!text && message.attachments.size === 0) {
      await message.reply("Hey! How can I help you? Send me a message or an image.");
      return;
    }

    if (!text) text = 'What do you see in this image?';

    // Show typing indicator
    await message.channel.sendTyping();
    const typingInterval = setInterval(() => {
      message.channel.sendTyping().catch(() => {});
    }, 8000);

    try {
      // Process images if any
      const imageParts = await processImages(message.attachments);

      // Call Gemini
      const response = await processMessage(message.author.id, text, imageParts, message.channelId);

      // Split and send response
      const chunks = splitMessage(response);
      await message.reply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await message.channel.send(chunks[i]);
      }
    } catch (err) {
      console.error('Error processing message:', err);
      await message.reply('⚠️ Something went wrong. Please try again.');
    } finally {
      clearInterval(typingInterval);
    }
  },
};
