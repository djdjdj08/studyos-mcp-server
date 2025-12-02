import express, { Request, Response } from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// 1. Create MCP server
const server = new McpServer({
  name: "studyos-mcp-server",
  version: "1.0.0",
});

// 2. Define tools (keep / extend these as you like)

// Very simple placeholder schemas to make the manifest valid.
// You can tighten these later.
const ingestSchema = z.object({
  text: z.string().describe("Raw text or assignment / resource content"),
});

const searchSchema = z.object({
  query: z.string().describe("Natural language search query."),
});

const logSchema = z.object({
  original_prompt: z.string().describe("User’s original assignment prompt."),
  model_answer: z.string().describe("The answer the model produced."),
  outcome: z.string().describe("e.g. success / fail / unknown."),
});

server.tool(
  "ingest_content",
  "Ingest user-provided school resources or instructions into the StudyOS knowledge base.",
  ingestSchema,
  async ({ text }) => {
    // TODO: call your backend /ingest_content here if you want.
    console.log("ingest_content called with text length:", text.length);
    return {
      content: [
        {
          type: "text",
          text: "Ingested content (stub).",
        },
      ],
    };
  }
);

server.tool(
  "search_content",
  "Search the StudyOS knowledge base for information relevant to a query.",
  searchSchema,
  async ({ query }) => {
    console.log("search_content called with query:", query);
    // TODO: call your backend /search_content.
    return {
      content: [
        {
          type: "text",
          text: `Search results placeholder for: ${query}`,
        },
      ],
    };
  }
);

server.tool(
  "log_completion_result",
  "Log whether an assignment attempt was good or bad so the system can learn over time.",
  logSchema,
  async ({ original_prompt, model_answer, outcome }) => {
    console.log("log_completion_result:", { original_prompt, outcome });
    // TODO: call your backend /log_completion_result.
    return {
      content: [
        {
          type: "text",
          text: "Logged completion result (stub).",
        },
      ],
    };
  }
);

// 3. Express + Streamable HTTP transport

const app = express();
app.use(express.json());

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // stateless, good for Render
});

async function setupServer() {
  await server.connect(transport);
}

// 4. MCP HTTP endpoint(s)

// Main MCP JSON-RPC POST endpoint
app.post("/mcp", async (req: Request, res: Response) => {
  try {
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

// Optional: also accept POST at root, in case a client uses "/" as base URL
app.post("/", async (req: Request, res: Response) => {
  try {
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling root MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

// 5. MCP manifest at BOTH paths Agent Builder might try

const manifest = {
  name: "studyos-mcp-server",
  version: "1.0.0",
  tools: [
    {
      name: "ingest_content",
      description:
        "Store school resources or instructions into a Supabase-backed knowledge base.",
      input_schema: {
        type: "object",
        properties: {
          text: { type: "string" },
        },
        required: ["text"],
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
        },
        required: ["original_prompt", "model_answer", "outcome"],
      },
    },
  ],
};

// Root-style manifest: https://studyos-mcp-server.onrender.com/.well-known/mcp.json
app.get("/.well-known/mcp.json", (_req: Request, res: Response) => {
  res.json(manifest);
});

// BaseUrl-with-/mcp style manifest: https://.../mcp/.well-known/mcp.json
app.get("/mcp/.well-known/mcp.json", (_req: Request, res: Response) => {
  res.json(manifest);
});

// 6. Simple GET on root so the browser shows *something* instead of "Cannot GET /"
app.get("/", (_req: Request, res: Response) => {
  res.type("text/plain").send("StudyOS MCP server is running");
});

// 7. Start server

const PORT = process.env.PORT || 10000;

setupServer()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`StudyOS MCP server listening on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to set up MCP server:", error);
    process.exit(1);
  });
