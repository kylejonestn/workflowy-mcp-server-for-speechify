import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;
const WORKFLOWY_API_KEY = process.env.WORKFLOWY_API_KEY;

const mcpServer = new Server(
    { name: 'workflowy-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
);

// Define the tool Speechify can call
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'get_workflowy_tree',
            description: 'Fetches the current Workflowy outline tree and active lists.',
            inputSchema: { type: 'object', properties: {} },
        },
    ],
}));

// Handle tool execution
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

// MCP SSE Endpoints for Speechify
let transport;
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