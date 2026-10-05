---
title: clx — backlog
updated: 2026-10-05
---

# Backlog

v2 stages — [`docs/spec.md`](./spec.md) §14.

- [ ] Open questions of spec §13, on a test Cloudflare account: rights for Workers Custom Domains.
      (A route on a Pages host — verified 05.10, §13 item 9; an ignored `INSERT OR IGNORE` writes
      0 rows — verified 05.10, `cloudflare-facts.md`.)
- [ ] The "renew the connection" e-mail 30 days before a working token expires (§3 item 6) — with
      e-mail sending, stage 6.
- [ ] `MASTER_KEYS` rotation tool (a new key in front, re-encrypt, drop the old one) — before the
      first key needs replacing.
- [ ] How many days the GraphQL Analytics datasets keep on Free (§8) — check before the upgrade
      advice (stage 4).
- [ ] Sign-out: the page shows the sign-in form even when `/auth/logout` failed, so the refresh
      cookie may stay valid — show the error or retry (stage 6, with sign-up).
- [ ] Proxy mode for the counter (a site not on Cloudflare) — after v2, if needed.
- [ ] The 26-hour silence e-mail (§4) — with e-mail sending, stage 6. (The `no_connection` state
      itself — done in stage 4c.)
- [ ] The API's share of the per-account write budget (§8): idempotency rows and changes made
      through `/v1` are not counted yet — only the receiver's writes are (stage 4c).
- [ ] Flaky tests: on 05.10.2026, 2 of 8 full runs failed — different tests each time (old connect
      tests too, an auth test once), while the machine was short of memory; the failure text was
      not captured. Find the cause before adding more timing-sensitive tests. Again on 05.10 with
      memory to spare: one full run failed `test/deploy.test.ts` as a whole file (all its tests
      skipped), the file alone and the next three full runs passed — a suite-level setup failure,
      text again not captured (vitest printed only the file name).
- [ ] A site added while its account is being disconnected: the route made in that moment is
      dropped by `placeRoute` when the row is gone, but only if the token still works.
- [ ] Watch how late a new script's first cron fires (4.5 min on 05.10.2026; the self-check
      allows 15) — if it grows, the timeout moves to `src/cf/deploy.ts` config.
