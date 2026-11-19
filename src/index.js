// App Finishers MCP connector: public, read-only fix guides for errors in AI-built apps (Lovable, Bolt, Replit, Cursor,
// Supabase). Streamable HTTP, stateless: each POST gets one JSON response. No session, no auth, no cookies, nothing stored.
import DATA from "./data.json" with { type: "json" };

const VERSIONS = ["2025-06-18", "2025-03-26"];           // newest first; we answer with the client's if we speak it
const SITE = "https://appfinishers.com";
const MAX_BODY = 65536;
const MAX_ERROR = 4000;
const CORS = {
  "Access-Control-Allow-Origin": "*",                    // public read-only data, no credentials: nothing to protect
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version",
};

const RULES = DATA.guides.map(g => ({ g, res: g.p.map(s => new RegExp(s, "i")) }));
const BY_SLUG = new Map(DATA.guides.map(g => [g.s, g]));
// ?ref=mcp lets the site's request counts tell that a visit came from here. It carries nothing about the user, and the
// guide pages name their canonical URL without it.
const url = g => `${SITE}/guides/${g.s}/?ref=mcp`;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const TOOLS = [
  {
    name: "lookup_error",
    title: "Look up an error",
    description: "Find the fix guide for an error message from an app built with Lovable, Bolt, Replit, Cursor, v0 or " +
      "Supabase. Pass the exact error text (a log line, a console message, an HTTP error body). Returns the best " +
      "matching guides with their links; then call get_guide with a slug for the full fix.",
    inputSchema: {
      type: "object",
      properties: { error: { type: "string", description: `The exact error text, as shown (up to ${MAX_ERROR} characters).` } },
      required: ["error"],
    },
    annotations: { title: "Look up an error", ...READ_ONLY },
  },
  {
    name: "get_guide",
    title: "Read a fix guide",
    description: "Read one fix guide: the causes, how to check which one applies, and the fix for each, step by step. " +
      "Use a slug from lookup_error or list_guides. By default it returns the whole guide; to save tokens, set " +
      "outline to true to get only its numbered sections, then pass section to read just one.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "The guide's slug, e.g. supabase-new-row-violates-row-level-security-policy" },
        outline: { type: "boolean", description: "Only the title, summary and numbered section headings." },
        section: { type: "integer", minimum: 1, description: "Only this section, by its number in the outline." },
      },
      required: ["slug"],
    },
    annotations: { title: "Read a fix guide", ...READ_ONLY },
  },
  {
    name: "list_guides",
    title: "List fix guides",
    description: "List the fix guides by group, with their slugs. Optional filter: words that must all appear in the " +
      "title (e.g. \"lovable deploy\", \"storage\", \"500\").",
    inputSchema: {
      type: "object",
      properties: { filter: { type: "string", description: "Optional words to filter the titles." } },
    },
    annotations: { title: "List fix guides", ...READ_ONLY },
  },
];

const text = (t, isError = false) => ({ content: [{ type: "text", text: t }], isError });

function lookupError({ error }) {
  if (typeof error !== "string" || !error.trim()) return text("Pass the error text in `error`.", true);
  const input = error.slice(0, MAX_ERROR);
  const hits = [];
  for (const { g, res } of RULES) {
    let score = 0, first = "";
    for (const re of res) {                              // the /errors/ page's scoring: first match of each pattern
      const m = input.match(re);
      if (m && m[0]) { score += m[0].length; first ||= m[0]; }
    }
    if (score) hits.push({ g, score, first });
  }
  hits.sort((a, b) => b.score - a.score);
  if (!hits.length) {
    return text("No guide matches this error yet. Try a shorter part of the message (the error code or its first " +
      "line), or browse the guides with list_guides.");
  }
  const top = hits.slice(0, 3).map((h, i) =>
    `${i + 1}. ${h.g.t}\n   ${url(h.g)}\n   slug: ${h.g.s} · matched: "${h.first.slice(0, 120)}"`);
  return {
    content: [{ type: "text", text: `Best matches:\n\n${top.join("\n\n")}\n\nNext: get_guide with the slug for the full fix.` }],
    structuredContent: { matches: hits.slice(0, 3).map(h => ({ slug: h.g.s, title: h.g.t, url: url(h.g), score: h.score })) },
    isError: false,
  };
}

// A guide's sections = its "## " headings with their text (the first one is the guide's own title and summary).
const sections = g => g.x.split(/\n(?=## )/).filter(s => s.startsWith("## ")).map(s => {
  const i = s.indexOf("\n");
  return { h: (i < 0 ? s : s.slice(0, i)).slice(3).trim(), body: s.trim() };
});

function getGuide({ slug, outline, section }) {
  const g = typeof slug === "string" && BY_SLUG.get(slug.trim().replace(/^\/?(guides\/)?|\/$/g, ""));
  if (!g) return text("No guide has that slug. Use lookup_error or list_guides to find one.", true);
  const secs = sections(g);
  if (section !== undefined && section !== null) {
    const n = Number(section);
    if (!Number.isInteger(n) || n < 1 || n > secs.length) return text(`This guide has sections 1 to ${secs.length}.`, true);
    return text(`# ${g.t} (section ${n} of ${secs.length})\n\n${secs[n - 1].body}\n\nSource: ${url(g)}`);
  }
  if (outline === true) {
    return text(`# ${g.t}\n\n${g.d}\n\nSections:\n${secs.map((s, i) => `${i + 1} · ${s.h}`).join("\n")}\n\nSource: ${url(g)}`);
  }
  return text(`# ${g.t}\n\n${g.d}\n\n${g.x}\n\nSource: ${url(g)}`);
}

function listGuides({ filter } = {}) {
  const words = typeof filter === "string" ? filter.toLowerCase().split(/\s+/).filter(Boolean) : [];
  const keep = DATA.guides.filter(g => words.every(w => g.t.toLowerCase().includes(w)));
  if (!keep.length) return text(`No guide title contains: ${words.join(" ")}. Try one word, or no filter.`);
  const parts = DATA.groups.map(name => {
    const gs = keep.filter(g => g.g === name);
    return gs.length ? `## ${name}\n` + gs.map(g => `- ${g.t} (slug: ${g.s})`).join("\n") : "";
  }).filter(Boolean);
  return text(`${keep.length} guides\n\n${parts.join("\n\n")}`);
}

const CALLS = { lookup_error: lookupError, get_guide: getGuide, list_guides: listGuides };
const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

function handle(msg) {
  const isRequest = msg && typeof msg === "object" && "id" in msg;
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return isRequest ? fail(msg.id, -32600, "Invalid Request") : null;
  if (!isRequest) return null;                           // notifications (initialized, cancelled, ...) need no answer
  const p = msg.params || {};
  switch (msg.method) {
    case "initialize":
      return ok(msg.id, {
        protocolVersion: VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "app-finishers", title: "App Finishers", version: DATA.version },
        instructions: "Fix guides for errors in apps built with Lovable, Bolt, Replit, Cursor and Supabase. Call " +
          "lookup_error with the exact error text first, then get_guide with the best match's slug.",
      });
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: TOOLS });
    case "tools/call": {
      const fn = CALLS[p.name];
      if (!fn) return fail(msg.id, -32602, `Unknown tool: ${String(p.name).slice(0, 64)}`);
      return ok(msg.id, fn(p.arguments && typeof p.arguments === "object" ? p.arguments : {}));
    }
    default:
      return fail(msg.id, -32601, "Method not found");
  }
}

const reply = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), {
  status, headers: { ...(body === null ? {} : { "Content-Type": "application/json" }), "Cache-Control": "no-store", ...CORS } });

export default {
  async fetch(req) {
    if (new URL(req.url).pathname !== "/mcp") return new Response("Not found", { status: 404 });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "POST") return new Response("This MCP server answers POST only (no event stream).",
      { status: 405, headers: { Allow: "POST, OPTIONS", ...CORS } });
    const raw = await req.text();
    if (raw.length > MAX_BODY) return reply(fail(null, -32600, "Request too large"), 413);
    let body;
    try { body = JSON.parse(raw); } catch { return reply(fail(null, -32700, "Parse error"), 400); }
    if (Array.isArray(body)) {                          // batches: allowed by 2025-03-26, dropped in 2025-06-18
      if (!body.length) return reply(fail(null, -32600, "Invalid Request"), 400);
      const out = body.map(handle).filter(Boolean);
      return out.length ? reply(out) : reply(null, 202);
    }
    const out = handle(body);
    return out ? reply(out) : reply(null, 202);
  },
};
