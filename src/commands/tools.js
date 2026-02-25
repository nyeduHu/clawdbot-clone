const { listTools, approveTool, removeTool, reloadTools } = require('../tools/_registry');
const { OWNER_ID } = require('../config');

module.exports = {
  name: 'tools',

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'list': {
        const tools = listTools();
        if (tools.length === 0) {
          return interaction.reply({ content: 'No tools registered.', ephemeral: true });
        }

        const lines = tools.map(t => {
          const status = t.status === 'pending' ? '🔒 Pending' : '✅ Active';
          const source = t.generated ? '🤖 Generated' : '📦 Built-in';
          return `**${t.name}** — ${t.description.slice(0, 60)}…\n   ${status} | ${source}`;
        });

        await interaction.reply({
          content: `**🔧 Registered Tools (${tools.length})**\n\n${lines.join('\n\n')}`,
          ephemeral: true,
        });
        break;
      }

      case 'approve': {
        if (interaction.user.id !== OWNER_ID) {
          return interaction.reply({ content: '❌ Only the bot owner can approve tools.', ephemeral: true });
        }

        const name = interaction.options.getString('name');
        const result = approveTool(name);
        if (result.success) {
          await interaction.reply({ content: `✅ Tool **${name}** approved and active!` });
        } else {
          await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
        }
        break;
      }

      case 'remove': {
        if (interaction.user.id !== OWNER_ID) {
          return interaction.reply({ content: '❌ Only the bot owner can remove tools.', ephemeral: true });
        }

        const name = interaction.options.getString('name');
        if (removeTool(name)) {
          await interaction.reply({ content: `🗑️ Tool **${name}** removed.` });
        } else {
          await interaction.reply({ content: `❌ Tool "${name}" not found or not a generated tool.`, ephemeral: true });
        }
        break;
      }

      case 'reload': {
        if (interaction.user.id !== OWNER_ID) {
          return interaction.reply({ content: '❌ Only the bot owner can reload tools.', ephemeral: true });
        }

        reloadTools();
        const tools = listTools();
        await interaction.reply({
          content: `🔄 Tools reloaded! ${tools.length} tool(s) registered.`,
          ephemeral: true,
        });
        break;
      }
    }
  },
};
