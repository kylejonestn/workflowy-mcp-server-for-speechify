import express from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;
const WORKFLOWY_API_KEY = process.env.WORKFLOWY_API_KEY;

app.use(cors());
app.use(express.json());

// Root healthcheck
app.get('/', (req, res) => {
  res.send('Workflowy MCP Server is online.');
});

// Single MCP server instance
const mcpServer = new Server(
  {
    name: 'workflowy-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_workflowy_tree',
      description: 'Fetches the current Workflowy outline tree and active lists.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ],
}));

// Execute tool requests
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'get_workflowy_tree') {
    try {
      const response = await fetch('https://workflowy.com/api/v1/tree', {
        headers: {
          Authorization: `Bearer ${WORKFLOWY_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Workflowy API Error: ${response.statusText}` }],
        };
      }

      const data = await response.json();
      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to fetch tree: ${err.message}` }],
      };
    }
  }
  throw new Error(`Tool not found: ${request.params.name}`);
});

// Manage active SSE transport session
let transport = null;

app.get('/sse', async (req, res) => {
  transport = new SSEServerTransport('/message', res);
  await mcpServer.connect(transport);
});

app.post('/message', async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send('No active SSE session');
  }
});

app.listen(PORT, () => {
  console.log(`Workflowy MCP Server listening on port ${PORT}`);
});