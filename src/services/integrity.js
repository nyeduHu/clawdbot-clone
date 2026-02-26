const { getDb, loadMessages, saveMessage } = require('./database');

async function runStartupRepair() {
  console.log('[INTEGRITY] Running startup repair check...');
  await getDb();
  const db = await getDb();
  try {
    const rows = db.exec("SELECT DISTINCT user_id FROM messages") || [];
    const userIds = [];
    if (rows && rows[0] && rows[0].values) {
      for (const v of rows[0].values) {
        if (v[0]) userIds.push(v[0]);
      }
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
