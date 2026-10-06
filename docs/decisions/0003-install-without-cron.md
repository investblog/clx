---
title: An install is ready without its first cron
type: decision
status: accepted
date: 2026-10-05
---

# 0003. An install is ready without its first cron; `setup_ok` only confirms

**Context.** The first draft made an install wait for the new worker's self-check cron to call
`/hook/setup` (`setup_ok`) and undo the install without it. Live installs (05.10.2026, five of
them) showed the cron of a **new** script is unreliable: first runs after ~4.5, ~5.5 and ~6.5
minutes, once at once and then not for 14 minutes, once not at all within 15 minutes. The cron of an
**updated** script came within 40–49 s.

**Decision.** An install is `ready` once the script, its database and the cron are in place — the
counter and its script need no cron. `setup_ok` only confirms; with none within 15 minutes the
account is marked `not_confirmed`, the working cron is set anyway, and the install is not undone.
Whether the cron really runs is shown by the hourly pushes: 26 hours of silence is "no connection".
An update still waits for `setup_ok` — there the cron is reliable and a rollback is cheap.

**Alternatives.** Waiting longer (30–60 min) — still no guarantee, and the user waits. Undoing an
install on a missing `setup_ok` — in a live check it failed an install whose counter was already
serving, only because the new cron had not fired. Rejected.

**Consequences.** An install can be `ready` with a cron that never runs; the heartbeat catches it
within 26 hours. On 05–06.10.2026 `setup_ok` did not come in 2 of 2 later installs while the
hourly cron did run — tracked in `docs/TODO.md`.
