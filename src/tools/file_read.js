const fs = require('fs');
const path = require('path');
const { safeRealPath } = require('../utils/sandbox');

module.exports = {
  name: 'file_read',
  description: 'Read the content of a file from the sandboxed workspace directory.',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Relative path to the file within the workspace (e.g., "notes.txt" or "projects/readme.md").',
      },
    },
    required: ['filePath'],
  },

  async execute({ filePath }) {
    try {
      const absPath = safeRealPath(filePath);

      if (!fs.existsSync(absPath)) {
        return { error: `File not found: ${filePath}` };
      }

      const stat = fs.statSync(absPath);
      if (stat.isDirectory()) {
        return { error: `"${filePath}" is a directory, not a file. Use file_list instead.` };
      }

      // Limit file size to 100KB to avoid overwhelming the context
      if (stat.size > 100 * 1024) {
        const content = fs.readFileSync(absPath, 'utf-8').slice(0, 100 * 1024);
        return {
          content,
          truncated: true,
          message: `File is ${(stat.size / 1024).toFixed(1)}KB — showing first 100KB.`,
        };
      }

      const content = fs.readFileSync(absPath, 'utf-8');
      return { content, size: stat.size };
    } catch (err) {
      return { error: err.message };
    }
  },
};
