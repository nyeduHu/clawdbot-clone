const { getDb, loadMessages, saveMessage } = require('./database');

async function runStartupRepair() {
  console.log('[INTEGRITY] Running startup repair check...');
  // Determine likely affected users from scheduled tasks
  try {
    const { getAllScheduledTasks } = require('./database');
    const tasks = await getAllScheduledTasks();
    const userIds = Array.from(new Set(tasks.map(t => t.user_id))).filter(Boolean);
    if (userIds.length === 0) {
      // fallback to a default user seen in logs
      userIds.push('341116176128278528');
    }

    let totalInserted = 0;
    for (const userId of userIds) {
      const msgs = await loadMessages(userId, 2000);
      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        if (m.role === 'assistant' && m.tool_calls && Array.isArray(m.tool_calls)) {
          for (const tc of m.tool_calls) {
            const id = tc.id;
            const found = msgs.slice(i + 1).some(x => x.role === 'tool' && x.tool_call_id === id);
            if (!found) {
              await saveMessage(userId, { role: 'tool', name: 'integrity_auto', tool_call_id: id, content: JSON.stringify({ error: 'integrity: auto-inserted placeholder' }) });
              totalInserted++;
              console.log(`[INTEGRITY] inserted placeholder for missing tool_call_id=${id} user=${userId}`);
            }
          }
        }
      }
    }

    console.log(`[INTEGRITY] startup repair complete. inserted=${totalInserted}`);
    return { inserted: totalInserted };
  } catch (e) {
    console.error('[INTEGRITY] startup repair failed:', e?.message);
    return { error: e?.message };
  }
}

module.exports = { runStartupRepair };
