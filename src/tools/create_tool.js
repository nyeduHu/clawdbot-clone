const fs = require('fs');
const path = require('path');
const { GENERATED_TOOLS_DIR } = require('../config');

module.exports = {
  name: 'create_tool',
  description: `Create a new tool/plugin that extends the bot's capabilities. The tool will be saved as a JS file and require approval before activation. Use this when the user asks you to do something you can't do yet, or when you identify a useful recurring capability to add.`,
  parameters: {
    type: 'object',
    properties: {
      toolName: {
        type: 'string',
        description: 'Name for the new tool (snake_case, e.g., "get_weather", "translate_text").',
      },
      toolDescription: {
        type: 'string',
        description: 'Clear description of what the tool does. This helps the AI know when to use it.',
      },
      parametersSchema: {
        type: 'string',
        description: 'JSON string of the parameters schema (OpenAPI-style). Example: \'{"type":"object","properties":{"city":{"type":"string","description":"City name"}},"required":["city"]}\'',
      },
      executeCode: {
        type: 'string',
        description: 'The JavaScript code for the execute function body. Receives destructured parameters. Has access to require() for built-in Node.js modules and fetch(). Should return an object with the result. Example: \'const res = await fetch(`https://api.example.com/${city}`); const data = await res.json(); return { temperature: data.temp };\'',
      },
    },
    required: ['toolName', 'toolDescription', 'parametersSchema', 'executeCode'],
  },

  async execute({ toolName, toolDescription, parametersSchema, executeCode }) {
    try {
      // Validate tool name
      if (!/^[a-z][a-z0-9_]*$/.test(toolName)) {
        return { error: 'Tool name must be snake_case starting with a letter (e.g., "get_weather").' };
      }

      // Parse parameters schema
      let parsedParams;
      try {
        parsedParams = JSON.parse(parametersSchema);
      } catch {
        return { error: 'Invalid parametersSchema JSON. Must be a valid JSON string.' };
      }

      // Build the tool file content
      const fileContent = `// Auto-generated tool: ${toolName}
// Created: ${new Date().toISOString()}
// Status: PENDING APPROVAL — activate with /tools approve ${toolName}

module.exports = {
  name: '${toolName}',
  description: ${JSON.stringify(toolDescription)},
  parameters: ${JSON.stringify(parsedParams, null, 2)},

  async execute(params) {
    const { ${Object.keys(parsedParams.properties || {}).join(', ')} } = params;
    ${executeCode}
  },
};
`;

      // Ensure generated tools directory exists
      if (!fs.existsSync(GENERATED_TOOLS_DIR)) {
        fs.mkdirSync(GENERATED_TOOLS_DIR, { recursive: true });
      }

      const filePath = path.join(GENERATED_TOOLS_DIR, `${toolName}.js`);

      // Check if tool already exists
      if (fs.existsSync(filePath)) {
        return { error: `A generated tool named "${toolName}" already exists. Remove it first with /tools remove ${toolName}.` };
      }

      fs.writeFileSync(filePath, fileContent, 'utf-8');

      // Reload tools to pick up the new one
      const registry = require('./_registry');
      registry.loadTool(filePath, true);

      return {
        message: `Tool "${toolName}" created and saved! It needs approval before it can be used.`,
        toolName,
        filePath: `tools/generated/${toolName}.js`,
        nextStep: `Ask the bot owner to run: /tools approve ${toolName}`,
        code: fileContent,
      };
    } catch (err) {
      return { error: `Failed to create tool: ${err.message}` };
    }
  },
};
