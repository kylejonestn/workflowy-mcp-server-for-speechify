import express from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;
const WORKFLOWY_API_KEY = process.env.WORKFLOWY_API_KEY;

app.use(cors());
app.use(express.json());

// Initialize Server with explicit server info & capabilities
const mcpServer = new Server(
  {
    name: 'workflowy-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
      resources: {},
    },
  }
);

// Explicit MCP initialize handler
mcpServer.setRequestHandler(InitializeRequestSchema, async (request) => {
  return {
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: 'workflowy-mcp',
      version: '1.0.0',
    },
  };
});

// List available tools
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_workflowy_tree',
        description: 'Fetches the current Workflowy outline tree, nodes, and active daily tasks.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

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

const transports = new Map();

// Route both /sse and / to the SSE connection handler
const handleSSE = async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const transport = new SSEServerTransport('/message', res);
  transports.set(transport.sessionId, transport);

  req.on('close', () => {
    transports.delete(transport.sessionId);
  });

  await mcpServer.connect(transport);
};

app.get('/sse', handleSSE);
app.get('/', handleSSE);

// Route client messages
app.post('/message', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);

  if (!transport) {
    return res.status(404).send('Session not found');
  }

  await transport.handlePostMessage(req, res);
});

app.listen(PORT, () => {
  console.log(`Workflowy MCP Server active on port ${PORT}`);
});