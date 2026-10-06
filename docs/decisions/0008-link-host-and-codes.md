---
title: One link host per account, links keyed by code alone
type: decision
status: accepted
date: 2026-10-06
---

# 0008. One link host per account, links keyed by code alone

**Context.** The spec gave the link host as the user's choice of host and the sync as rows keyed
by "a site host or a link code", but did not say how many link hosts an account has, what changing
it does, or whether a link's code can change. The worker must tell a link host — routed whole, no
origin behind it — from a site's host, where everything outside the counter's path passes through.

**Decision.** One live link host per Cloudflare account, its own row (`link_hosts`) with its route
`<host>/*`, synced as `linkhost:<host>`. Links are synced as `link:<code>`, without the host: a code
is unique within the account, so replacing the host rewrites one row, not every link, and the
links keep working on the new host. A link's code never changes — printed QR codes carry it; a
deleted link frees its code. On a link host the worker answers everything itself: a code redirects,
anything else is a plain `404`; on any other host a request it does not own still passes through.

**Alternatives.** Keys `link:<host>/<code>` — allows several hosts per account, but a host change
rewrites every link (10,000 rows at the `api` maximum) and leaves the old keys behind. Several link
hosts per account — no one asked for it; the table can take it later. An editable code — breaks
every printed QR code silently.

**Consequences.** A sync range can hold a deleted and a re-added host or code under the same key;
the sync writes one row per key, the live one (this also closed the same gap for a site host
deleted and added again before its sync). A host a link points at cannot become the link host, so a
link never redirects to itself.
