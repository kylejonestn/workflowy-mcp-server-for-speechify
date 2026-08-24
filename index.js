import express from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;
const WORKFLOWY_API_KEY = process.env.WORKFLOWY_API_KEY;

// Enable CORS for all incoming clients/origins
app.use(cors());
app.use(express.json());

const mcpServer = new Server(
  { name: 'workflowy-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_workflowy_tree',
      description: 'Fetches the current Workflowy outline tree and active lists.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'get_workflowy_tree') {
    const response = await fetch('https://workflowy.com/api/v1/tree', {
      headers: { Authorization: `Bearer ${WORKFLOWY_API_KEY}` },
    });
    const data = await response.json();
    return {
      content: [{ type: 'text', text: JSON.stringify(data) }],
    };
  }
  throw new Error('Tool not found');
});

// Map to track active client sessions
const transports = new Map();

// Support both / and /sse for the SSE initialization
const sseHandler = async (req, res) => {
  const transport = new SSEServerTransport('/message', res);
  transports.set(transport.sessionId, transport);

  res.on('close', () => {
    transports.delete(transport.sessionId);
  });

  await mcpServer.connect(transport);
};

app.get('/sse', sseHandler);
app.get('/', sseHandler);

app.post('/message', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);

  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(404).send('Session not found');
  }
});

app.listen(PORT, () => {
  console.log(`Workflowy MCP Server listening on port ${PORT}`);
});