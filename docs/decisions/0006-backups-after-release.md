---
title: Backups of the clx.cx database — after the release
type: decision
status: accepted
date: 2026-10-06
---

# 0006. Backups of the clx.cx database to R2 — after the release

**Context.** A nightly export of the service's own D1 to R2 is the usual safety net. In clx the
raw events stay in the users' own accounts; clx.cx holds accounts, settings, encrypted tokens and
totals (spec §7). The question came up: why not move bulk data to R2 as well.

**Decision.** R2 is for backups only, not for counting data — totals are small and already bounded
(hours 2 days, days 400 days). The nightly backup to R2 waits until after the release: R2 needs a
paid plan switched on in the clx.cx account (owner's decision, 06.10.2026).

**Consequences.** Until then a lost clx.cx database means lost accounts, settings and totals
history; the users' workers keep counting in their own accounts, and their detail (hourly 31 days,
daily 400 days) stays there, but they would have to connect again. Tracked in `docs/TODO.md`.
