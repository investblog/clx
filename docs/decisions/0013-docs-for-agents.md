---
title: Docs for agents, with the API reference generated from the contract
type: decision
status: accepted
date: 2026-10-10
---

# 0013. Docs for agents, with the API reference generated from the contract

**Context.** clx is meant to be set up by agents and site generators through `/v1` (§15), but the
contract, `docs/openapi.yaml`, was nowhere on clx.cx, and nothing told an agent what to ask its
person for or in which order to call. The sibling project catchall.in solved the same problem with
a page for agents, a hand-written API page, markdown copies and discovery files; its lessons were
that the markdown must be made from the same HTML, and that Cloudflare's Browser Integrity Check
silently refuses the Python standard library.

**Decision.**
- `/agents` is written by hand (`site/agents.ts`): what to ask the person for (the key, the
  account ID, a bootstrap token with exact steps), connect → site → links → reports with curl,
  the generator's three calls, ground rules, a cheat sheet. The skill file, `auth.md` and
  `llms.txt` sit beside it.
- `/api` is **generated from `docs/openapi.yaml`** (`site/api.ts`), not written by hand as in
  catchall.in: the YAML is already held to the routes by a test, so the page cannot list an endpoint
  the code does not have. Only the conventions at its top are prose. The YAML and its JSON are
  served as they are.
- The agent docs are **English only**: the reader is a program; the Russian footer links them in
  English.
- Markdown copies are made from the rendered `<main>` by turndown at build time. At the page's own
  address, `Accept: text/markdown` (explicit, q > 0, not below `text/html`; wildcards never) gets
  the copy: those three paths run the Worker first (`src/markdown.ts`), which reads both files through
  the assets binding — `_headers` still applies to them (checked in `wrangler dev`).
- Discovery as catchall.in has it: `api-catalog`, the skills index with a sha256 digest, `auth.md`
  at the root and under `/.well-known/`, a `Link` header on the site's pages, Content-Signal in
  robots.txt with training allowed (the owner's choice on catchall.in, taken over here).
- Browser Integrity Check is **off** on the clx.cx zone (10.10, `docs/cloudflare-facts.md`): it
  answered `1010` to `Python-urllib` on the API too. On users' zones clx changes nothing; the agent
  page says what their settings may do.

**Rejected.** A hand-written `/api` (drifts from the routes); an MCP server (the docs and the skill
cover an agent; later, if asked); OAuth or self-registration stubs for agent scanners (they would be
false); per-language agent docs.

**Consequences.** A change to the API is a change to `docs/openapi.yaml`, and the page follows on the
next deploy. `scripts/check-site.mjs` fails the build when a file for agents is missing, a link in
one leads nowhere, a markdown page is not in `run_worker_first`, or the skill's digest is stale.
