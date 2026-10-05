---
title: clx — backlog
updated: 2026-10-05
---

# Backlog

v2 stages — [`docs/spec.md`](./spec.md) §14.

- [ ] Open questions of spec §13, on a test Cloudflare account: rights for Workers Custom Domains,
      whether `INSERT OR IGNORE` that inserts nothing counts as a D1 write. (A route on a Pages
      host — verified 05.10, §13 item 9.)
- [ ] The "renew the connection" e-mail 30 days before a working token expires (§3 item 6) — with
      e-mail sending, stage 6.
- [ ] `MASTER_KEYS` rotation tool (a new key in front, re-encrypt, drop the old one) — before the
      first key needs replacing.
- [ ] How many days the GraphQL Analytics datasets keep on Free (§8) — check before the upgrade
      advice (stage 4).
- [ ] Sign-out: the page shows the sign-in form even when `/auth/logout` failed, so the refresh
      cookie may stay valid — show the error or retry (stage 6, with sign-up).
- [ ] Proxy mode for the counter (a site not on Cloudflare) — after v2, if needed.
- [ ] The `no_connection` account state (§15) and the 26-hour silence e-mail — with the heartbeat
      in pushes, stage 4c.
- [ ] The worker-side sync check (§6: `GET /hook/sync`, `sync_stale` in the heartbeat) — stage 4c;
      until then a worker database changed by hand with no change pending on clx.cx is found only
      at the account's next config change.
- [ ] Flaky tests: on 05.10.2026, 2 of 8 full runs failed — different tests each time (old connect
      tests too, an auth test once), while the machine was short of memory; the failure text was
      not captured. Find the cause before adding more timing-sensitive tests.
- [ ] A site added while its account is being disconnected: the route made in that moment is
      dropped by `placeRoute` when the row is gone, but only if the token still works.
- [ ] Watch how late a new script's first cron fires (4.5 min on 05.10.2026; the self-check
      allows 15) — if it grows, the timeout moves to `src/cf/deploy.ts` config.
