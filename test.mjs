// Tests for the MCP connector. Local (the Worker module itself):  node test.mjs
// Live (the deployed endpoint):                                  node test.mjs https://appfinishers.com/mcp
import worker from "./src/index.js";

const LIVE = process.argv[2];
const ENDPOINT = LIVE || "https://appfinishers.com/mcp";
const HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
let failed = 0, id = 0;

async function send(method, init = {}, path = "") {
  const req = new Request(ENDPOINT + path, { method, headers: HEADERS, ...init });
  return LIVE ? fetch(req) : worker.fetch(req);
}
const rpc = async (m, params) => {
  const r = await send("POST", { body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: m, params }) });
  const raw = await r.text();
  try { return { status: r.status, body: JSON.parse(raw) }; } catch { return { status: r.status, body: {}, raw }; }
};
function check(name, cond, info = "") {
  if (!cond && r?.raw !== undefined) info += ` [HTTP ${r.status}, body ${JSON.stringify(r.raw.slice(0, 80))}]`;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + info}`);
  if (!cond) failed++;
}
const call = (name, args) => rpc("tools/call", { name, arguments: args });

let r = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
check("initialize", r.status === 200 && r.body.result?.protocolVersion === "2025-06-18" && r.body.result.capabilities?.tools, JSON.stringify(r.body).slice(0, 200));
r = await rpc("initialize", { protocolVersion: "2099-01-01" });
check("initialize, unknown version → ours", r.body.result?.protocolVersion === "2025-06-18");

let n = await send("POST", { body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
check("notification → 202, empty", n.status === 202 && (await n.text()) === "");

r = await rpc("tools/list");
const tools = r.body.result?.tools || [];
check("tools/list = 3 annotated read-only tools", tools.length === 3 &&
  tools.every(t => t.title && t.annotations?.readOnlyHint === true && t.annotations.destructiveHint === false && t.name.length <= 64));

r = await call("lookup_error", { error: 'new row violates row-level security policy for table "profiles"' });
const m1 = r.body.result?.structuredContent?.matches || [];
check("lookup_error: RLS insert error", m1.length > 0 && /row-level-security|rls/.test(m1[0].slug), JSON.stringify(m1).slice(0, 300));

r = await call("lookup_error", { error: "PGRST205: Could not find the table 'public.todos' in the schema cache" });
const m2 = r.body.result?.structuredContent?.matches || [];
check("lookup_error: PGRST205", m2[0]?.slug === "supabase-could-not-find-the-table-in-the-schema-cache", JSON.stringify(m2).slice(0, 300));

r = await call("lookup_error", { error: "zzqx nothing like an error here" });
check("lookup_error: no match is not an error", r.body.result?.isError === false && /No guide matches/.test(r.body.result.content[0].text));

r = await call("lookup_error", {});
check("lookup_error: missing argument → isError", r.body.result?.isError === true);

const slug = m2[0]?.slug || "supabase-could-not-find-the-table-in-the-schema-cache";
r = await call("get_guide", { slug });
const g = r.body.result?.content?.[0]?.text || "";
check("get_guide: full text + source", g.startsWith("# ") && g.length > 1500 && g.includes(`Source: https://appfinishers.com/guides/${slug}/`), g.slice(0, 120));

r = await call("get_guide", { slug: "/guides/" + slug + "/" });
check("get_guide: path form accepted", r.body.result?.isError === false);

r = await call("get_guide", { slug, outline: true });
const o = r.body.result?.content?.[0]?.text || "";
check("get_guide: outline is short and numbered", /\nSections:\n1 · /.test(o) && o.length < g.length / 2, o.slice(0, 160));

r = await call("get_guide", { slug, section: 2 });
const s2 = r.body.result?.content?.[0]?.text || "";
check("get_guide: one section", /\(section 2 of \d+\)/.test(s2) && s2.length < g.length, s2.slice(0, 160));

r = await call("get_guide", { slug, section: 99 });
check("get_guide: section out of range → isError", r.body.result?.isError === true);

check("get_guide: no promotional text", !/we fix it|quick fixes are|free check-up|fixed price within/i.test(g));

r = await call("get_guide", { slug: "nope" });
check("get_guide: unknown slug → isError", r.body.result?.isError === true);

r = await call("list_guides", { filter: "lovable" });
const l = r.body.result?.content?.[0]?.text || "";
const rows = l.split("\n").filter(s => s.startsWith("- "));
check("list_guides: filter", /^\d+ guides/.test(l) && rows.length > 0 && rows.every(s => /lovable/i.test(s.split(" (slug:")[0])), l.slice(0, 120));

r = await call("list_guides", {});
check("list_guides: all", Number((r.body.result?.content?.[0]?.text || "").match(/^(\d+) guides/)?.[1]) >= 80);

r = await call("delete_everything", {});
check("unknown tool → -32602", r.body.error?.code === -32602);

r = await rpc("resources/list");
check("unknown method → -32601", r.body.error?.code === -32601);

let x = await send("POST", { body: "{not json" });
check("bad JSON → 400 -32700", x.status === 400 && (await x.json()).error?.code === -32700);

x = await send("POST", { body: JSON.stringify([{ jsonrpc: "2.0", id: 901, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 902, method: "tools/list" }]) });
const b = await x.json();
check("batch → 2 answers", Array.isArray(b) && b.length === 2 && b[0].id === 901);

x = await send("POST", { body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(70000) } }) });
check("oversized body → 413", x.status === 413);

x = await send("GET");
check("GET → 405", x.status === 405);

x = await send("OPTIONS");
check("OPTIONS → 204 + CORS", x.status === 204 && x.headers.get("access-control-allow-origin") === "*");

if (!LIVE) {
  x = await worker.fetch(new Request("https://appfinishers.com/other", { method: "POST", body: "{}" }));
  check("other path → 404", x.status === 404);
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
