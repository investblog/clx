---
title: The worker-side sync check rides on the heartbeat
type: decision
status: accepted
date: 2026-10-06
---

# 0001. The worker-side sync check rides on the heartbeat

**Context.** clx.cx writes a site's config into the user's D1 as versions plus a commit (spec §6).
If that database is changed elsewhere — restored, edited by hand — its head may differ from what
clx.cx synced while clx.cx has nothing new to write, so its own check (head ahead of its revision)
never fires. The first draft had the worker ask `GET /hook/sync` and compare.

**Decision.** Every push already carries a heartbeat (§7); it now also carries the worker's latest
commit, `revision`. clx.cx compares it with what it synced — only when no sync of the account is
pending and none finished in the last 10 minutes, since the worker reads its head shortly before it
pushes — and on a mismatch moves its revision above both and writes every site again.

**Alternatives.** `GET /hook/sync` from the worker: one more request per hour per account, and the
worker cannot know whether a sync is in flight, so it would raise false alarms or need a second
round trip. Rejected.

**Consequences.** No new endpoint, no extra request. A mismatch is noticed within an hour of the
next push. A silent worker (no pushes) is not checked — it is "no connection" anyway (§4).
