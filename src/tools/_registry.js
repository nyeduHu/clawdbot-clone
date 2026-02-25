const fs = require('fs');
const path = require('path');
const { TOOLS_DIR, GENERATED_TOOLS_DIR } = require('../config');

/** @type {Map<string, { name: string, description: string, parameters: object, execute: function }>} */
const registry = new Map();

/** @type {Set<string>} Tools in generated/ that are pending approval */
const pendingApproval = new Set();

/**
 * Load a single tool module and register it.
 * @param {string} filePath - Absolute path to the tool JS file
 * @param {boolean} [generated=false] - Whether this is a generated (needs approval) tool
 */
function loadTool(filePath, generated = false) {
  const basename = path.basename(filePath, '.js');

  // Skip this registry file and non-JS files
  if (basename === '_registry' || !filePath.endsWith('.js')) return;

  try {
    // Clear require cache for reloading
    delete require.cache[require.resolve(filePath)];
    const tool = require(filePath);

    // Validate tool interface
    if (!tool.name || typeof tool.name !== 'string') {
      console.warn(`⚠️  Tool ${basename}: missing or invalid 'name'`);
      if (generated) registerFailedTool(basename, filePath, 'Missing or invalid name');
      return;
    }
    if (!tool.description || typeof tool.description !== 'string') {
      console.warn(`⚠️  Tool ${basename}: missing or invalid 'description'`);
      if (generated) registerFailedTool(tool.name || basename, filePath, 'Missing or invalid description');
      return;
    }
    if (!tool.parameters || typeof tool.parameters !== 'object') {
      console.warn(`⚠️  Tool ${basename}: missing or invalid 'parameters'`);
      if (generated) registerFailedTool(tool.name || basename, filePath, 'Missing or invalid parameters');
      return;
    }
    if (typeof tool.execute !== 'function') {
      console.warn(`⚠️  Tool ${basename}: missing or invalid 'execute' function`);
      if (generated) registerFailedTool(tool.name || basename, filePath, 'Missing or invalid execute function');
      return;
    }

    if (generated && tool._approved !== true) {
      pendingApproval.add(tool.name);
      console.log(`🔒 Generated tool "${tool.name}" loaded as PENDING (needs /tools approve)`);
    } else {
      pendingApproval.delete(tool.name);
    }

    registry.set(tool.name, { ...tool, _filePath: filePath, _generated: generated });
    console.log(`🔧 Tool registered: ${tool.name}${generated ? ' (generated)' : ''}`);
  } catch (err) {
    console.error(`❌ Failed to load tool ${basename}:`, err.message);
    // For generated tools, register a stub so they can still be approved/removed
    if (generated) {
      registerFailedTool(basename, filePath, err.message);
    }
  }
}

/**
 * Register a generated tool that failed to load, so it can be approved/removed.
 * Tries to extract name and description from the file source.
 */
function registerFailedTool(fallbackName, filePath, errorMsg) {
  let name = fallbackName;
  let description = `(Failed to load: ${errorMsg})`;

  // Try to extract name/description from the source file
  try {
    const source = fs.readFileSync(filePath, 'utf-8');
    const nameMatch = source.match(/name:\s*['"]([^'"]+)['"]/);
    const descMatch = source.match(/description:\s*['"]([^'"]+)['"]/);
    if (nameMatch) name = nameMatch[1];
    if (descMatch) description = descMatch[1] + ` [LOAD ERROR: ${errorMsg}]`;
  } catch {}

  pendingApproval.add(name);
  registry.set(name, {
    name,
    description,
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ error: `Tool "${name}" failed to load: ${errorMsg}` }),
    _filePath: filePath,
    _generated: true,
    _loadError: errorMsg,
  });
  console.log(`🔒 Generated tool "${name}" registered as PENDING (has load error)`);
}

/**
 * Load all tools from the built-in and generated directories.
 */
function loadAllTools() {
  registry.clear();
  pendingApproval.clear();

  // Load built-in tools
  if (fs.existsSync(TOOLS_DIR)) {
    const files = fs.readdirSync(TOOLS_DIR).filter(f => f.endsWith('.js') && f !== '_registry.js');
    for (const file of files) {
      loadTool(path.join(TOOLS_DIR, file), false);
    }
  }

  // Load generated tools
  if (!fs.existsSync(GENERATED_TOOLS_DIR)) {
    fs.mkdirSync(GENERATED_TOOLS_DIR, { recursive: true });
  }
  const genFiles = fs.readdirSync(GENERATED_TOOLS_DIR).filter(f => f.endsWith('.js'));
  for (const file of genFiles) {
    loadTool(path.join(GENERATED_TOOLS_DIR, file), true);
  }

  console.log(`📦 Total tools loaded: ${registry.size} (${pendingApproval.size} pending approval)`);
}

/**
 * Convert the registry into OpenAI's tools format.
 * Only includes active (non-pending) tools.
 * @returns {Array<{ type: 'function', function: { name, description, parameters } }> | undefined}
 */
function buildTools() {
  const tools = [];

  for (const [name, tool] of registry) {
    // Skip pending tools
    if (pendingApproval.has(name)) continue;

    tools.push({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    });
  }

  if (tools.length === 0) return undefined;

  return tools;
}

/**
 * Execute a tool by name with given arguments.
 * @param {string} name - Tool name
 * @param {object} args - Arguments from the function call
 * @param {string} [userId] - Discord user ID (passed to tools that need it)
 * @returns {Promise<any>} Tool result
 */
async function handleFunctionCall(name, args, userId) {
  const tool = registry.get(name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }
  if (pendingApproval.has(name)) {
    throw new Error(`Tool "${name}" is pending approval. Use /tools approve ${name} first.`);
  }
  return await tool.execute(args, userId);
}

/**
 * Approve a generated tool (makes it active).
 * If the tool had a load error, tries to reload it.
 * @param {string} name
 * @returns {{ success: boolean, error?: string }}
 */
function approveTool(name) {
  const tool = registry.get(name);
  if (!tool || !tool._generated) return { success: false, error: 'Tool not found or not a generated tool.' };

  const filePath = tool._filePath;

  // If tool had a load error, try reloading it
  if (tool._loadError) {
    try {
      delete require.cache[require.resolve(filePath)];
      const reloaded = require(filePath);

      if (typeof reloaded.execute !== 'function') {
        return { success: false, error: `Tool still has errors: missing execute function.` };
      }

      // Re-register with the working module
      registry.set(name, { ...reloaded, _filePath: filePath, _generated: true });
    } catch (err) {
      return { success: false, error: `Tool still has load errors: ${err.message}` };
    }
  }

  // Write _approved flag into the file
  let content = fs.readFileSync(filePath, 'utf-8');
  if (!content.includes('_approved')) {
    content = content.replace(
      'module.exports = {',
      'module.exports = {\n  _approved: true,'
    );
    fs.writeFileSync(filePath, content);
  }

  pendingApproval.delete(name);
  console.log(`✅ Tool "${name}" approved and active.`);
  return { success: true };
}

/**
 * Remove a generated tool.
 * @param {string} name
 * @returns {boolean} success
 */
function removeTool(name) {
  const tool = registry.get(name);
  if (!tool || !tool._generated) return false;

  const filePath = tool._filePath;
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  registry.delete(name);
  pendingApproval.delete(name);
  console.log(`🗑️  Tool "${name}" removed.`);
  return true;
}

/**
 * List all registered tools with their status.
 * @returns {Array<{ name: string, description: string, status: string, generated: boolean }>}
 */
function listTools() {
  return Array.from(registry.values()).map(tool => ({
    name: tool.name,
    description: tool.description,
    status: pendingApproval.has(tool.name) ? 'pending' : 'active',
    generated: !!tool._generated,
  }));
}

/**
 * Reload all tools (useful after changes).
 */
function reloadTools() {
  console.log('🔄 Reloading all tools...');
  loadAllTools();
}

module.exports = {
  registry,
  loadAllTools,
  loadTool,
  reloadTools,
  buildTools,
  handleFunctionCall,
  approveTool,
  removeTool,
  listTools,
  pendingApproval,
};
