import "dotenv/config";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT ?? 10000);
const BACKEND_URL = process.env.STUDYOS_BACKEND_URL ?? "";

// ---------- Helper to talk to your existing backend ----------

async function forwardToBackend<TArgs extends object>(
  path: string,
  args: TArgs
) {
  if (!BACKEND_URL) {
    throw new Error("STUDYOS_BACKEND_URL is not set");
  }

  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Backend ${path} failed: ${res.status} ${text}`);
  }

  try {
    return await res.json();
  } catch {
    return { ok: true };
  }
}

// ---------- MCP server & tool definitions ----------

const server = new McpServer({
  name: "studyos-mcp",
  version: "1.0.0",
  description: "MCP wrapper around StudyOS backend tools.",
});

// Ingest content: must use raw_text to match your backend
const ingestInput = z.object({
  course: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  subtopic: z.string().nullable().optional(),
  assignment_type: z.string().nullable().optional(),
  source_name: z.string().nullable().optional(),
  raw_text: z.string(), // IMPORTANT: matches backend req.body.raw_text
  original_prompt: z.string().nullable().optional(),
  model_answer: z.string().nullable().optional(),
  outcome: z.enum(["success", "fail"]).nullable().optional(),
  score: z.number().nullable().optional(),
  teacher_feedback: z.string().nullable().optional(),
});

server.registerTool(
  "ingest_content",
  {
    title: "Ingest school content",
    description:
      "Store user-provided resources or assignment instructions into the StudyOS vector database.",
    inputSchema: ingestInput,
  },
  async (args) => {
    const data = await forwardToBackend("/ingest_content", args);

    return {
      structuredContent: data,
      content: [
        {
          type: "text",
          text: "I saved this content into your StudyOS knowledge base.",
        },
      ],
    };
  }
);

// Search content
const searchInput = z.object({
  course: z.string().nullable().optional(),
  query: z.string(),
  types: z.array(z.string()).nullable().optional(),
  subtopic: z.string().nullable().optional(),
  assignment_type: z.string().nullable().optional(),
  top_k: z.number().optional().default(8),
  threshold: z.number().optional().default(0.3),
});

server.registerTool(
  "search_content",
  {
    title: "Search StudyOS content",
    description:
      "Search previously ingested resources, instructions, and past assignments.",
    inputSchema: searchInput,
  },
  async (args) => {
    const data = await forwardToBackend("/search_content", args);

    return {
      structuredContent: data,
      content: [
        {
          type: "text",
          text: "Here are the most relevant chunks I found in your StudyOS knowledge base.",
        },
      ],
    };
  }
);

// Log completion result
const logInput = z.object({
  course: z.string().nullable().optional(),
  assignment_type: z.string().nullable().optional(),
  subtopic: z.string().nullable().optional(),
  original_prompt: z.string(),
  model_answer: z.string(),
  outcome: z.enum(["success", "fail"]),
  score: z.number().nullable().optional(),
  teacher_feedback: z.string().nullable().optional(),
});

server.registerTool(
  "log_completion_result",
  {
    title: "Log assignment result",
    description:
      "Log whether a generated assignment was successful or failed, including teacher feedback.",
    inputSchema: logInput,
  },
  async (args) => {
    const data = await forwardToBackend("/log_completion_result", args);

    return {
      structuredContent: data,
      content: [
        {
          type: "text",
          text: "I logged this assignment outcome so I can learn from it in the future.",
        },
      ],
    };
  }
);

// ---------- Express app & routes ----------

const app = express();
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "studyos-mcp" });
});

// Very simple manifest for Agent Builder
const manifest = {
  name: "studyos-mcp",
  version: "1.0.0",
  tools: [
    {
      name: "ingest_content",
      description:
        "Store school resources or instructions into a Supabase-backed knowledge base.",
      input_schema: {
        type: "object",
        properties: {
          raw_text: { type: "string" },
          course: { type: ["string", "null"] },
          type: { type: ["string", "null"] },
          subtopic: { type: ["string", "null"] },
          assignment_type: { type: ["string", "null"] },
          source_name: { type: ["string", "null"] },
        },
        required: ["raw_text"],
      },
    },
    {
      name: "search_content",
      description:
        "Search the knowledge base for information relevant to an assignment or question.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string" },
          course: { type: ["string", "null"] },
          types: {
            type: "array",
            items: { type: "string" },
          },
          subtopic: { type: ["string", "null"] },
          assignment_type: { type: ["string", "null"] },
          top_k: { type: "number" },
          threshold: { type: "number" },
        },
        required: ["query"],
      },
    },
    {
      name: "log_completion_result",
      description:
        "Log how well an assignment attempt went so future answers can improve.",
      input_schema: {
        type: "object",
        properties: {
          original_prompt: { type: "string" },
          model_answer: { type: "string" },
          outcome: { type: "string" },
          course: { type: ["string", "null"] },
          assignment_type: { type: ["string", "null"] },
          subtopic: { type: ["string", "null"] },
          score: { type: "number" },
          teacher_feedback: { type: ["string", "null"] },
        },
        required: ["original_prompt", "model_answer", "outcome"],
      },
    },
  ],
};

// Manifest at base URL
app.get("/.well-known/mcp.json", (_req, res) => {
  res.json(manifest);
});

// Optional: root path just so browser shows something
app.get("/", (_req, res) => {
  res.type("text/plain").send("StudyOS MCP server is running");
});

// MCP JSON-RPC endpoint
app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport();

  await server.connect(transport);

  try {
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP transport error", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "MCP transport error" });
    }
  }
});

// ---------- Start server ----------

app.listen(PORT, () => {
  console.log(`StudyOS MCP server listening on port ${PORT}`);
});
