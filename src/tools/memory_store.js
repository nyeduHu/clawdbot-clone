const { storeMemory } = require('../services/database');

module.exports = {
  name: 'memory_store',
  description:
    'Store an important fact or preference about the user in long-term memory so you can recall it in future conversations. Use this proactively whenever the user reveals something worth remembering (name, preferences, projects, etc.).',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The fact or piece of information to remember.',
      },
      category: {
        type: 'string',
        description:
          'A short category label, e.g. "preference", "name", "project", "fact", "reminder".',
      },
    },
    required: ['content', 'category'],
  },
  execute: async (params, userId) => {
    if (!params.content || !params.category) {
      return { error: 'Both content and category are required.' };
    }
    const id = storeMemory(userId, params.content, params.category);
    return {
      success: true,
      memoryId: id,
      message: `Stored memory (${params.category}): "${params.content}"`,
    };
  },
};
