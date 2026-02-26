const { loadMessages, saveMessage, getAllScheduledTasks } = require('../src/services/database');

async function repair() {
  // Find users from scheduled tasks (likely the users affected by scheduling errors)
  const tasks = await getAllScheduledTasks();
  const userIds = Array.from(new Set(tasks.map(t => t.user_id)));
  if (userIds.length === 0) userIds.push('341116176128278528'); // fallback user seen in logs

  let inserted = 0;
  for (const userId of userIds) {
    console.log('Checking messages for user', userId);
    const msgs = await loadMessages(userId, 1000);
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.role === 'assistant' && m.tool_calls && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          const id = tc.id;
          // Look for any tool message in msgs with tool_call_id == id
          const found = msgs.slice(i + 1).some(x => x.role === 'tool' && x.tool_call_id === id);
          if (!found) {
            // insert placeholder via saveMessage (will append to DB and cache)
            await saveMessage(userId, { role: 'tool', name: 'repair_auto', tool_call_id: id, content: JSON.stringify({ error: 'repair: inserted placeholder response' }) });
            inserted++;
            console.log(`Inserted placeholder for tool_call_id=${id} user=${userId}`);
          }
        }
      }
    }
  }

  console.log(`Repair complete. Inserted ${inserted} placeholder messages.`);
}

repair().catch(err => { console.error('Repair failed:', err); process.exit(1); });
