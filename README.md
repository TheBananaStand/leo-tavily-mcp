# leo-tavily-mcp

Tavily web search as a **Leo provider package**, over MCP.

Leo's `web_search` tool doesn't search anything itself — it resolves a
`WebSearchProvider` and asks that. This server is one, reachable as a package
the hub installs at runtime rather than one it has to be rebuilt for.

## What it answers

The `web_search` role in `leo_mcp::providers`:

```
search({ query, max_results }) -> { results: [{ title, url, snippet, score? }] }
```

Results come back as JSON in a text content block, which is the convention the
hub's bridge reads.

## Configuration

One setting, declared by the package descriptor and handed to this process by
Leo as an environment variable **under its settings key, verbatim**:

| env | where it comes from |
|---|---|
| `tavily_api_key` | Settings → Packages → Web Search |

Leo only hands over keys the package declared in `entitlements.settings_read`
and the owner consented to — never the whole settings table. The name is
lower-case because it *is* the settings key; renaming it on either side means
the credential silently never arrives.

With no key configured the tool returns `isError` with a message naming the
setting. That is deliberate: an empty result set would reach Leo as "the web
has nothing on that".

## Running it

```bash
npm install
node index.js          # speaks MCP over stdio
npm test               # checks the response mapping, no network needed
```

## Why plain JavaScript

This ships as a git tarball pinned to a commit SHA rather than an npm package,
and npm does not reliably run build steps for a tarball URL. A TypeScript source
tree would install and then fail to start on somebody else's machine, at the far
end, where it is hardest to diagnose.

## Registry entry

```jsonc
{
  "name": "tavily",
  "label": "Web Search",
  "mcp": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "https://github.com/TheBananaStand/leo-tavily-mcp/archive/<40-char-sha>.tar.gz"]
  },
  "descriptor": {
    "provides": ["web_search"],
    "fields": [
      { "key": "tavily_api_key", "label": "API Key", "field_type": "password", "required": true }
    ],
    "entitlements": {
      "settings_read": ["tavily_api_key"],
      "network": ["api.tavily.com"],
      "sends": [
        { "to": "api.tavily.com", "classes": ["search_queries"],
          "because": "The search text and nothing else." }
      ]
    }
  }
}
```

The URL must name a **full 40-character commit SHA**. A tag looks equally
specific and is not — `refs/tags/v1.0.0` is a pointer its owner can move after
the entry has been reviewed, so the hub rejects it as unpinned.

## License

MIT
