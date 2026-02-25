const path = require('path');
const fs = require('fs');

// Load all command handlers
const commandsDir = path.join(__dirname, '..', 'commands');
const commands = new Map();

const commandFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js') && f !== 'deploy.js');
for (const file of commandFiles) {
  const command = require(path.join(commandsDir, file));
  if (command.name) {
    commands.set(command.name, command);
  }
}

module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;

    const command = commands.get(interaction.commandName);
    if (!command) {
      console.warn(`Unknown command: ${interaction.commandName}`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`Error executing /${interaction.commandName}:`, err);
      const reply = { content: '⚠️ An error occurred while executing this command.', ephemeral: true };

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    }
  },
};
