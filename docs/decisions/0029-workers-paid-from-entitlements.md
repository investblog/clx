---
title: The upgrade advice reads Workers Paid from the account's entitlements
type: decision
status: accepted
date: 2026-10-15
---

# 0029. The upgrade advice reads Workers Paid from the account's entitlements

**Context.** The upgrade advice (§8, [ADR 0005](./0005-upgrade-advice.md)) judged every account
against Workers Free's daily limits. An account already on Workers Paid then got "hit a limit of the
free Workers plan — D1 reads 13,027,061 of 5,000,000 … moving to Workers Paid lifts the limit"
(15.10.2026, the clx.cx account itself: the limits are account-wide, so its own database's reads
counted). On Paid these counts are included in the plan and billed beyond it; nothing stops.

**Decision.** Each time the advice is computed, clx reads `GET /accounts/{id}/entitlements` with the
working token. An entitlement `d1.max_storage_per_db_mb` above Free's 500 MB (10,000 on Paid) means
Workers Paid. Then requests, writes and reads are not judged, only the size of `clx-edge` is —
against its backpressure point, 400 MB, where it stops keeping detail on any plan, not Free's 500 MB;
the advice carries `paid: true`; no e-mail is sent and the page shows no banner, only the advice
card with a line saying the account is on Paid. Entitlements refused (`403`) leave the account
judged as Free, as before; a passing failure (`429`, `5xx`, the network) holds the whole advice to
the next hour, like the other readings — a Paid account is not told to move on a hiccup.

**Why this signal.** Probed live on 15.10.2026 (`scripts/probe-plan.mjs`, a token with exactly the
working token's account rights, on a Paid and a Free account, run twice):
- `GET …/subscriptions` and `…/billing/profile` answer `403` — they need a billing right the working
  token does not have, and asking every user for one means renewing every connection;
- `GET /accounts/{id}`, `…/workers/account-settings`, the scripts' `usage_model` and the GraphQL
  dataset settings are the same on both;
- `…/entitlements` answers `200` on both: 70 entries on the Paid account, among them
  `d1.max_storage_per_db_mb = 10000` and `workers.enabled = true`; 9 on the Free account, none about
  Workers or D1. The D1 size is the one that matches a documented Paid/Free difference (10 GB vs
  500 MB a database).

**Rejected.** A switch the user sets ("this account is on Workers Paid"): clx could be told wrong
and would stay silent on an account that went back to Free. A billing right on the working token:
every connected account would have to renew its token for it.

**Risk.** One Paid and one Free account were compared; entitlements are not documented as a plan
signal. A Free account that listed a larger D1 size would lose its warnings — so only the size is
read, not the mere presence of Workers entries, and a list refused (`403`) keeps the old behaviour.
