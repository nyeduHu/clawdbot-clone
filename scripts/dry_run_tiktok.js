const path = require('path');
const fs = require('fs');
const { OWNER_ID } = require('../src/config');

async function main() {
  try {
    const tiktokPath = path.join(__dirname, '..', 'workspace', 'tiktokprompt.md');
    if (!fs.existsSync(tiktokPath)) {
      console.error('workspace/tiktokprompt.md not found');
      process.exit(1);
    }

    const blueprint = fs.readFileSync(tiktokPath, 'utf8');
    const prompt = `[DRY RUN] Read the following blueprint and generate 1 TikTok voiceover transcription EXACTLY as instructed (do NOT post to chat, this is a dry-run):\n\n${blueprint}\n\nProduce N=1 script, LENGTH=45-55s, TARGET=random psychological topic. Output only the transcription.`;

    const { processMessage } = require('../src/services/gemini');
    const userId = OWNER_ID || 'dryrun-user';
    console.log('Calling processMessage for dry-run...');
    const result = await processMessage(userId, prompt, [], null);

    const out = { timestamp: new Date().toISOString(), result };
    const logDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const file = path.join(logDir, `dry_run_tiktok_${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    fs.writeFileSync(path.join(logDir, 'dry_run_tiktok_latest.json'), JSON.stringify(out, null, 2));

    console.log('Dry-run result saved to', file);
    console.log('--- DRY-RUN OUTPUT START ---');
    console.log(result);
    console.log('--- DRY-RUN OUTPUT END ---');
  } catch (err) {
    console.error('Dry run failed:', err.message);
    process.exit(1);
  }
}

main();
