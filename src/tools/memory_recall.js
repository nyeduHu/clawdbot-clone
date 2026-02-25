const { recallMemories, deleteMemory, getAllMemories } = require('../services/database');

module.exports = {
  name: 'memory_recall',
  description:
    'Search or list memories stored about the user. You can search by keyword, filter by category, or list all memories. You can also delete a memory by ID.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['search', 'list', 'delete'],
        description:
          '"search" to find memories matching a query, "list" to show all memories, "delete" to remove a memory by ID.',
      },
      query: {
        type: 'string',
        description: 'Search keyword (used when action is "search").',
      },
      category: {
        type: 'string',
        description: 'Optional category filter for search/list.',
      },
      memoryId: {
        type: 'integer',
        description: 'Memory ID to delete (used when action is "delete").',
      },
    },
    required: ['action'],
  },
  execute: async (params, userId) => {
    switch (params.action) {
      case 'search': {
        if (!params.query) return { error: 'query is required for search.' };
        const results = recallMemories(userId, params.query, params.category);
        return { memories: results, count: results.length };
      }
      case 'list': {
        const all = getAllMemories(userId);
        const filtered = params.category
          ? all.filter(m => m.category === params.category)
          : all;
        return { memories: filtered, count: filtered.length };
      }
      case 'delete': {
        if (!params.memoryId) return { error: 'memoryId is required for delete.' };
        const ok = deleteMemory(params.memoryId, userId);
        return ok
          ? { success: true, message: `Memory #${params.memoryId} deleted.` }
          : { error: `Memory #${params.memoryId} not found or not yours.` };
      }
      default:
        return { error: 'Invalid action. Use "search", "list", or "delete".' };
    }
  },
};
