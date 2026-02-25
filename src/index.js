const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { DISCORD_TOKEN } = require('./config');
const { loadAllTools } = require('./tools/_registry');

// Validate required env vars
if (!DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN is required. Copy .env.example to .env and fill in your values.');
  process.exit(1);
}

if (!require('./config').GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY is required. Get one free at https://aistudio.google.com/apikey');
  process.exit(1);
}

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

// Load event handlers
const eventsDir = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsDir).filter(f => f.endsWith('.js'));

for (const file of eventFiles) {
  const event = require(path.join(eventsDir, file));
  client.on(event.name, (...args) => event.execute(...args, client));
}

// Ready event
client.once('ready', () => {
  console.log(`\n🤖 ${client.user.tag} is online!`);
  console.log(`   Guilds: ${client.guilds.cache.size}`);
  console.log(`   Invite: https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=274877975552&scope=bot%20applications.commands\n`);
});

// Load tools
console.log('📦 Loading tools...');
loadAllTools();

// Initialize Google Auth (non-blocking, just logs status)
require('./services/google-auth').getAuthClient().catch(() => {});

// Ensure workspace and generated tools directories exist
const { SANDBOX_ROOT, GENERATED_TOOLS_DIR } = require('./config');
if (!fs.existsSync(SANDBOX_ROOT)) fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
if (!fs.existsSync(GENERATED_TOOLS_DIR)) fs.mkdirSync(GENERATED_TOOLS_DIR, { recursive: true });

// Login
client.login(DISCORD_TOKEN);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  client.destroy();
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
