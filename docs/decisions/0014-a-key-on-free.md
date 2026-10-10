---
title: The free plan has one API key; the api plan on request, unpaid for now
type: decision
status: accepted
date: 2026-10-10
---

# 0014. The free plan has one API key; the api plan on request, unpaid for now

**Context.** API keys came only with the `api` plan, which an admin switches on. The docs for
agents (ADR 0013) tell a person to hand their agent a key — so on `free`, which is what sign-up
gives, the agent path did not work at all, and the docs said "on request" with no price behind it.
Pricing was looked at on 10.10 (Plausible, Simple Analytics, Umami, Short.io, Dub; catchall.in's
prepaid balance): clx's costs per user are small, since the counting runs in the user's own
Cloudflare account, so what a paid plan would sell is the management of many accounts and sites,
not traffic.

**Decision.**
- `free` gets **one API key**, with free's limits (one Cloudflare account, 10 sites, 200 links).
  A key of any plan authenticates; a plan only sets how many keys and objects there may be. The
  error `plan_required` is gone.
- `api` stays: 50 accounts, 500 sites, 10,000 links, 5 keys — switched on by an admin **on
  request, without payment** for now.
- No paid plan is built yet. The aim, when one is: a prepaid balance charged per connected
  Cloudflare account per day, as catchall.in charges per domain — it fits integrators who pay for
  the customers they connect. Prices then.

**Rejected.** Monthly tiers by sites now (needs subscriptions, and there are no customers to price
from); keys on `api` only (the agent path is the product's front door).

**Consequences.** A user who had keys on `api` and is moved back to `free` keeps them working;
issuing a new one then needs revoking down to one. The request channel for `api` is still to be
named (docs/TODO.md).
