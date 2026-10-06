---
title: A closed day's totals wait in final_days
type: decision
status: accepted
date: 2026-10-06
---

# 0002. A closed day's totals wait in `final_days`, not in new columns of `totals`

**Context.** When the worker closes a day it must keep the day's final totals with the visitor
count (the visitor hashes are deleted at the close) until clx.cx accepts them, with a retry count.
The natural place looked like new columns on `totals` (`visitors`, `final_sent`, `attempts`).

**Decision.** A separate `WITHOUT ROWID` table `final_days(target, day, views, bots, visitors,
attempts)`, filled by the close (`ON CONFLICT DO NOTHING` — the first close wins) and emptied as
clx.cx accepts the items.

**Why.** The user-side schema is applied by clx.cx through the D1 REST API, and a call that stops
halfway must be safe to repeat (spec §4). `CREATE TABLE IF NOT EXISTS` repeats; `ALTER TABLE ADD
COLUMN` fails the second time (checked live, `cloudflare-facts.md`). A repeated close must not zero
the visitor count either — with the hashes gone, a second count would be 0; the table's
first-close-wins insert prevents that.

**Consequences.** One more table and 2 writes per active target per day (row in, row out — counted
in the §8 overhead of 4). `totals` rows can be deleted on their own schedule.
