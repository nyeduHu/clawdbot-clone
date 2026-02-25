const { clearHistory, getPersona } = require('../services/conversation');

module.exports = {
  name: 'reset',

  async execute(interaction) {
    clearHistory(interaction.user.id);
    const persona = getPersona(interaction.user.id);
    await interaction.reply({
      content: `🔄 Conversation history cleared! Active persona: **${persona}**`,
      ephemeral: true,
    });
  },
};
