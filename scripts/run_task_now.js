const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { DISCORD_TOKEN, OWNER_ID } = require('../src/config');
const path = require('path');

if (!DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN env required');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel],
});

async function main() {
  const args = process.argv.slice(2);
  const taskIdArg = args[0] ? Number(args[0]) : null;
  const callerArg = args[1] || OWNER_ID || null;

  client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    try {
      const { setClient } = require(path.join(__dirname, '..', 'src', 'services', 'scheduler'));
      setClient(client);

      const { getAllScheduledTasks } = require(path.join(__dirname, '..', 'src', 'services', 'database'));
      const tasks = await getAllScheduledTasks();
      if (!tasks || tasks.length === 0) {
        console.error('No scheduled tasks found in DB');
        process.exit(1);
      }

      const taskId = taskIdArg || tasks[0].id;
      console.log(`Running task #${taskId} now (caller=${callerArg})`);

      const { runNow } = require(path.join(__dirname, '..', 'src', 'services', 'scheduler'));
      const res = await runNow(taskId, callerArg);
      console.log('runNow result:', res);
    } catch (err) {
      console.error('Error running task now:', err);
    } finally {
      client.destroy();
      process.exit(0);
    }
  });

  client.login(DISCORD_TOKEN).catch(err => {
    console.error('Discord login failed:', err);
    process.exit(1);
  });
}

main();
