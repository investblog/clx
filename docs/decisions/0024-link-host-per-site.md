---
title: Link hosts per site, random labels, made as Workers Custom Domains
type: decision
status: accepted
date: 2026-10-11
---

# 0024. Link hosts per site, random labels, made as Workers Custom Domains

Supersedes [ADR 0008](./0008-link-host-and-codes.md) (one link host per account, links keyed by
code alone).

**Context.** One link host per Cloudflare account meant every site of a network kept in one account
shared one `go.` host — a footprint tying the sites together, against what the counter is built
for (§5). casino-platform, the first integrator, runs ~73 brand sites on two accounts. The owner
made a link host per site a must-have, its label not `go` but random, up to 3 characters
(11.10.2026). A host per site also needs a DNS record per site: the user making 73 records by hand
was no option, and clx makes no DNS records (§13 item 2).

**Decision.**
- **Many link hosts per account**, up to the plan's site limit per user. `POST /v1/link-hosts
  {site_id}` makes `<label>.<site host>` (`www.` dropped) with a random label of 3 characters
  `[a-z0-9]`; `{account_id, host}` takes a named host.
- **A Workers Custom Domain of `clx-edge`**, made with the working token as it is. Tried live
  against the alternatives (`scripts/probe-link-hosts.mjs`, two runs): with clx's rights alone
  Cloudflare creates the proxied record and the certificate and the host answers within seconds; a
  host that already has a record is refused (`409` `100117`), so nobody's record is taken over — a
  random label is tried again with another; removing the domain removes its record. No route.
- **A link belongs to a host**; its code is unique on that host; the worker reads `link:<host>/<code>`.
- `PUT /v1/accounts/{id}/link-host` is gone (no outside user had it; the first integrator moved
  before shipping). Link hosts take the `links` scope.
- Deleting a link host is refused while it has live links; deleting a site leaves its hosts.

**Rejected.**
- *DNS Write and a proxied `AAAA 100::` with a route*: works, but the right lets clx change any
  record of the user's zones; slower too (up to 25 s).
- *The user or the integrator makes the record* (the old way): 73 records for one network.
- *A 1-character label*: 36 hosts per site's domain at most, most of them common (`a.`, `m.`).
- *`link:<code>` with many hosts*: two sites could not have the same code.

**Consequences.** A new worker bundle (the key of a link changed); an account installed with an
older one needs the update before its links work again — none was live. Each link host is a custom
domain in the user's account, listed in their dashboard under the worker.
