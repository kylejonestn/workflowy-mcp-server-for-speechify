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

app.use(cors({ origin: '*' }));
app.use(express.json());

// Factory function to create and configure the MCP server
const createMcpServer = () => {
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
            filter: {
              type: 'string',
              description: 'Optional keyword to search in outline items.',
            },
          },
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

// Global MCP instance for stateless HTTP POST JSON-RPC calls
const statelessServer = createMcpServer();
const sseTransports = new Map();

// --- 1. Streamable HTTP POST Handler (Used by modern MCP cloud validators) ---
const handleDirectJsonRpc = async (req, res) => {
  const { jsonrpc, id, method, params } = req.body || {};

  if (!jsonrpc || !method) {
    return res.status(400).json({
      jsonrpc: '2.0',
      id: id || null,
      error: { code: -32600, message: 'Invalid Request' },
    });
  }

  if (method === 'initialize') {
    return res.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'workflowy-mcp', version: '1.0.0' },
      },
    });
  }

  if (method === 'notifications/initialized' || method === 'initialized') {
    return res.status(200).send();
  }

  if (method === 'tools/list') {
    return res.json({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'get_workflowy_tree',
            description: 'Fetches the current Workflowy outline tree and active lists.',
            inputSchema: {
              type: 'object',
              properties: {
                filter: { type: 'string', description: 'Optional search keyword.' },
              },
            },
          },
        ],
      },
    });
  }

  if (method === 'tools/call') {
    try {
      const response = await fetch('https://workflowy.com/api/v1/tree', {
        headers: {
          Authorization: `Bearer ${WORKFLOWY_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await response.json();
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(data) }],
        },
      });
    } catch (err) {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [{ type: 'text', text: `Failed: ${err.message}` }],
        },
      });
    }
  }

  return res.json({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: 'Method not found' },
  });
};

// --- 2. SSE Handlers ---
const handleSSE = async (req, res) => {
  const host = req.get('x-forwarded-host') || req.get('host');
  const protocol = req.get('x-forwarded-proto') || req.protocol;
  const messageEndpoint = `${protocol}://${host}/message`;

  const transport = new SSEServerTransport(messageEndpoint, res);
  const server = createMcpServer();

  sseTransports.set(transport.sessionId, transport);

  req.on('close', () => {
    sseTransports.delete(transport.sessionId);
  });

  await server.connect(transport);
};

// Route SSE connections
app.get('/sse', handleSSE);
app.get('/mcp', handleSSE);

// Route HTTP POST JSON-RPC validation and requests
app.post('/', handleDirectJsonRpc);
app.post('/mcp', handleDirectJsonRpc);
app.post('/sse', handleDirectJsonRpc);

// Route SSE session messages
app.post('/message', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = sseTransports.get(sessionId);

  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    // Fallback to direct JSON-RPC handler if sessionId is omitted
    await handleDirectJsonRpc(req, res);
  }
});

// Root GET health check
app.get('/', (req, res) => {
  res.status(200).send('Workflowy MCP Server is active.');
});

app.listen(PORT, () => {
  console.log(`Workflowy MCP Server listening on port ${PORT}`);
});