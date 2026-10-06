---
title: The report is "as of" the last hour sent
type: decision
status: accepted
date: 2026-10-06
---

# 0004. The report is "as of" the last hour sent, breakdowns included

**Context.** A report mixes two sources (spec §7): totals and series from clx.cx, which has only the
hours the worker has pushed (closed hours, sent at :05), and breakdowns read live from the user's
D1, which already counts the open hour. Read naively, the breakdowns could sum to more than the
totals, and an hourly series drawn up to "now" would end in a false zero for the open hour.

**Decision.**
- `as_of` = the end of the latest closed hour the worker sent today (the start of today when none
  came yet). The series stops there; the breakdowns query reads the user's D1 up to the same hour.
- Closed days come from the daily detail, days not closed yet from the hourly detail — never both,
  so a closed day whose hours are still kept (31 days) is not counted twice.
- The breakdowns are one parameterised statement (D1 takes one statement with params) with a
  5 s timeout. Anything that keeps them from coming — Cloudflare `429`/`5xx`/timeout, no or an
  unreadable token, an account out of service, the per-user limit — gives `200` with the totals,
  `breakdowns: null` and the reason. The report never changes the account's state; the token
  check does that (§3).
- The 5-minute cache and the merge of identical requests hold the rate-limit check inside the
  shared request, so a burst of one report spends one request of the limit.

**Alternatives.** Breakdowns "live" up to now — fresher, but they disagree with the totals on the
same screen. A failed breakdown read as an error response — the totals, which clx.cx has, would be
lost to a problem in the user's account. Rejected.

**Consequences.** Breakdowns lag up to an hour, like the totals. A worker that stopped pushing
freezes the whole report at its last hour — consistent, and the status page says why.
