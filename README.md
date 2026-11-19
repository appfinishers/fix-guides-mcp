# App Finishers fix guides: MCP server

A public, read-only [MCP](https://modelcontextprotocol.io) server. Paste an error from an app built with Lovable,
Bolt, Replit, Cursor or Supabase into your AI assistant, and it can look up the matching App Finishers guide and walk
you through the fix.

- **Endpoint:** `https://appfinishers.com/mcp` (Streamable HTTP)
- **No account, no key, no cookies.** The server stores nothing and calls no other service: every answer comes from
  the guides bundled in this repository.
- **Registry:** listed in the official MCP Registry as `com.appfinishers/fix-guides`.
- **Docs:** https://appfinishers.com/connector/

## Tools

| Tool | What it does |
|---|---|
| `lookup_error` | Takes the exact error text and returns the best-matching guides, with their links. |
| `get_guide` | Returns one guide: the whole text, only its numbered sections (`outline: true`), or a single `section`. |
| `list_guides` | Lists every guide by group, with an optional filter on the title. |

All three are marked read-only (`readOnlyHint: true`). They change nothing anywhere.

89 guides (November 2026), in seven groups: Supabase database · Supabase Auth and logins · Edge Functions, Stripe and
email · Lovable · Bolt, Replit and others · MCP servers · Other.

## Add it to your assistant

- **Claude:** Settings → Connectors → add a custom connector → `https://appfinishers.com/mcp`
- **Claude Code:** `claude mcp add --transport http app-finishers https://appfinishers.com/mcp`
- **Cursor, VS Code, Windsurf, Zed and other MCP clients:** add a remote server with the same URL (Streamable HTTP).

Try: *"My Supabase insert fails with: new row violates row-level security policy for table profiles. Find the fix
with App Finishers."*

## How it works

`src/index.js` is a Cloudflare Worker that speaks MCP over Streamable HTTP in stateless mode: each JSON-RPC POST gets
one JSON response, notifications get `202`, and `GET` returns `405` (no event stream). There is no session to keep.

`lookup_error` scores the error text against each guide's error patterns, the same matching as the
[error lookup page](https://appfinishers.com/errors/).

`src/data.json` holds the guides and their error patterns. `build_data.py` generates it from the App Finishers
website build, which is not part of this repository. It's included so you can see exactly how the data is made.

## Develop

```sh
npm test                                  # tests against the Worker module (Node 22+)
node test.mjs https://appfinishers.com/mcp  # the same tests against the live endpoint
npx wrangler deploy                       # deploy (the route in wrangler.toml is ours: change it for your zone)
```

No dependencies to install.

## Privacy

The server receives only what your assistant sends for a request: the error text, a guide name or search words. It
uses them to answer that one request, keeps no logs of them and sets no cookies. Full policy:
https://appfinishers.com/privacy/

## License

The code is MIT, see [LICENSE](LICENSE). The guide texts in `src/data.json` are © 2026 App Finishers, all rights
reserved: read them freely here or through the server, but don't republish them.

Questions, a wrong match or a security concern: hello@appfinishers.com
