import 'dotenv/config';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const PORT = Number(process.env.PORT ?? 10000);

// URL of your existing backend (we'll set this in Render env vars)
const BACKEND_URL = process.env.STUDYOS_BACKEND_URL ?? '';

// ---------- MCP SERVER SETUP ----------

const server = new McpServer({
  name: 'studyos-mcp',
  version: '1.0.0',
  description: 'MCP wrapper around StudyOS backend tools.'
});

// Helper to forward a POST to your existing backend
async function forwardToBackend<TArgs extends object>(
  path: string,
  args: TArgs
) {
  if (!BACKEND_URL) {
    throw new Error('STUDYOS_BACKEND_URL is not set');
  }

  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Backend ${path} failed: ${res.status} ${text}`);
  }

  // If your backend returns JSON, parse it, otherwise just return ok
  try {
    return await res.json();
  } catch {
    return { ok: true };
  }
}

// ---- Tool 1: ingest_content ----

const ingestInput = z.object({
  course: z.string().nullable().optional(),
  type: z.string().nullable().optional(),          // "resource" | "instruction" | etc
  subtopic: z.string().nullable().optional(),
  assignment_type: z.string().nullable().optional(), // "essay" | "worksheet" | ...
  source_name: z.string().nullable().optional(),   // e.g. "AP Lit – Great Expectations PDF"
  content: z.string(),                              // raw text or extracted text from PDF
  original_prompt: z.string().nullable().optional(),
  model_answer: z.string().nullable().optional(),
  outcome: z.enum(['success', 'fail']).nullable().optional(),
  score: z.number().nullable().optional(),
  teacher_feedback: z.string().nullable().optional()
});

server.registerTool(
  'ingest_content',
  {
    title: 'Ingest school content',
    description:
      'Store user-provided resources or assignment instructions into the StudyOS vector database.',
    inputSchema: ingestInput
  },
  async (args) => {
    const data = await forwardToBackend('/ingest_content', args);

    return {
      structuredContent: { status: 'stored', backend: data },
      content: [
        {
          type: 'text',
          text: 'I saved this content into your StudyOS knowledge base.'
        }
      ]
    };
  }
);

// ---- Tool 2: search_content ----

const searchInput = z.object({
  course: z.string().nullable().optional(),
  query: z.string(),
  types: z.array(z.string()).nullable().optional(),
  subtopic: z.string().nullable().optional(),
  assignment_type: z.string().nullable().optional(),
  top_k: z.number().optional().default(8),
  threshold: z.number().optional().default(0.3)
});

server.registerTool(
  'search_content',
  {
    title: 'Search StudyOS content',
    description:
      'Search previously ingested resources, instructions, and past assignments.',
    inputSchema: searchInput
  },
  async (args) => {
    const data = await forwardToBackend('/search_content', args);

    return {
      structuredContent: data,
      content: [
        {
          type: 'text',
          text: 'Here are the most relevant chunks I found in your StudyOS knowledge base.'
        }
      ]
    };
  }
);

// ---- Tool 3: log_completion_result ----

const logInput = z.object({
  course: z.string().nullable().optional(),
  assignment_type: z.string().nullable().optional(),
  subtopic: z.string().nullable().optional(),
  original_prompt: z.string(),
  model_answer: z.string(),
  outcome: z.enum(['success', 'fail']),
  score: z.number().nullable().optional(),
  teacher_feedback: z.string().nullable().optional()
});

server.registerTool(
  'log_completion_result',
  {
    title: 'Log assignment result',
    description:
      'Log whether a generated assignment was successful or failed, including teacher feedback.',
    inputSchema: logInput
  },
  async (args) => {
    const data = await forwardToBackend('/log_completion_result', args);

    return {
      structuredContent: { status: 'logged', backend: data },
      content: [
        {
          type: 'text',
          text: 'I logged this assignment outcome so I can learn from it in the future.'
        }
      ]
    };
  }
);

// ---------- EXPRESS + HTTP TRANSPORT ----------

const app = express();
app.use(express.json());

// Simple health check so you can test on Render
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', server: 'studyos-mcp' });
});

// Optional minimal manifest (used only for metadata)
app.get('/.well-known/mcp.json', (_req, res) => {
  res.json({
    name: 'studyos-mcp',
    version: '1.0.0',
    description: 'MCP wrapper around the StudyOS backend.'
  });
});

// Main MCP endpoint – ChatGPT will POST here
app.post('/', async (req, res) => {
  const transport = new StreamableHTTPServerTransport();

  await server.connect(transport);

  try {
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP transport error', err);
    res.status(500).json({ error: 'MCP transport error' });
  }
});

app.listen(PORT, () => {
  console.log(`StudyOS MCP server listening on port ${PORT}`);
});
