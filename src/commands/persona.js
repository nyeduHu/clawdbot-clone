const { setPersona, getAvailablePersonas } = require('../services/conversation');

module.exports = {
  name: 'persona',

  async execute(interaction) {
    const name = interaction.options.getString('name');

    if (setPersona(interaction.user.id, name)) {
      await interaction.reply({
        content: `🎭 Persona switched to **${name}**! Conversation history has been reset.`,
        ephemeral: true,
      });
    } else {
      const available = getAvailablePersonas().join(', ');
      await interaction.reply({
        content: `❌ Unknown persona "${name}". Available: ${available}`,
        ephemeral: true,
      });
    }
  },
};
