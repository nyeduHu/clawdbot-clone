const fs = require('fs');
const path = require('path');
const { safePath } = require('../utils/sandbox');

module.exports = {
  name: 'file_write',
  description: 'Write content to a file in the sandboxed workspace directory. Creates the file if it doesn\'t exist. Creates parent directories as needed.',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Relative path to the file within the workspace (e.g., "notes.txt" or "projects/readme.md").',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file.',
      },
      append: {
        type: 'boolean',
        description: 'If true, append to the file instead of overwriting. Defaults to false.',
      },
    },
    required: ['filePath', 'content'],
  },

  async execute({ filePath, content, append = false }) {
    try {
      const absPath = safePath(filePath);

      // Ensure parent directories exist
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (append) {
        fs.appendFileSync(absPath, content, 'utf-8');
        return { message: `Content appended to ${filePath}.` };
      } else {
        fs.writeFileSync(absPath, content, 'utf-8');
        return { message: `File written: ${filePath} (${content.length} characters).` };
      }
    } catch (err) {
      return { error: err.message };
    }
  },
};
