#!/usr/bin/env node
//
// Leo web-search provider, over MCP.
//
// Leo's `web_search` tool does not search anything itself — it resolves a
// WebSearchProvider and asks that. Until the provider bridge existed, every
// implementation of that trait had to be compiled into the hub. This server is
// the same Tavily integration as the compiled `leo-tavily` package, reachable
// as a package the hub installs at runtime instead of one it is rebuilt for.
//
// The contract it answers is `web_search` in leo_mcp::providers:
//
//   search({ query, max_results }) -> { results: [{ title, url, snippet, score? }] }
//
// Plain JavaScript on purpose. This ships as a git tarball rather than an npm
// package, and npm does not reliably run build steps for a tarball URL — a
// TypeScript source tree would install and then fail to start, at the far end,
// on somebody else's machine.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const TAVILY_SEARCH = "https://api.tavily.com/search";

// Leo hands an entitled setting to the subprocess under its *settings key*,
// verbatim and lower-case — see `Entitlements::resolve_env_secrets`. This is
// the key the package's descriptor declares in `settings_read`, so the two
// spellings have to agree or the credential silently never arrives.
const SETTING_KEY = "tavily_api_key";

/** Tavily caps a request at 20; asking for more is an error, not a bigger page. */
const MAX_RESULTS_CEILING = 20;

/**
 * Map Tavily's answer onto the shape the `web_search` role promises.
 *
 * Exported for the smoke test: this mapping is the whole of what can silently
 * go wrong here, and it needs no network to check.
 */
export function toResults(payload) {
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  return rows
    // A result with no URL is not something a reader can act on, and the hub
    // drops it too — doing it here as well keeps the wire honest rather than
    // shipping entries that vanish on arrival.
    .filter((r) => typeof r?.url === "string" && r.url.length > 0)
    .map((r) => ({
      title: typeof r.title === "string" ? r.title : "",
      url: r.url,
      // Tavily calls it `content`; the role calls it `snippet`. This rename is
      // the one piece of translation in the file.
      snippet: typeof r.content === "string" ? r.content : "",
      ...(typeof r.score === "number" ? { score: r.score } : {}),
    }));
}

async function search({ query, max_results }) {
  const apiKey = process.env[SETTING_KEY] ?? "";
  if (!apiKey) {
    // Named precisely, because the failure the owner will actually hit is a
    // key they have not entered yet — not a broken server.
    throw new Error(
      `No ${SETTING_KEY} configured. Add it in Settings → Packages → Web Search.`,
    );
  }
  if (typeof query !== "string" || query.trim() === "") {
    throw new Error("search requires a non-empty `query`.");
  }

  const requested = Number.isFinite(max_results) ? Number(max_results) : 5;
  const response = await fetch(TAVILY_SEARCH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: Math.min(Math.max(1, requested), MAX_RESULTS_CEILING),
      include_answer: false,
    }),
  });

  if (!response.ok) {
    // The status is the part worth forwarding: 401 is a wrong key and 429 is a
    // quota, and those are different things for the person reading the log.
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Tavily API returned ${response.status}: ${detail.slice(0, 200)}`,
    );
  }

  return { results: toResults(await response.json()) };
}

const server = new Server(
  { name: "leo-tavily-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search",
      description:
        "Search the web via Tavily. Returns ranked results with a short " +
        "extract of each page.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for." },
          max_results: {
            type: "number",
            description: `How many results to return (1-${MAX_RESULTS_CEILING}, default 5).`,
          },
        },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name !== "search") {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
    };
  }
  try {
    const answer = await search(args ?? {});
    return { content: [{ type: "text", text: JSON.stringify(answer) }] };
  } catch (error) {
    // `isError` is what the hub reads to tell "the search found nothing" from
    // "the search did not run" — the bridge turns this into a real error
    // rather than an empty result set.
    return {
      isError: true,
      content: [{ type: "text", text: String(error?.message ?? error) }],
    };
  }
});

// Importing this file for its mapper must not also start a server on stdio.
if (process.env.LEO_TAVILY_MCP_NO_SERVE !== "1") {
  await server.connect(new StdioServerTransport());
}
