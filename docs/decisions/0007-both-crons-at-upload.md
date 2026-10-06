---
title: The working cron is set at upload, next to the self-check
type: decision
status: accepted
date: 2026-10-06
---

# 0007. The working cron is set at upload, next to the self-check

**Context.** An install put only the every-minute self-check cron on the new `clx-edge` and replaced
it with the working `5 * * * *` after `setup_ok` (or after 15 minutes without one). Two live
installs (05–06.10.2026) showed that changing a **new** script's crons takes effect late: the
schedules API shows the new cron at once, but the old one kept firing for ~94 minutes and the new
one missed its first `:05`; the first push came ~1 h 45 min after the install. The day before, a
replacement fired ~46 minutes later. See `docs/cloudflare-facts.md`.

**Decision.** At upload both crons are set together — `* * * * *` and `5 * * * *`. Confirmation
(or its timeout, or an update's rollback) leaves the working cron alone. The worker already tells
the two apart by `controller.cron`, so only clx.cx changes. When the account has only one cron
trigger free (4 of Free's 5 in use), the self-check goes alone as before and the working cron
follows it; with none free the install stops with `cron_limit`, as before. An update does the same,
so a rollout that spans `:05` does not skip an hourly push.

**Alternatives.** Leave it and document a first push up to ~2 hours late — the user sees an empty
report for the first two hours. One every-minute cron for good, the worker doing its hourly work at
minute 5 — no cron change ever, but ~1,440 invocations a day from the user's Free quota (~1.4%) and
a new bundle and rollout. Rejected in favour of the clx.cx-only change.

**Consequences.** For the first minutes (or, as measured, up to ~1.5 h) after an install the
account holds two cron triggers; an account with 4 in use gets the old, slower path. The lagging
self-check keeps calling `/hook/setup` after confirmation and gets `409` — harmless, as before.
