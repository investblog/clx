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
      in pushes, stage 4.
- [ ] Watch how late a new script's first cron fires (4.5 min on 05.10.2026; the self-check
      allows 15) — if it grows, the timeout moves to `src/cf/deploy.ts` config.
