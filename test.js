// Smoke test for the one thing in this server that can fail quietly.
//
// The network call is Tavily's to get right. The mapping is ours, and a wrong
// mapping does not throw — it produces well-formed results with empty snippets,
// or drops every row, and the first anyone notices is a chat answer with
// nothing in it. So that is what is checked here.
//
//   node test.js

process.env.LEO_TAVILY_MCP_NO_SERVE = "1";

const { toResults } = await import("./index.js");
const assert = await import("node:assert/strict");

// Tavily's field is `content`; the role's field is `snippet`.
{
  const mapped = toResults({
    results: [
      { title: "T", url: "https://a", content: "extract", score: 0.9 },
    ],
  });
  assert.deepEqual(mapped, [
    { title: "T", url: "https://a", snippet: "extract", score: 0.9 },
  ]);
}

// A URL-less row is dropped rather than shipped, and an absent score stays
// absent — never 0, which would read as "ranked last" instead of "unranked".
{
  const mapped = toResults({
    results: [
      { title: "no url", content: "dropped" },
      { title: "keep", url: "https://b", content: "kept" },
    ],
  });
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].url, "https://b");
  assert.equal("score" in mapped[0], false);
}

// Nothing here may throw: an empty answer is a legitimate search result, and a
// malformed one must not take down the provider.
for (const junk of [{}, { results: null }, { results: "nope" }, null, undefined]) {
  assert.deepEqual(toResults(junk), []);
}

// Missing optional strings become empty, not `undefined` — the hub reads these
// as strings and `undefined` would serialize to a missing key.
{
  const [only] = toResults({ results: [{ url: "https://c" }] });
  assert.equal(only.title, "");
  assert.equal(only.snippet, "");
}

console.log("ok — mapping holds");
