const { clearHistory, getPersona } = require('../services/conversation');

module.exports = {
  name: 'reset',

  async execute(interaction) {
    await clearHistory(interaction.user.id);
    const persona = await getPersona(interaction.user.id);
    await interaction.reply({
      content: `🔄 Conversation history cleared! Active persona: **${persona}**`,
      ephemeral: true,
    });
  },
};
