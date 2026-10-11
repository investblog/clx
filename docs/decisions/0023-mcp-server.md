---
title: An MCP server at /mcp over the same /v1, signed in with the API key
type: decision
status: accepted
date: 2026-10-11
---

# 0023. An MCP server at /mcp over the same /v1, signed in with the API key

**Context.** clx.cx had what an agent reads — `/agents`, `/api`, the markdown copies, the API
catalog, an agent skill — but no door an MCP client could use. isitagentready.com rated the site
level 4 of 5: no MCP server card, no A2A card, no OAuth metadata, no DNS-AID record. Publishing
those without a server behind them would point agents at nothing. spintax.net, of the same owner,
runs a stateless MCP server on its own protocol layer (its ADRs 0002, 0005, 0006).

**Decision.**
- `POST /mcp` on clx.cx: a stateless MCP server over Streamable HTTP, revision `2026-07-28` and the
  four before it through `initialize` (spec §15).
- **Tools call `/v1` inside the Worker** with the caller's headers. One implementation: scopes,
  allow lists, the rate limit, idempotency, validation and the error codes are `/v1`'s. A tool per
  `/v1` call an API key may make; the page-session-only calls (keys, language, deleting the account)
  are not tools.
- **Sign-in is the API key** as a bearer header. Listing (`initialize`, `server/discover`,
  `tools/list`, resources) is open; `tools/call` without a key is `401` with `WWW-Authenticate`.
- **Idempotency**: an optional `idempotency_key` argument on every mutating tool; without one the
  server makes one per call, and the tool's description says a repeat is then not protected.
- **No SDK**: the TypeScript SDK spoke only the older revisions when spintax.net chose its own
  layer; clx follows that layer's behaviour, including its lessons — the body capped by bytes, an
  unknown argument refused, a tool's failure as an `isError` result.

**Rejected.**
- *OAuth now*: it would let claude.ai's connectors in, but it is an authorization server to build
  and run; later, as its own decision. Until then no OAuth metadata is published.
- *Only read and create tools*, without disconnect and delete: an agent with a key can already do
  those through `/v1`; the tools carry `destructiveHint` instead.
- *A2A Agent Card, WebMCP, an ARD manifest*: clx has no agent of its own and no in-page tools to
  describe.

**Consequences.** The tools follow `/v1`: a test holds them to `docs/openapi.yaml`, so a new
endpoint without a tool (or a tool for a removed one) fails. The server card, the API catalog and
`/agents` name the server; the DNS-AID record and the registry entry wait for the owner.
