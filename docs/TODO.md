---
title: clx — backlog
updated: 2026-10-07
---

# Backlog

v2 stages — [`docs/spec.md`](./spec.md) §14.

Owner's steps (stages 5–7 are built; these open them to real users), in this order — Turnstile
last, or sign-ups would make users whose confirmation e-mail never comes:
- [x] Email Sending: clx.cx onboarded through the API (07.10; records on `cf-bounce` only, the
      zone's own mail server keeps the apex MX, SPF and DMARC). Delivery to an outside mailbox checked.
- [x] `abuse@clx.cx` (the /abuse page names it): an alias on the zone's own mail server (07.10).
- [x] The probes' inbox: Email Routing on `t.clx.cx`, rule `probe@t.clx.cx` → the worker
      `clx-mailbox` (`mailbox/`), which keeps each message a day in KV; `probe+<tag>@t.clx.cx` works.
- [x] Turnstile: the widget `clx.cx` (managed) made through the API on 07.10; its site key is in
      `TURNSTILE_SITE_KEY` (`wrangler.jsonc`), its secret in the Worker secret `TURNSTILE_SECRET`.
- [x] The live check of stage 6 (10.10): a real sign-up to `probe+live1@t.clx.cx`, the confirmation
      link, a reset (sessions ended, password changed), both used links refused (`invalid_token`), a
      sign-in with the new password, the account deleted with nothing of it left in D1. Mail passed
      DKIM, SPF and DMARC.
- [ ] Read /privacy, /terms, /abuse (drafts; legal review is out of the spec's scope).
- [ ] A way to ask for the `api` plan: /agents, /api and auth.md say clx switches it on "by
      request" but name no address or form (10.10). The channel will be a Telegram support bot, as
      on the owner's other projects; then link it from those pages and the keys page.
- [ ] `GET /v1/me` mixes field styles: `limits` is camelCase (`cfAccounts`, `rulesPerLink`), `use`
      snake_case (`cf_accounts`) — found by the live agent run of /agents (10.10). Pick snake_case
      before outside integrators rely on it, and document both objects in openapi.yaml.
- [ ] Scan a link's QR code with a phone → a click with source `qr` (stage 5's check).
- [ ] Stage 7: the `301st` organisation on npm and `npm login`; then `@301st/qr-svg` is published
      and `src/qr` gives way to the dependency (ADR 0009).

- [ ] Open questions of spec §13, on a test Cloudflare account: rights for Workers Custom Domains.
      (A route on a Pages host — verified 05.10, §13 item 9; an ignored `INSERT OR IGNORE` writes
      0 rows — verified 05.10, `cloudflare-facts.md`.)
- [ ] `MASTER_KEYS` rotation tool (a new key in front, re-encrypt, drop the old one) — before the
      first key needs replacing.
- [x] Sign-out: the page showed the sign-in form even when `/auth/logout` failed, so the refresh
      cookie stayed valid behind it — now it stays on the page and says the session is not ended (07.10).
- [x] A deleted user's sessions opened a new user who got the same id (SQLite reuses the highest
      freed rowid; both started at session version 0; Codex 07.10). New users now start at the
      sign-up time as their session version.
- [ ] Proxy mode for the counter (a site not on Cloudflare) — after v2, if needed.
- [ ] `over` from "pushes reporting write failures" (§8): the heartbeat carries the worker's error
      text only, with no clean sign of a failed D1 write — add one to the push body when it is
      needed. (The advice e-mails, the silence, renew and revoked e-mails — done in stage 6c.)
- [ ] Account e-mails are not retried: a notice whose send fails (no `EMAIL`, Email Sending down)
      is lost — the state it reports is still on the account's page.
- [ ] The API's share of the per-account write budget (§8): idempotency rows and changes made
      through `/v1` are not counted yet — only the receiver's writes are (stage 4c).
- [x] Flaky tests — Windows runs out of outgoing ports. **10.10: the owner widened the range on the
      dev machine** (`netsh int ipv4 set dynamicport tcp start=10000 num=55000`); `test/ports.ts` now
      waits only while fewer than 15,000 of the range's ports are free, so there it does not wait. A
      machine on the default range still waits; the lasting fix there is a D1 for tests without the
      proxy. History: 07.10 evening a pre-push failed with `EADDRINUSE` in the middle of a run after
      starting below 1,500 TIME_WAIT sockets, and 10.10 twice more. Miniflare closes the connection after every
      proxied call (`options.reset = true` in its `DispatchFetchDispatcher`), so each D1 call takes a
      port; a full run leaves ~11,000–13,000 sockets in TIME_WAIT (of 16,384 dynamic ports, ~2 min),
      and a second run soon after failed random tests with `connect EADDRINUSE`. Batching the tests'
      own setup calls saved ~3%: the app's calls are the bulk. Not patched in miniflare (a pinned
      alpha of wrangler).
- [x] A site added while its account is being disconnected: the route made in that moment was
      dropped by `placeRoute` when the row was gone, but only if that call worked. Now a route is
      made and recorded under the account's lease, which disconnect takes too (sites, link hosts,
      rotation); a busy lease leaves the route to the cron, or refuses a rotation (07.10).
- [ ] A new script's crons may not fire at all for an hour or more when `clx-edge` is re-created
      within minutes of being deleted (the operations log 05–06.10: reinstalls 0.5–4.5 min after a
      disconnect got no `setup_ok` in 4 of 4, 6+ min after got one in 6 of 7; see
      `docs/cloudflare-facts.md`). Not a controlled test. To check: two installs, 1 and 10 min
      after a disconnect. If it holds — hold a reinstall back for ~5 min after a disconnect, or say
      so in the UI. Until then the heartbeat (26 h) is the backstop. 10.10 a counterexample: an
      install three days after the last delete got no cron for 80 min either (`probe-totals`; the
      upgrade advice passed, the report and the push were not reached). So the delay is not only
      about quick reinstalls — what triggers it is unknown.
- [x] Check the pages at phone width (stage 4e): 10.10, emulated 390 px through chrome-devtools —
      home, connect, keys, new site, new link, account, site, report and /privacy have no horizontal
      scroll and nothing past the screen.
- [ ] Nightly backup of the clx.cx D1 to R2 (as 301 does) — after the release: R2 needs a paid
      plan switched on in the clx.cx account (owner's decision 06.10.2026).
