---
title: Upgrade advice — schedule, signals, failures
type: decision
status: accepted
date: 2026-10-06
---

# 0005. Upgrade advice: once a UTC day, backpressure read from size, 401 left to the token check

**Context.** Spec §8 asks for a daily advice per Cloudflare account from measured use. Building it
raised choices the spec did not settle.

**Decision.**
- **Schedule.** Due at most once per UTC day and never sooner than 20 hours after the last run:
  next = max(now + 20 h, start of the next UTC day). A plain "every 20 hours" recomputed the same
  7 complete days twice on some days. A slice of accounts per hourly run.
- **Backpressure** is not a separate signal from the worker: it is on exactly when the database is
  at 400 MB (`FULL_BYTES`), so the advice reads it from the size — 400 MB is `over`.
- **Size** is judged by its current value from the D1 REST API, without a trend; it grows slowly,
  and when it alone is the problem the advice suggests shorter hourly retention.
- **Failures.** `403` (no right, no dataset) leaves that metric unavailable — shown, not guessed.
  `401` stores nothing and sets the account's token check due at once: `revoked` is the token
  check's state (§3), not the advice's. Anything passing (`429`, `5xx`, network) is retried the
  next hour.
- **Shown** only while the account is in service (`ready`, `no_connection`); an account no longer
  measured shows no advice rather than a stale one.
- Facts it rests on: the datasets keep 90 days on Free and one query spans at most 32 days
  (`cloudflare-facts.md`, 06.10.2026); sums are taken by date only, never per script.

**Alternatives.** A backpressure flag in the push body — one more field for a fact the size
already gives. A trend for size — 7 points of a slowly growing value forecast noise. Treating 401
as "unavailable" — showed a ready account with "ok" advice until the token check came round.
Rejected.

**Deferred.** "Pushes reporting write failures" as an `over` signal: the heartbeat carries only the
worker's error text; a clean sign needs a push body field (`docs/TODO.md`). E-mails — stage 6.
