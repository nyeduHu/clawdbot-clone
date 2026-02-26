const { OWNER_ID } = require('../config');
const {
  deleteAllMemories,
  deleteAllMessages,
  deleteAllScheduledTasks,
} = require('../services/database');

module.exports = {
  name: 'reset_state',
  description: 'Reset stored bot state. Can clear memories, messages (conversation history), scheduled tasks, or everything. Does NOT touch tool files on disk.',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        enum: ['user', 'all'],
        description: '"user" = affect only the invoking user. "all" = affect all users (OWNER only).',
      },
      items: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['memories', 'messages', 'scheduled_tasks', 'all'],
        },
        description: 'Which items to reset. Use ["all"] to clear memories, messages and scheduled tasks.',
      },
      confirm: { type: 'boolean', description: 'Must be true to perform destructive operations.' },
    },
    required: ['scope', 'items', 'confirm'],
  },
  execute: async (params, userId) => {
    try {
      if (!params.confirm) return { error: 'You must set confirm=true to perform this action.' };

      const isOwner = OWNER_ID && String(OWNER_ID) === String(userId);
      if (params.scope === 'all' && !isOwner) {
        return { error: 'Only the bot owner can perform a global reset.' };
      }

      const targetUser = params.scope === 'user' ? userId : null;
      const items = params.items || [];
      const doAll = items.includes('all');

      const result = { memories: 0, messages: 0, scheduled_tasks: 0 };

      if (doAll || items.includes('memories')) {
        const deleted = await deleteAllMemories(targetUser);
        result.memories = deleted;
      }
      if (doAll || items.includes('messages')) {
        const deleted = await deleteAllMessages(targetUser);
        result.messages = deleted;
      }
      if (doAll || items.includes('scheduled_tasks')) {
        const deleted = await deleteAllScheduledTasks(targetUser);
        result.scheduled_tasks = deleted;
      }

      return { success: true, result };
    } catch (err) {
      return { error: err.message };
    }
  },
};
