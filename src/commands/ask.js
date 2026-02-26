const { processMessage } = require('../services/gemini');
const { splitMessage } = require('../utils/messageSplitter');

module.exports = {
  name: 'ask',

  async execute(interaction) {
    const prompt = interaction.options.getString('prompt');

    await interaction.deferReply();

    try {
      const response = await processMessage(interaction.user.id, prompt, [], interaction.channelId);
      const chunks = splitMessage(response);

      await interaction.editReply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp(chunks[i]);
      }
    } catch (err) {
      console.error('Error in /ask:', err);
      await interaction.editReply('⚠️ Something went wrong. Please try again.');
    }
  },
};
