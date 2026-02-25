const { REST, Routes, SlashCommandBuilder, SlashCommandSubcommandBuilder } = require('discord.js');
const { DISCORD_TOKEN, CLIENT_ID, PERSONAS } = require('../config');

const commands = [
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask the AI assistant a question')
    .addStringOption(opt =>
      opt.setName('prompt')
        .setDescription('Your question or request')
        .setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Reset your conversation history with the bot')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('persona')
    .setDescription('Switch the AI\'s personality')
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Persona name')
        .setRequired(true)
        .addChoices(
          ...Object.keys(PERSONAS).map(name => ({ name, value: name }))
        )
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('tools')
    .setDescription('Manage bot tools/plugins')
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all registered tools')
    )
    .addSubcommand(sub =>
      sub.setName('approve')
        .setDescription('Approve a generated tool (owner only)')
        .addStringOption(opt =>
          opt.setName('name')
            .setDescription('Tool name to approve')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a generated tool (owner only)')
        .addStringOption(opt =>
          opt.setName('name')
            .setDescription('Tool name to remove')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('reload')
        .setDescription('Reload all tools (owner only)')
    )
    .toJSON(),
];

async function deployCommands() {
  if (!DISCORD_TOKEN || !CLIENT_ID) {
    console.error('❌ DISCORD_TOKEN and CLIENT_ID must be set in .env');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

  try {
    console.log('🔄 Registering slash commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Slash commands registered successfully!');
    console.log('   Commands: /ask, /reset, /persona, /tools');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  deployCommands();
}

module.exports = { deployCommands };
