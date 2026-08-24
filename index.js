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

// Root health check
app.get('/', (req, res) => {
  res.status(200).send('Workflowy MCP Server is online.');
});

// Map of active SSE sessions
const transports = new Map();

// Helper to create and bind an MCP server to a transport
const createServerForTransport = () => {
  const server = new Server(
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

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'get_workflowy_tree',
        description: 'Fetches the current Workflowy outline tree and active lists.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Optional keyword or date filter to narrow outline items.',
            },
          },
          required: [],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
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

  return server;
};

// SSE Connection Endpoint
app.get('/sse', async (req, res) => {
  console.log('Incoming SSE connection from client...');
  
  const transport = new SSEServerTransport('/message', res);
  const server = createServerForTransport();

  transports.set(transport.sessionId, transport);

  req.on('close', () => {
    console.log(`Session closed: ${transport.sessionId}`);
    transports.delete(transport.sessionId);
  });

  await server.connect(transport);
});

// Message Handling Endpoint
app.post('/message', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);

  if (!transport) {
    console.error(`Session not found for ID: ${sessionId}`);
    return res.status(404).send('Session not found');
  }

  await transport.handlePostMessage(req, res);
});

app.listen(PORT, () => {
  console.log(`Workflowy MCP Server running on port ${PORT}`);
});