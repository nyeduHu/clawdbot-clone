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
      return;
    }
    if (!tool.description || typeof tool.description !== 'string') {
      console.warn(`⚠️  Tool ${basename}: missing or invalid 'description'`);
      return;
    }
    if (!tool.parameters || typeof tool.parameters !== 'object') {
      console.warn(`⚠️  Tool ${basename}: missing or invalid 'parameters'`);
      return;
    }
    if (typeof tool.execute !== 'function') {
      console.warn(`⚠️  Tool ${basename}: missing or invalid 'execute' function`);
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
  }
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
 * @param {object} args - Arguments from Gemini's function call
 * @returns {Promise<any>} Tool result
 */
async function handleFunctionCall(name, args) {
  const tool = registry.get(name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }
  if (pendingApproval.has(name)) {
    throw new Error(`Tool "${name}" is pending approval. Use /tools approve ${name} first.`);
  }
  return await tool.execute(args);
}

/**
 * Approve a generated tool (makes it active).
 * @param {string} name
 * @returns {boolean} success
 */
function approveTool(name) {
  const tool = registry.get(name);
  if (!tool || !tool._generated) return false;

  // Write _approved flag into the file
  const filePath = tool._filePath;
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
  return true;
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
