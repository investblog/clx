---
title: clx — backlog
updated: 2026-11-08
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
- [x] A way to ask for the `api` plan: `/support` in the bot (§17, ADR 0031), named on /agents, /api,
      auth.md, the pricing page and the keys page (19.10).
- [x] The Telegram bot (§17, ADR 0030): @clxcxbot on `POST /hook/telegram`, live 16.10 (the
      webhook, sign-in by a mailed code, `/sites` `/links` `/accounts`, adding sites and links,
      `/connect`, the notices).
- [x] The bot's first live conversation from a phone: checked by the owner 16.10. Its profile texts
      are English by default and Russian for a Russian Telegram (`scripts/tg-setup.mjs describe`).
- [x] The Russian pages on `ru.clx.cx` (§16, ADR 0030): live 16.10 — the pages on a public
      repository's `gh-pages` (`scripts/deploy-ru.mjs`), the DNS-only `CNAME` `ru` → the Pages host,
      HTTPS enforced; clx.cx answers 301 for `/ru`, `/ru/` and the old Russian pages, `/ru/app` and the card at
      `/ru/signin` stay. Pages issued its certificate only after the custom domain was set again once the
      `CNAME` resolved (set before it, nothing came for 35 minutes).
- [x] `ru.clx.cx` in Search Console: the domain property `clx.cx` covers it; its sitemap submitted
      17.10 and read the same day (14 pages).
- [x] Resubmit the clx.cx sitemap (last read 14.10, before the Russian pages left it): the owner, 18.10.
- [x] `GET /v1/me` mixes field styles: `limits` is camelCase (`cfAccounts`, `rulesPerLink`), `use`
      snake_case (`cf_accounts`) — found by the live agent run of /agents (10.10). Pick snake_case
      before outside integrators rely on it, and document both objects in openapi.yaml. Done 11.10,
      before the MCP server (ADR 0023) handed it to agents.
- [ ] Scan a link's QR code with a phone → a click with source `qr` (stage 5's check).
- [ ] **A connect can fail on a token Cloudflare has not spread yet** (`probe-install`, 08.11). The
      new working token read the account, then answered D1 with `401` through all five retries
      of `settled()` (`src/cf/connect.ts`, ~7.5 s in all); the connect failed `token_check_failed`
      and a user would have to start again. The next run passed. Retry `401` for longer (some
      30 s), still inside the request, and keep `401` after that final
      (`docs/cloudflare-facts.md`, Tokens).
- [ ] **Dropdown menus in drawers and tables can be cut off** (the owner, 06.11). The menu of
      `dropdown()` (`ui/pick.ts`) always opens down and as wide as its trigger
      (`dropdown__menu--fit-trigger`). Near the bottom of a drawer or a table, or inside an
      element with `overflow`, part of it hides. In a narrow trigger its items wrap: the rule
      row's "Who" in the new-link drawer, 06.11. 301-ui solved this long ago: the menu opens up
      when there is no room below, keeps to the viewport, and may be wider than its trigger. Take
      that behaviour over and check it in the new-link drawer, the account and site tables and at
      390 px.
- [x] **An update can be failed by a second run the moment it reaches the self-check** (rollout
      06.11, one of 48: entered `selfcheck` at 09:36:07 with its deadline at 09:51:07, failed
      `self_check_timeout` at 09:36:11). `runDeploy` (`src/cf/deploy.ts`) checks "still within the
      deadline" against the operation it read before taking the lease. After the lease it reads
      the step again but not the deadline, so a run that waited for the lease while another
      advanced the operation fails it at once. The same stale read could mark failed an update
      a `setup_ok` had just ended (its step `done` → "Unknown step" → undo: the version stays, the
      operation and the account's error do not). Fixed 06.11: after the lease the fresh read is
      checked again — not `running` → nothing; in its self-check before the fresh deadline →
      nothing (two tests with a stale first read; both fail without it). Codex found two more of
      the kind, older than this fix — the next two items.
- [x] **A run whose lease ran out can still write or undo the operation** (Codex, 06.11). The
      lease lasts 120 s (`src/cf/deploy.ts`). If a Cloudflare call outlasts it, another run takes
      the lease and finishes. The first run's error then is not `operation_in_progress`, so it
      writes its stale `data` over the operation, or calls `undo`, which may deploy the previous
      version or delete the worker and marks the operation failed. Fixed 06.11: every change the
      run makes in Cloudflare goes through `change()`, which renews the lease first (`held`) and
      stops the run once it is lost, and every such call is cut at 50 s, well within the 120 s, so
      one started under the lease ends before another run can take it; the catch renews it before
      a retry is written or an undo starts; `undo` checks it again after its slow read; the
      operation's writes in `undo`, `unconfirmed()` and the missing-token end need
      `state = 'running'` and the owner's write of the account in the same batch. Tests steal the
      lease during the read before the upload, during the upload (503, 400) and during the undo's
      read, and check no change reaches Cloudflare after it. A change cut off (timeout, network)
      has an unknown outcome — Cloudflare may still apply it — so the run then keeps the lease to
      run out instead of releasing it, also when the cut-off call is inside the undo.
- [ ] **Known risk: a cut-off install upload applied very late** (Codex, 06.11). If Cloudflare
      applies an upload clx gave up on more than ~70 s later, after the next run has uploaded its
      own, the worker holds a key and deployment id clx does not know: `setup_ok` fails, the
      install ends `unconfirmed` and its pushes get 401 until the heartbeat (26 h) marks it
      `no_connection` and a reinstall fixes it. The digest check sees only `worker.js`, not the
      bindings, and secrets cannot be read back. Not fixed: unlikely, visible, recoverable. If it
      is ever seen, compare the script's settings (bindings without secrets: `DEPLOYMENT_ID`)
      before the install is called ready.
- [x] **`confirmSetup` checks the operation before the lease and not again after it** (Codex,
      06.11). Between its read and the lease, a timeout, `unconfirmed()` or a new operation can
      change the row. The old `setup_ok` then still sets the working cron alone — for a new
      upload that drops its self-check cron — and returns `ok` though its conditional update
      changed nothing. Fixed 06.11: the same checks (`reportFits`) run again on the account and
      the operation read under the lease, before the Cloudflare call, and `ok` needs the write
      to have happened (a test with a late report of a timed-out update).
- [ ] **A rollout's uploads retried 4–5 times each** (06.11): 47 updates started within three
      seconds, reached the self-check over 18 minutes, `attempts` 4–5, and `cf_calls` holds a single
      `503`. So the passing failures were clx.cx's own: likely the per-minute cron's batch of 20
      operations run one after another in one invocation, against its subrequest or time limit.
      Find the error (the operation's step and what threw) and either start fewer at once in
      `/admin/edge/rollout` or let the cron take fewer a run. Half done 08.11, by the hypothesis
      (no logs read): the rollout request runs nothing itself (its `waitUntil` is cut 30 s after the
      response), the cron takes 10 a run instead of 20 (D1 allows 1000 queries per invocation, a run
      makes ~32), and each passing failure is kept in the operation's `last_error`, which
      `scripts/rollout.mjs` prints. In `cf_calls` every change was sent once, so the failures
      threw on reads, D1 or clx.cx's code — a run cut by `waitUntil` reaches no `catch` and counts
      no attempt. **Closed by the next real rollout:** few or no failed runs, or a `last_error`
      that names the cause. The new path itself (the request starts, the cron runs) passed live
      on 08.11: `probe-install`'s rollout of one account came back `ready`, its cron restored.
- [ ] **The link editor as a screen, not a drawer** (the owner, 06.11), after 301-ui's "Editor
      Screen" (its StyleGuide; the TDS rule editor, a drawer until 23.10). Its rule: a record with a
      home — a list it belongs to, an address worth linking, a form long enough to scroll — gets a
      screen inside its list page; a quick add or a step without a home stays a drawer. In clx only
      the link editor is such a record: up to 10 rules, each a row of countries, device, who, URL,
      move and remove, squeezed into a 540 px drawer (`#/links/new` was a page until 10.10). The
      screen: `#/links/new` and `#/links/<id>/edit`, Back returns, unsaved edits confirm; one rule
      on one line where there is room; from 860 px of content (`@container`) a sticky summary
      beside the form — what the link does in order ("search engines → /search, DE → /de, else
      → /landing") and what will never happen (a rule without bots above a rule for bots that it
      already takes, the same conditions twice); below 860 the summary sits above Save. The other
      drawers stay: adding a site or a link host, the excluded paths, keys, top-ups and refunds,
      partner payouts — short, with no home of their own.
- [x] **Remove buttons in drawers as a trash icon** (the owner, 06.11), as in 301-ui: an icon
      button with an `aria-label` instead of the word. Rows with several controls then have more
      room — the rule row in the new-link drawer is the first ("Remove" next to "↑"). Done 08.11:
      `iconButton()` in `ui/dom.ts`, the rule row's remove and move-up are 301-ui's `delete` and
      `chevron-up` (in `public/icons.svg`). The other removes — a host, a link, a site, the account —
      are actions of a page behind a confirmation, not a row's control, and keep their word.
- [x] **Rotation is not durable** (Codex, 10.10): `rotate()` in `src/cf/sites.ts` created the new
      Cloudflare route before it recorded the seed. Now the seed is recorded first (`sites.rotating`,
      migration 0014); a retry finishes the rotation and adopts the route, the cron undoes one left
      alone, a delete or disconnect finds an unrecorded route (a rotation's or a new site's) by its
      pattern (19.10).
- [x] **A link host's config read that fails falls through** (Codex, 10.10): an unreadable
      `linkhost:` entry sent the request to `fetch(request)`, and a link host has no origin. Now a
      GET or HEAD of a one-segment path that could be a link answers `503 Retry-After` (§8); a site's
      route has two segments at least, so its requests still pass through (19.10, clx-edge 115260b9b611).
- [x] **Views over the detail caps show as direct** (found 11.10 with ADR 0019): the `(other)` row
      keeps only `page = '(other)'`, so its views were "Direct" in `sources` and "Unknown" elsewhere.
      `src/report.ts` now reads that row as `(other)` in every dimension (19.10).
- [x] Stage 7: the QR library published as `@spintax/qr-svg` 0.1.0 (22.10, no npm organisation
      needed — the `spintax` account); `src/qr` gave way to the dependency (ADR 0033).

- [x] Open questions of spec §13, on a test Cloudflare account: rights for Workers Custom Domains —
      verified 11.10 (`scripts/probe-link-hosts.mjs`, `cloudflare-facts.md`, ADR 0024). (A route on a
      Pages host — verified 05.10, §13 item 9; an ignored `INSERT OR IGNORE` writes 0 rows —
      verified 05.10, `cloudflare-facts.md`.)
- [x] `MASTER_KEYS` rotation tool — `scripts/rekey.mjs` (ADR 0038): a second secret, the cron
      re-seals, then the new key becomes `MASTER_KEYS` (01.11).
- [x] Sign-out: the page showed the sign-in form even when `/auth/logout` failed, so the refresh
      cookie stayed valid behind it — now it stays on the page and says the session is not ended (07.10).
- [x] A deleted user's sessions opened a new user who got the same id (SQLite reuses the highest
      freed rowid; both started at session version 0; Codex 07.10). New users now start at the
      sign-up time as their session version.
- [x] A counter for a site not on Cloudflare — not a proxy: an external site counted by the user's
      own clx-edge on a host of their zone, Pro only (ADR 0037; built 30.10, spec §14 stage 8). Checked
      live 31.10, two runs (`scripts/probe-external.mjs`, `cloudflare-facts.md`).
- [x] A page restored from the back-forward cache (Back after a click) is counted — `pageshow` with
      `persisted`, zone and external sites alike; every snippet's bytes changed once, the served scripts
      re-sent by SNIPPET_REV (owner's call 01.11, ADR 0039).
Left as they are (owner, 19.10.2026) — not worth their cost now; reopened only if a real case needs one:
- `over` from "pushes reporting write failures" (§8): the heartbeat carries the worker's error
  text only, with no clean sign of a failed D1 write. `over` already comes from writes at the
  limit in the account's analytics; a new sign would be a new bundle, rolled out by ADR 0032.
- Account e-mails are not retried: a notice whose send fails (no `EMAIL`, Email Sending down)
  is lost — the state it reports is still on the account's page, and a sign-in or reset e-mail
  is asked for again by the person.
- The API's share of the per-account write budget (§8): idempotency rows and changes made
  through `/v1` are not counted — only the receiver's writes are (stage 4c). Counted in the same
  budget they would take quota from the worker's reports; API writes are bounded by the key's
  rate limit (120 a minute). If they need a bound of their own: a daily cap of changes per user.
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
- [x] Checked on a stand (22–23.10, `scripts/probe-cron.mjs`, `docs/cloudflare-facts.md`): new
      scripts, the same name re-created 1 and 10 min after a delete, and clx's two-crons-then-one
      pattern all fired first within 4–10 min and then without a missed minute; the silences below
      did not come back. Their cause is unknown; the heartbeat (26 h) stays. Original note:
      A new script's crons may not fire at all for an hour or more when `clx-edge` is re-created
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
- [x] Nightly backup of the clx.cx D1 to R2 — `src/backup.ts`, a slice a minute in key order, bucket `clx-backups`
      with 30 days' lifecycle (ADR 0040, 01.11; R2 was already on in the account).
