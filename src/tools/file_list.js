const fs = require('fs');
const path = require('path');
const { safePath, SANDBOX_ROOT } = require('../utils/sandbox');

module.exports = {
  name: 'file_list',
  description: 'List files and directories in the sandboxed workspace. Defaults to the workspace root.',
  parameters: {
    type: 'object',
    properties: {
      dirPath: {
        type: 'string',
        description: 'Relative path to the directory within the workspace. Defaults to root (".") .',
      },
      recursive: {
        type: 'boolean',
        description: 'If true, list files recursively. Defaults to false.',
      },
    },
  },

  async execute({ dirPath = '.', recursive = false }) {
    try {
      const absPath = safePath(dirPath);

      if (!fs.existsSync(absPath)) {
        return { error: `Directory not found: ${dirPath}` };
      }

      const stat = fs.statSync(absPath);
      if (!stat.isDirectory()) {
        return { error: `"${dirPath}" is a file, not a directory.` };
      }

      const entries = listDir(absPath, recursive, SANDBOX_ROOT);
      return {
        directory: dirPath === '.' ? 'workspace/' : dirPath,
        entries,
        count: entries.length,
      };
    } catch (err) {
      return { error: err.message };
    }
  },
};

function listDir(dirPath, recursive, root) {
  const items = fs.readdirSync(dirPath, { withFileTypes: true });
  const entries = [];

  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);
    const relativePath = path.relative(root, fullPath);

    if (item.isDirectory()) {
      entries.push({ name: item.name, path: relativePath, type: 'directory' });
      if (recursive) {
        entries.push(...listDir(fullPath, true, root));
      }
    } else {
      const stat = fs.statSync(fullPath);
      entries.push({
        name: item.name,
        path: relativePath,
        type: 'file',
        size: stat.size,
      });
    }
  }

  return entries;
}
