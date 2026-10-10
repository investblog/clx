---
title: clx — spec of the open visit counter and short links
updated: 2026-10-06
---

# clx v2 spec: an open visit counter and short links on users' own workers

clx v1 was a private visit counter for one network of sites. v2 is an open product: anyone with a
site on Cloudflare can sign up. The spec was reviewed in three rounds (Codex, 04–05.10.2026); the
management API (§15), the low-footprint snippet (§5) and the upgrade advice (§8) were added on
05.10.2026 and reviewed in three more rounds; the fixes from the last one have not been re-reviewed.
What Cloudflare was found to do on a live account — and what this spec relies on — is collected in
[`cloudflare-facts.md`](./cloudflare-facts.md).

## 1. Product and scope

clx is a free, open service for site owners on Cloudflare:
- a **visit counter** with no cookies and no third-party address in the page;
- **short links** on the user's own domain, with a QR code for every link and rules by country and
  device;
- **reports** on clx.cx: views, visitors, clicks, pages, sources, countries, devices, browsers, OS,
  bots.

In scope: signing up on clx.cx, connecting one's own Cloudflare account, deploying a worker into that
account, summary totals on clx.cx, details read from the user's database on demand.

Out of scope:
- sites not on Cloudflare, and links without one's own domain (clx.cx carries no user traffic);
- events, goals, funnels, raw visit logs, per-visitor exports;
- billing — the `api` plan (§15) is switched on by an admin on request; prices and tiers come later ([ADR 0014](./decisions/0014-a-key-on-free.md)).

Integrators — for example a site generator — work through the **management API** (§15): connect a
customer's Cloudflare account, add a site, get a counter snippet that works on the site's own domain
and shares nothing visible with the integrator's other sites (§5), embed it at build time.

The code is AGPL-3.0 in a public repository; anyone can run their own clx.

## 2. Architecture

The platform's worker is installed into the user's Cloudflare account; the user's worker sends totals
back.

```
 visitor ──► example.com/<path>/<c> ┐                        ┌─ clx.cx (our account, Workers Paid)
 visitor ──► go.example.com/<code> ┤  user's Cloudflare      │  • sign-in, sign-up
                                   ▼  account (Free)         │  • connecting a Cloudflare account
                           worker clx-edge ── D1 clx-edge ◄──┼─ • report breakdowns: reading D1
                                   │  ▲                      │    through the D1 REST API on demand
                     totals hourly │  │ links and rules      │  • receiving totals, reports
                                   ▼  │                      │  D1 clx, KV
                           POST clx.cx/hook/push ◄───────────┘
```

Where data lives:

| Data | User's account (D1 `clx-edge`) | clx.cx (D1 `clx`) |
|---|---|---|
| Views with breakdowns (page, source, country, device, browser, OS) | hours — 31 days, days — 400 days (capped, §5) | none |
| Totals: views, bots, visitors | exact, computed here: one row per target and day (sites with hourly columns), kept until clx.cx has the final day | copy: site hours — 2 days ("today" chart), days of sites and links — 400 days |
| Visitor hashes, the day's salt | until the day is closed | never |
| Sites, links and rules | working copy (versions + commit log, §6) | source of truth |

Why:
- traffic and writes run on the user's quotas; clx.cx pays about 110 D1 writes a day per site and
  3 per link with traffic (§8);
- a report with breakdowns reads the user's database only when it is opened — reads also run on
  the user's quota, nothing piles up on our side;
- a custom domain is an ordinary worker route on the user's zone, no Cloudflare for SaaS;
- a link lives on its owner's domain, so clx.cx does not become a phishing host.

## 3. Connecting a Cloudflare account

1. The user creates a **bootstrap token** from a template link: Account Settings Read + Account API
   Tokens Edit, valid for one day, and pastes the account ID and the token.
2. clx.cx checks it with `GET /accounts/{id}/tokens/verify`, creates a `pending` record (so two
   connections cannot run at once), and gets permission group IDs by name from
   `GET /accounts/{id}/tokens/permission_groups` (this is the catalog of groups, not the rights of
   the token sent — the rights are checked by probe calls in step 4).
3. The bootstrap token creates the **working token**: one account, all its zones, valid for 1 year.
4. The working token is checked: the `policies` in the creation answer are compared with the
   required permission groups and resources (account, zones); read rights — by probe GETs from the
   table below; write rights are proven by the install itself (§4), and a 403 there is shown to the
   user. Then the bootstrap token is deleted, retrying until confirmed; if that fails, the user gets
   a mandatory "revoke the token by hand" instruction. The bootstrap token is never stored or
   logged; if its `expires_on` is later than one day — a warning.

| Operation | Endpoint | Right |
|---|---|---|
| verify the token | `GET /accounts/{id}/tokens/verify` | (any account token) |
| account name | `GET /accounts/{id}` | Account Settings Read |
| D1: create, delete, schema, totals, breakdowns | `/accounts/{id}/d1/database[/{db}/query]` | D1 Read, D1 Write |
| worker: upload, read, delete, secrets, cron | `/accounts/{id}/workers/scripts/{name}[/secrets\|/schedules]` | Workers Scripts Read, Write |
| the user's zones | `GET /zones?account.id=` | Zone Read |
| routes: list, create, delete | `/zones/{zone}/workers/routes` | Workers Routes Read, Write |
| account usage for upgrade advice (§8) | `POST /client/v4/graphql` | Account Analytics Read |
| link host without a DNS record | Workers Custom Domains or DNS | see §13 item 2 |

   Not taken: KV, Pages, Transform/Redirect Rules, SSL, WAF, Firewall, Cache, zone Analytics, API Tokens
   Edit. Whether a Pages check is needed — open question §13 item 9.
5. Storage: AES-GCM-256, random IV, AAD = record ID + Cloudflare account ID (a ciphertext cannot be
   moved to another account). The key comes from the `MASTER_KEYS` keyring (`key_id → secret`):
   encrypt with the current key, decrypt by the record's `key_id`; rotation — add a new key, re-encrypt
   in the background, then remove the old key. The ciphertext sits in the account's own row of D1
   `clx`, next to its metadata (token ID, expiry, account ID, `key_id`): a renewal swaps secret and
   metadata in one statement, and D1 reads are consistent where KV's are not (stage 2 review).
6. Token state:
   - `401` or `verify` ≠ active → `revoked`, calls stop, the user gets an e-mail;
   - `403` → `permission_error` with the endpoint and Cloudflare's error code; the token is left
     alone — this may be a missing right or plan on one resource;
   - an hourly cron runs `verify` on the tokens checked longest ago (200 a run, so each about daily for up to ~4,800 accounts); 30 days before expiry — a "renew the connection"
     e-mail (a new bootstrap).
7. Limit: one Cloudflare account per clx user on the `free` plan, up to 50 on the `api` plan (§15);
   one Cloudflare account belongs to one clx user. Through the API the bootstrap token arrives in
   the request body (`POST /v1/accounts`) and is handled exactly as above, **within that request**:
   the answer comes only after the working token is stored and the bootstrap deletion attempted, so
   the bootstrap token never has to outlive the request; only the install (§4) continues in the
   background, with the working token.
8. **Who owns a connection made through the API.** The clx user that connected the account — for
   an integrator, the integrator, acting for its customer. The customer's control is the working
   token and the resources in their own Cloudflare account. Revoking the token stops clx.cx from
   changing or reading anything there (§3 item 6), but the installed worker keeps counting,
   redirecting and pushing until it is removed: deleting the `clx-edge` worker (or its routes) stops
   everything at once, and the recorded resources (§4) carry fixed names so the customer can find
   them. Moving an account to
   another clx user = disconnect, then connect again. A customer-facing audit view is not in v2.

## 4. Deploy and updates

- **One bundle** `clx-edge` — the same code for everyone; the deployment's own settings are in
  bindings (`HOOK_URL`, `BUNDLE`, `DEPLOYMENT_ID`) and the secret `EDGE_KEY`, the sites and links in
  the synced config (§6). The bundle is built from `edge/worker.ts` into the committed
  `edge/bundle.gen.ts` (code, sha256, `compatibility_date`); a test rebuilds it and compares, and
  `edge/released.json` lists the sha256 of every bundle ever committed — the code clx may call its
  own. Before a rollout it is checked with `GET /admin/edge/bundle-info` (a broken bundle must never
  reach all accounts at once).
- **Resource ownership.** clx.cx records what it creates: the database UUID, route IDs, and a mark
  that the `clx-edge` script is ours — set just before the upload, cleared only when clx has deleted
  it. If `clx-edge` (worker or database) already exists and is not in our records, the install stops
  with `name_taken` and touches nothing. Rollback and disconnect delete only what is recorded.
  Before replacing or deleting the script, clx.cx reads its code (`GET …/workers/scripts/clx-edge`,
  the `worker.js` part of the multipart answer — byte for byte what was uploaded, checked
  05.10.2026): if its sha256 is not in `edge/released.json` — `resource_drift`, and the script is
  left alone. The check is repeated right before every upload and every rollback, but it and the
  upload are two calls — Cloudflare has no conditional create — so a `clx-edge` made by someone
  else in the moment between them would still be overwritten; the window is one API call, not a
  step. A failed return to the previous version leaves the account `connected` with no bundle
  claimed (`serving_unknown`), so a reinstall sets it right.
- **Schema migrations** — one ordered list `edge/migrations.ts`. D1 refuses `PRAGMA user_version`
  (`SQLITE_AUTH`, checked 05.10.2026), so the number of the last migration applied is kept in the
  table `meta` under the key `schema`. clx.cx applies them through the D1 REST API **before**
  uploading new code, each in one call with its number; every migration is re-runnable
  (`IF NOT EXISTS`) and compatible with the previous code version (additive only: new tables and
  columns with defaults). The worker reports its `schema` in `setup_ok` and the heartbeat.
- **Operations.** An install or an update is an operation of recorded steps (§15). The request that
  starts it answers `202` and runs the first steps after the answer; the clx.cx cron runs **every
  minute** (the hourly jobs at `:20`) and resumes an operation that stalled from its last recorded
  step, and ends a self-check that is overdue. A passing failure (Cloudflare `5xx`, `429`, network)
  is retried by the cron, at most 10 runs; any other failure undoes the operation at once.
- **Install** (every step is checked):
  1. what is there: the account's scripts and their cron triggers (only scripts with a `scheduled`
     handler can hold one; 5 in use → `cron_limit`; 4 in use → only the self-check cron at step 4),
     and `clx-edge` by name → `name_taken`;
  2. D1 `clx-edge` (or the recorded one, if it is still there) + migrations; the step is recorded
     before the create call, so a resumed step adopts a database it finds by name;
  3. the worker key: 32 random bytes, we keep only its SHA-256; on reinstall the previous hash is
     accepted for one more day;
  4. upload the script (`PUT …/workers/scripts/clx-edge`, `compatibility_date` fixed in the bundle)
     with the key as a `secret_text` binding in the same upload — one call, no separate secrets
     step — then the cron triggers: the **every-minute** self-check and the working `5 * * * *`
     together. Changing a new script's crons takes effect up to ~1.5 hours late (measured
     06.10.2026), so the working cron is not left for after the self-check —
     [ADR 0007](./decisions/0007-both-crons-at-upload.md);
  5. self-check: within the next minute the worker sends `setup_ok {deployment_id, bundle, schema}`
     to `HOOK_URL/setup` with `Bearer EDGE_KEY`; `deployment_id` is single-use and passed as a
     binding of this deployment, so an old or delayed `setup_ok` cannot count for another
     deployment. When all three fields match, clx.cx drops the self-check and keeps the working
     cron `5 * * * *` alone. One
     cron run must be enough: while clx.cx answers `503` (the run has not recorded its step yet,
     or holds the lease) or fails, the worker asks again every 5 s for up to 50 s; `401` or `409`
     ends the run.
  **An install is in service from step 4** — `ready` as soon as the script, its database and the
  cron are in place: serving the script and the collector needs no cron. The `setup_ok` of step 5
  only confirms it. The cron of a *new* script is unreliable at first (measured 05.10.2026 on five
  installs: first run after ~4.5, ~5.5 and ~6.5 minutes; once at once and then not for 14 minutes;
  once not at all within 15 minutes), so an install with no `setup_ok` within 15 minutes is **not**
  undone: clx.cx drops the self-check cron anyway and marks the account `not_confirmed`; whether the
  cron runs is then shown by the heartbeat of the pushes (§7, "no connection" after 26 hours) —
  [ADR 0003](./decisions/0003-install-without-cron.md).
  A failure in steps 1–4 deletes what this run created. A reinstall (`POST /v1/accounts/{id}/install`) over our
  own script is the same install: it keeps the database, and on failure returns to the script's
  previous version as an update does.
- **Update** — still undone without its `setup_ok` (the cron of an existing script fired after
  40–49 s each time measured): drift check → migrations → upload the new script with a new `deployment_id`, keeping
  the key (`keep_bindings: ["secret_text"]`) → the self-check and working crons (as step 4) →
  self-check (as step 5) → the working cron alone. Before the upload clx.cx records the version serving now (`GET …/deployments`); if
  the cron or the self-check fail, that version is deployed again at 100%
  (`POST …/workers/scripts/clx-edge/deployments`) and the `5 * * * *` cron restored — no old bundle
  has to be kept. Checked on a Free account 05.10.2026 with the working token's rights: versions,
  deployments and the rollback work; after a rollback the script's code endpoint still shows the
  latest *uploaded* version, which is a clx bundle too, so the drift check holds. Rollout — by an
  admin command (`POST /admin/edge/rollout`, an admin's page session), to every installed account or
  a list, with `dry_run`; the operations table holds each account's result. Compatibility: the
  receiver accepts body version `v` of the current and the previous release.
- **Liveness:** a heartbeat in every push (§7): bundle sha256, `schema`, last error, queue
  depth, the latest config commit, the counters of dropped items. Every hourly run pushes at least
  once — with nothing to send, an empty push — so silence means the worker is not running. 26
  hours of silence — "no connection" in the UI and one e-mail to the user when it begins. A push
  ends it; an account with no connection still takes new sites, but a rollout skips it (its update
  would wait for a `setup_ok` that will not come).
- **Disconnecting clx** by the user: the working token removes the recorded routes, deletes the
  recorded worker (if its code is a clx bundle) and database; we delete the ciphertext. What could
  not be deleted — the token is revoked or lacks a right, the worker was changed — is listed in the
  answer for the user to remove by hand. The working token cannot delete itself (it has no API
  Tokens Edit right and never will) — the user revokes it in Cloudflare from a link, or pastes a new
  bootstrap token and clx deletes the working one with it. Totals on clx.cx are deleted after 30
  days (or at once, by a button).
- **Worker cron:** one, `5 * * * *` (Free allows 5 crons per account); while an install or update
  is checked, the every-minute self-check runs next to it. The `workers.dev` address
  of a script uploaded through the API is off by default (checked 05.10.2026); the worker answers
  `404` there anyway, so a pass-through never loops.

## 5. Counter

- **Route** `example.com/<path>/*` → `clx-edge`. clx issues `<path>` when a site is added, different
  for every site. The worker does not touch the rest of the site. If the pattern already has someone
  else's route — refuse (`route_conflict`), never overwrite. Sites served by Cloudflare Pages on the
  same host are the main case for integrators — see §13 item 9.
- **Site config in the worker.** The bundle is the same for everyone, so each site's settings reach
  the worker the way links do — in the versioned config synced from clx.cx (§6): host, target `s<id>`, the
  current `<path>`, `<c>` and `<s>`, the generated script, excluded paths, and the retiring paths of
  past rotations with their expiry. A request whose host and path are not in the active config
  is passed through to the origin.
- **Rotation** (`rotate`, §15): a new seed gives a new `<path>` and names; clx.cx creates the new
  route, records its ID, syncs a config with both paths, and after 30 days (cached pages) syncs
  one without the old path and deletes the old route by its recorded ID. Deleting a site deletes
  every recorded route of it.
- **Low footprint.** The goal is that the counter adds **no static signature** shared by sites —
  nothing in the page source, the URLs or the answers that a footprint scan, a crawler or an ad
  blocker list could match across sites or to clx:
  - per site, from a random seed kept on clx.cx: `<path>` (one or two segments of 4–12 characters
    that read like an ordinary site path, never `clx`, `stat`, `track`, `count`, `beacon`,
    `analytics`), the collector name `<c>` and the script name `<s>.js` — all different per site;
  - the snippet code is **generated per site** from the seed: its own identifier names, its own
    order of statements and one of two equivalent forms (`navigator.sendBeacon`, `fetch` with
    `keepalive`), no comments, no literal shared by all snippets except the browser's own API names;
  - the snippet is stable for a seed — rebuilding a site gives the same bytes — and changes only on
    `rotate`;
  - the answers add no clx header and no clx text: the collector answers `204` with
    `cache-control: no-store`; the script is served as `text/javascript` with the cache headers of an
    ordinary static file; **every other request under `<path>/`** — another method, a probe, a typo —
    is passed through to the origin, so it gets the site's own answer (its own 404);
  - the beacon goes to the site's own host — no third-party host in the page;
  - what remains, stated plainly: an active observer can still see the *behaviour* — a same-origin
    POST of the referrer on every page view answered with an empty `204` — and Cloudflare's own
    headers and timing are the same as on any Cloudflare site. Hiding from Cloudflare or from whoever
    has access to the account is out of scope.
- **Snippet** — an inline script under 600 bytes that sends `document.referrer` to `/<path>/<c>` on
  load and on SPA address changes (`pushState`/`popstate`). Alternative — `<script defer
  src="/<path>/<s>.js">` (the same code, served by the worker, cached for a day). Both forms come from
  the API (§15) for embedding at build time.
- **Collector** `POST /<path>/<c>`. The counter is **not fraud-resistant**: the path is visible in
  the HTML, and `Origin`, `Referer`, UA and body can be forged by any client. The checks below drop
  browser noise and cap quota use, but do not prove authenticity.
  - body — `text/plain`, up to 2 KB (the stream is cancelled once 2 KB are in; nothing beyond is
    kept or parsed), UA — up to 512 characters;
  - site — by `Host` and `<path>` from the active config (+ matched against `Origin` when
    present);
  - page — the path from a same-host `Referer`, up to 200 characters, **without query and
    fragment**; segments that look like an e-mail, a UUID or a long number/hex (≥ 16 characters) are
    replaced with `:id`; plus the site's list of excluded path prefixes;
  - source — the host from the body (the first absolute URL), own host → empty;
  - country — `request.cf.country`; IP — `cf-connecting-ip`; browser and OS — from the UA; device —
    by UA (`Mobile|Android|iPhone`);
  - **exact totals and capped detail are separate.** Every counted event adds 1 to the target's
    totals row — `totals(target, day, views, bots, …)`, one row per target and day; for sites it
    also has 24 hourly columns — so totals are always exact, whatever the caps below drop. A totals
    row is the source of the target's hour and day items for clx.cx (§7); when the day closes,
    its totals and visitor count are copied into `final_days`, which holds the final day item until
    clx.cx accepts it (a new table, not new columns: `ALTER TABLE ADD COLUMN` cannot be re-run —
    [ADR 0002](./decisions/0002-final-days-table.md)). A
    totals row is deleted once its day is closed, its final item gone and the day 2 days old (or
    after 31 days, when clx.cx would refuse it anyway); clx.cx keeps the 400-day history;
  - **detail caps** — what bounds the breakdown tables (sizes in §8): per hour, at most 299
    `views_hourly` combination rows per target and 1,500 per Cloudflare account (all targets
    together, every `(other)` row included). A view whose combination row does not exist and cannot
    be created goes to:
    - the target's own `(other)` row when the target has reached 299 and the account is under
      1,500 (that row is the target's 300th and counts towards the account);
    - the single account-wide `(other)` row (target `*`) when the account has reached 1,500.
    So the account holds at most 1,500 + 1 rows an hour. A target's report shows the views it lost to
    the account-wide row as "not broken down" (= its exact total − its retained detail);
  - **how D1 enforces the caps** (not isolate memory): `rows_hourly(scope, hour, n)` counters for
    each target and for the account are kept by an `AFTER INSERT` trigger on `views_hourly`, so a
    counter moves only when a row was really inserted — a conflict or a retry adds nothing. The view
    is one `batch` of four statements, each with its own predicate, none relying on `changes()`:
    (1) `UPDATE` the combination row if it exists; (2) `INSERT` it `WHERE NOT EXISTS` (the row) `AND`
    the target counter < 299 `AND` the account counter < 1,500, `ON CONFLICT DO NOTHING`; (3) upsert
    the target's `(other)` `WHERE NOT EXISTS` (the combination row) `AND` the target counter ≥ 299
    `AND` the account counter < 1,500 (or the target's `(other)` row already exists); (4) upsert the
    account-wide `(other)` `WHERE NOT EXISTS` (the combination row) `AND NOT EXISTS` (the target's
    `(other)` row) `AND` the account counter ≥ 1,500. Exactly one of them writes;
  - the daily rollup keeps the same shape: at most 299 rows per target and 1,500 per account per
    day (all `(other)` rows included), the busiest combinations first;
  - **storage backpressure** (§8): at 400 MB the collector stops creating combination rows (views
    go to `(other)`; totals stay exact);
  - IP, UA and body are written neither to the database nor to the log (`console.*`);
  - the answer to a `POST` is always `204 no-store`, whether the beacon was counted or dropped.
- **Bots** — the classifier `src/bots.ts` (UA signatures, `headless`). `request.cf.botManagement`
  is empty without paid Bot Management (docs `workers/runtime-apis/request`, 04.10.2026) — not
  used. Bots are counted separately.
- **Visitors** — `sha256(day salt | target | IP | UA)` (target — a site or a link, so hashes of
  different links cannot be matched), PK `(target, day, vhash)`; the salt is random and kept in the
  user's D1; hashes and salt are deleted when the day is closed. The metric over a period is the
  **sum of daily uniques** (and labelled so in the UI): one person on two different days counts as
  two.
- **Storage on the user's side** — every table carries a `target` dimension (`s<id>` for a site,
  `l<id>` for a link): `totals` (exact, one row per target and day), `views_hourly`/`views_daily`
  (target, hour or day, page, source, country, device, browser, OS → views; capped), `visitors_daily`
  (hashes of the open day) / `visitors` (daily counts), `bots_hourly`/`bots_daily` (category →
  hits), `salts`, `closed_days`, `final_days` (closed days' totals with visitors, until clx.cx
  accepts them); plus `cfg`/`commits` (§6), `outbox` and `sync_status` (§7).
- **Worker cron** (hourly). On Free one invocation may make at most 50 D1 queries, and every
  statement of a `batch` counts. Each run works to a fixed **query ledger** and leaves the rest for
  the next hour:

  | Step | Queries at most |
  |---|---|
  | read `meta` (cursors, counters) and the latest config commit (§6) | 1 |
  | find the days to close | 1 |
  | close past days, at most 3 — set-based `INSERT … SELECT … GROUP BY` with window functions for the caps, one `batch` per day: hours → days with the caps above, the day's totals with its visitor count into `final_days` (pending for clx.cx), deleting hashes, salt and the day's `rows_hourly` counters, a mark in `closed_days` (a failure leaves the day open as a whole) | 3 × 7 = 21 |
  | queue the closed hours after the `outboxed_through` cursor and the running day snapshot; the cursor moves in the same `batch` | 3 |
  | delete expired data, one table per run in turn | 3 |
  | send: at most 6 pushes (§7) — `outbox` parts first, then pages of `final_days`; each a read, then one `batch` of the delete or rewrite, the attempt counts and the `sync_status` drop counters — as many as fit in what the steps above left | ≤ 6 × 4 = 24 |
  | record or clear the last error | 1 |
  | **total** | **≤ 49** — the run counts its queries and stops sending first |

  An ordinary run queues two parts (the hour's items and the running snapshot) and sends them.
  Catching up after 3 days down: one part per account-hour (72), plus pages of final days; the
  first run closes the 3 days and has room for 4 pushes, every later run sends 6 while 2 new parts
  arrive, so the backlog drains by 4 a run — about 18 runs, within a day. The ledger is a test: a
  fake D1 counts statements per run.
- **Cron triggers.** Free allows 5 per account. Before the install (§4) clx.cx counts the cron
  triggers of the account's scripts; with 5 in use the install stops with `cron_limit` and says
  which scripts hold them. clx needs one, and a second one while an install or update is checked;
  with only one free the self-check goes alone and the working cron follows its confirmation.

## 6. Short links, QR, rules

- **Link host** — the user's choice: a subdomain (`go.example.com`) or a separate domain in their
  account; **one per Cloudflare account** (`PUT /v1/accounts/{id}/link-host`). Route
  `go.example.com/*` → `clx-edge`. How the subdomain gets its DNS record — §13 item 2. Another host
  replaces it: the old route is deleted and the links move to the new host with their codes; a host
  a link points at cannot become the link host, nor can a site's host (a site's host passes
  everything outside the counter through, a link host nothing), and a link host cannot become a
  site. The same host again after a `route_conflict` tries the route once more. The whole host is the worker's and has no origin:
  nothing on it passes through — a path that is not a code, an unknown code or a method other than
  `GET`/`HEAD` gets a plain `404` with no clx text.
- **Link:** a code (3–32 characters `[A-Za-z0-9_-]`, chosen or a random 6) → target; `302`,
  `cache-control: no-store` (every click must reach the worker), no other headers and no body. A
  click (`GET`; a `HEAD` is redirected, not counted) is written as a view of target `l<id>` (page
  empty, source — the `Referer` host, or `qr`), with its daily visitor hash like a site's; a bot is
  redirected too and counted as a bot. The code never changes (printed QR codes carry it): a new
  code is a new link; a deleted link frees its code and keeps its totals. A code is unique within
  the account — one link host per account, so the worker looks a link up by its code alone. Config
  keys: `linkhost:<host>` and `link:<code>` ([ADR 0008](./decisions/0008-link-host-and-codes.md)).
- **QR** — SVG via `@301st/qr-svg` (§11), built on clx.cx (download as SVG; `GET
  /v1/links/{id}/qr.svg`, error correction M, an optional `size` in pixels). The address in the QR
  is `go.example.com/<code>?q`; the worker records `?q` as source `qr` and does not pass it on.
  Built on clx.cx, not in the browser, so that API clients get it too.
- **Rules:** `{countries?, devices?, url}` — countries as ISO alpha-2 codes (`cf.country`), devices
  `mobile`/`desktop` (as the collector tells them), at least one of the two; the first match wins,
  otherwise the main target. Up to 10 rules per link.
- **Targets:** `https://` only, not on the link host (no loops), up to 2048 characters.
- **Sync clx.cx → worker** — everything the worker serves for the account: its sites (config of §5)
  and its links with rules. A delete-then-insert sync can leave sites or links without settings for
  as long as the second half fails, and rewriting everything on every change would cost an account
  with 10,000 links ~20,000 D1 writes per edit. So config is **immutable versions plus a commit
  log**, and a change costs writes only for what changed:
  - every sync has a `revision` (a growing per-account number that clx.cx issues in the same
    transaction as the change) and a random `sync_id`. It writes **new rows only** —
    `cfg(key, revision, sync_id, deleted, data)`, where `key` is a site host or a link code and a
    deletion is a row with `deleted = 1` — and never touches existing rows;
  - the sync becomes visible in one statement, which is atomic on its own:
    `INSERT INTO commits (revision, sync_id) SELECT R', U WHERE (SELECT max(revision) FROM commits)
    = R`. A late or repeated job — even a Cloudflare request that timed out on our side and executed
    later — either fails this condition or has a `sync_id` that no commit names, so its rows are
    **never visible**; rows of an abandoned sync stay invisible the same way;
  - the worker reads one key in one query: the row with the greatest `revision` among those whose
    `(revision, sync_id)` is in `commits`, then `deleted = 1` means "none" (index on
    `(key, revision)`). Nothing can change between two reads of the same request;
  - sync jobs of one account run one at a time and are coalesced, so 500 sites added in a minute
    become a few syncs, not 500; a large change goes in chunks of at most 100 rows per REST call
    before the commit;
  - cleanup after a commit: rows whose `sync_id` is in no commit and that are older than an hour,
    and versions superseded by a newer committed version. Commits are never deleted; a rollback is
    a new forward revision whose rows restore the earlier values;
  - every sync starts by reading the worker's latest commit: a new database (reinstall) starts
    from 0 and gets every site; a database whose head is *ahead* of clx.cx's revision (restored
    from elsewhere, changed by hand) is not trusted — clx.cx moves its revision above that head and
    writes every site again (found on clx.cx's next sync of that account, or, with no change
    pending, by the worker-side check below); a site that is deleted or in `route_conflict` is
    written as deleted;
  - a check from the worker side — every push's heartbeat carries the worker's latest commit
    (`revision`, §7). When no sync of the account is pending and none finished in the last 10
    minutes (the worker reads its head shortly before it pushes, and a sync may commit in between),
    a commit other than the one clx.cx synced means the database was changed elsewhere: clx.cx
    moves its revision above both and writes every site again, as for a head found ahead. (Planned
    first as a separate `GET /hook/sync` compared by the worker; the heartbeat carries the same
    number at no extra request, and clx.cx is the side that knows whether a sync is in flight —
    [ADR 0001](./decisions/0001-sync-check-in-heartbeat.md).) The worker never writes config itself;
  - config has a size budget per Cloudflare account — 50 MB of `data`, counted by clx.cx before it
    syncs; over it the change is refused (`storage_limit`, §15);
  - a link and site cache in isolate memory — 60 s, for speed only.
- **Abuse** is the domain owner's responsibility; on clx.cx: an `/abuse` page and disabling a clx
  account by an admin command (a sync that deletes every key).

## 7. Totals on clx.cx

- **What is sent** — totals only, no breakdowns, as items of two kinds:
  - hour and running day, **sites only**: `(target, hour) → views, bots` (final for a closed hour)
    and `(target, day, as_of_hour, final = false) → views, bots, visitors`, a snapshot as of the end
    of `as_of_hour`. They are queued in `outbox`, one row per **closed hour of the whole account** —
    not one row per target, so the queue does not grow with the number of sites and links; an hour
    with more than 2,000 items is queued as several parts;
  - **final day**, sites and links: `(target, day, final = true) → views, bots, visitors`. It is not
    copied into the queue: the day close writes it to `final_days` (§5), the worker sends it from
    there and deletes the row when clx.cx has accepted it. Links send only this — their "today"
    comes from the user's D1 with the breakdowns.
  Daily totals are computed by the worker (it has all the hours); clx.cx does not recompute days
  from hours.
- **Body** (`v: 1`, up to 2,000 items and 256 KB): `{ v, bundle, schema, queue, revision,
  error?, dropped?, items: [...] }` — one `outbox` part, or a page of pending final days (an
  empty `items` when nothing waits: the heartbeat); every item has its own `id` within the body;
  `revision` is the worker's latest config commit (§6), `dropped` its counters from `sync_status`.
  The shapes are in `edge/contract.ts`. The body carries no account.
- **The receiver `POST /hook/push` does not trust the body:**
  - `Bearer EDGE_KEY` → SHA-256 → the current or previous hash → the internal `account_id`;
  - a strict schema: known fields only, `target` belongs to the account, `hour`/`day` not in the
    future and not older than 31 days, numbers — integers ≥ 0 and ≤ 10⁹, the strings
    `bundle`/`schema`/`error` — up to 200 characters;
  - answer `200 {accepted: [id], rejected: [{id, reason}]}`; a bad item is rejected on its own, the
    rest are accepted.
- **Writing on clx.cx** — one D1 transaction (`batch`), inserts of 14 rows per statement (D1 takes
  at most 100 parameters per query, `d1/platform/limits`):
  - hour: `INSERT … ON CONFLICT DO UPDATE` with the same values — a repeat and a late delivery are
    safe;
  - day: update only if the new row's `(final, as_of_hour)` is greater than the stored one (`final`
    never goes back from `true` to `false`), so an old snapshot never overwrites a new one.
  A double push is harmless by protocol; no lock is needed.
- **The queue on the user's side:** after the answer the worker deletes the `outbox` part when
  nothing is left to retry, or rewrites it with only the retryable items and their attempt counts;
  for final days it deletes the accepted `final_days` rows. Rejection reasons are of two kinds,
  fixed in the contract: **terminal** (`budget`, `invalid`, `unknown_target`, `too_old`) — the item
  is dropped at once (a final day's row is deleted); **retryable** (`busy`) — kept, and dropped after
  3 attempts. Dropped items are only counted, per reason, in `sync_status` (same `batch`) and shown
  in the status UI; there is no rejected-items table.
- **Queue size**, bounded on both sides: `outbox` keeps hourly and running items for at most 7 days
  (older parts are deleted, with a mark in the heartbeat) — at the `api` maximum of 500 sites about
  7 × 24 parts of ~30 KB, ≈ 5 MB; pending final days are `final_days` rows, at most 31 days old
  (then clx.cx would refuse them; older ones are deleted and counted as `too_old`), counted in the
  `final_days` bound of §8. Under storage backpressure (§8) the worker queues no new hourly or running
  items; final days keep flowing from `final_days`.
- **Whole-request errors:**
  - `401` — after 20 in a row, one attempt a day (an endless retry loop on a revoked key would burn
    the user's quota); a successful secret install (§4) resets the counter through the D1 REST API;
  - `429`/`5xx`/timeout — retry next hour, the queue is left as is.
- **clx.cx schema** — new:
  - `edge_accounts(id, user_id, cf_account_id UNIQUE, …)`, `targets(id, account_id, kind, …)`;
  - `hourly(account_id, target_id, hour, views, bots)` PK `(account_id, target_id, hour)` — 2 days
    (only for the "today" chart);
  - `daily(account_id, target_id, day, as_of_hour, final, views, bots, visitors)` PK
    `(account_id, target_id, day)` — 400 days;
  - the clx.cx cron only deletes expired rows.
- **Report:** totals and charts — from clx.cx `hourly`/`daily`, except a link's **today** (links
  have no hourly totals on clx.cx), which is read from the user's D1 like the breakdowns, under
  the same limit and with the same unavailable state; breakdowns (top 10 pages, sources,
  countries, devices, browsers, OS, bots by category) — from the user's D1 through the D1 REST API
  when the report is opened:
  - periods `today`, `7d`, `30d` — UTC days ending with today; the series is hourly for `today`,
    daily otherwise;
  - everything is **as of** the end of the latest closed hour the worker sent today (`as_of`; the
    start of today when nothing came yet): the series stops there and the breakdowns read the
    user's D1 up to the same hour, so the open hour — counted there, not yet sent — never shows
    in one part of the report and not in another. A link's report has no hour waiting to be sent:
    its days not final on clx.cx (today, or any the worker has not sent yet) and its breakdowns are
    read live, open hour included, in one statement (so its totals and breakdowns are of one
    moment), and it is as of that read;
  - closed days come from the daily detail, days not closed yet (today, or days a stalled worker
    has not reached) from the hourly detail — never both;
  - one `/query` call — one statement, since D1 takes one statement with params
    ([`cloudflare-facts.md`](./cloudflare-facts.md)) — 5 s timeout;
  - identical requests in flight are merged; the answer is cached for 5 minutes (in isolate memory —
    for speed only); a cached answer and a merged request do not count against the limit;
  - at most 30 breakdown requests a minute per user (a rate limiting binding);
  - a Cloudflare `429`/`5xx`/timeout, a missing or unreadable token, an account out of service or
    the limit — the totals from clx.cx are shown (`200`), while breakdowns and a link's "today"
    are "temporarily unavailable", with the reason (`cloudflare`, `not_installed`,
    `rate_limited`); the account's state is not changed here — the token check owns it (§3);
  - "today" is marked incomplete when the account is over today's write budget (§8).
  See [ADR 0004](./decisions/0004-report-as-of.md).

## 8. Quotas and limits

Checked against Cloudflare's live documentation pages on 04.10.2026: `workers/platform/limits`,
`workers/platform/pricing`, `d1/platform/pricing`, `d1/platform/limits`,
`email-service/platform/pricing`.

**clx.cx, Workers Paid.** Included: 10M requests/month, D1 50M writes/month and 25B reads, Email
Sending 3,000 e-mails/month. Beyond that it is billed ($0.30 per 1M requests, $1 per 1M D1 writes,
$0.35 per 1,000 e-mails), so the budget is capped by D1 writes, not by items per body:
- a **site** with traffic, per day: 24 hour writes + up to 24 updates of the day row + 24 hour
  deletions after 2 days ≈ 72 writes; repeats after a lost answer are the same writes again —
  counted with a ×1.5 margin: **110**;
- a **link** with clicks, per day: the final day row + its deletion after 400 days ≈ 2, with the
  margin **3** (links have no hourly totals on clx.cx, §7);
- **write budget per account** (per connected Cloudflare account, per UTC day), counted by the
  receiver — every accepted item and the heartbeat — and by the API (idempotency rows and changes
  count too; the API's share is not counted yet, `docs/TODO.md`): `free` 3,000 a day (≈ 27 sites with traffic); `api` 3,000 + 110 per site +
  3 per link. Over budget only the final day items are accepted; hours and running snapshots are
  rejected for good (`reason: budget`, no retry) — daily totals stay exact, the "today" chart is
  marked "incomplete";
- **connected `free` accounts cap** — 500 at launch: 500 × 3,000 × 30 = 45M writes/month in the
  worst case; sign-up, sessions, the API call log, upgrade advice and expiry deletions fit in the
  remaining 5M; beyond that — a waiting list until the operator decides to raise it (every +100
  accounts is at worst ≈ +9M writes ≈ up to $9/month extra);
- **`api` accounts are on top of that**, switched on by an admin: one at full limits is at most
  (3,000 + 500 × 110 + 10,000 × 3) × 30 ≈ 2.6M writes/month (≈ $2.6 billed); the admin sees the
  projected D1 bill before switching one on;
- the Cloudflare API call log (§13 item 1) records only mutating calls; breakdown reads are not
  logged;
- requests: ≤ 24 pushes a day per connected Cloudflare account (more parts only for very large
  accounts) — negligible.

**The user's account, Workers Free.** 100,000 worker requests/day, 10 ms CPU per request, 5 crons
per account; D1 — 100,000 writes/day, 5M reads, 10 databases, 500 MB per database, 50 D1 queries
per invocation. All of it is per Cloudflare account and shared by every site and link clx serves
there, and by the user's other workers. D1 writes spent:

| Event | Writes |
|---|---|
| a view or click, the totals and hour rows exist | 2 (the `totals` row, `views_hourly`) |
| a visitor new for the day | +2: `visitors_daily` at once, the hash deletion when the day closes (a repeat visitor is an ignored `INSERT OR IGNORE` — 0 rows written, checked 05.10.2026) |
| a new hour row (a new combination) | +5: two `rows_hourly` counters, the day row at rollup, the hour deletion after 31 days, the day deletion after 400 days |
| a bot | 2 (the `totals` row, `bots_hourly`) + 2 for a new row (deletions) |
| overhead per **active target** per day | 4: its `totals` row created and deleted, its `final_days` row created at the close and deleted when clx.cx accepts it |
| overhead per account per day | `outbox` ≈ 50 (24 parts inserted and deleted); config sync ≈ 2 per changed site or link plus one commit (§6) |

D1 counts every index entry as a row written, so a new row of a keyed table costs 2; the counting
tables are `WITHOUT ROWID` (one entry per row), which is what the figures above assume
([`cloudflare-facts.md`](./cloudflare-facts.md)).

The steady-state worst case — every event comes from a new visitor and makes a new hour row:
2 + 2 + 5 = **9 writes**. The guaranteed ceiling per Cloudflare account is
(100,000 − 50 − 4 × active targets) / 9:
- a typical account (up to ~100 active sites and links) — ≈ **11,000 events a day**;
- the `api` maximum in one account (500 sites + 10,000 links, all active every day) —
  (100,000 − 42,050) / 9 ≈ **6,400 events a day**: the overhead of 10,500 targets is itself over
  40% of the Free quota, which the upgrade advice reports.
The UI shows the account's own figure as "guaranteed". A typical site (returning visitors,
repeating pages — 2–3 writes per event) gets 30–45 thousand; the upgrade advice (below) works from
measured use.

**Database size.** Every growing table of `clx-edge` has a bound, per Cloudflare account:

| Table | Bound | Estimate |
|---|---|---|
| hourly detail | 1,500 rows × 24 × 31 days ≈ 1.1M rows (§5 caps) | ≈ 135 MB |
| daily detail | 1,500 × 400 days ≈ 0.6M rows | ≈ 70 MB |
| `totals` | one row per active target and day, at most 31 days while clx.cx cannot be reached, usually 2: ≤ 0.33M rows at the `api` maximum | ≈ 25 MB |
| `final_days` | one row per active target and closed day until clx.cx accepts it — usually none, at most 31 days: ≤ 0.33M rows at the `api` maximum | ≈ 20 MB |
| config | the 50 MB `data` budget (§6) and its versions | ≤ 50 MB |
| `outbox` | hourly and running items of sites, at most 7 days (§7) | ≈ 5 MB |
| visitors, salts, bots, counters | one open day, small | ≈ 10 MB |
| **total** | | **≈ 315 MB** of the 500 MB Free limit |

The per-row size (120 bytes with indexes) is an estimate, measured at stage 4. **Backpressure:**
every D1 answer reports the database size (`meta.size_after`); at 400 MB the collector stops
creating combination rows (views go to `(other)`, totals stay exact), no new hourly or running
items are queued (§7), config syncs that grow it are refused with `storage_limit` (§15), and the
heartbeat reports the state — so the database does not reach the limit between two advice runs.

When a quota runs out:
- **worker requests (100k)** — Cloudflare stops invoking the worker: the counter route returns an
  error (the site's pages are not affected — the worker sits only on `<path>/*`), **links stop
  working**;
- **D1 writes** — writes fail; the collector answers `204` without writing, redirects keep working
  (reads remain);
- **D1 reads (5M)** — a redirect cannot read the link → `503 Retry-After`; the isolate cache is no
  guarantee.
To grow, the user moves to Workers Paid; clx changes nothing. Workers Paid is **never required**,
on any clx plan — clx tells the user when it is time (below).

**Upgrade advice — when to move a Cloudflare account to Workers Paid.** Computed per connected
Cloudflare account once a day by the clx.cx cron, from measured use, not from our estimate:
- **sources:**
  - Cloudflare's GraphQL Analytics API with the working token (right **Account Analytics Read**,
    §3): worker invocations of the whole account (all scripts — the quota is shared), D1 rows
    written and read for the whole account. **Checked on a Free account 05.10.2026:**
    `workersInvocationsAdaptive`, `d1AnalyticsAdaptiveGroups` and `d1StorageAdaptiveGroups` answer;
    D1 rows appeared about 15 minutes after the writes; invocations of a script made minutes earlier
    were still counted under `__unknown__` after 20 minutes — so the advice uses account-wide sums,
    never per-script ones. On Free they keep 90 days and one query spans at most 32 days (checked 06.10.2026);
  - the D1 REST API (`GET /accounts/{id}/d1/database/{db}`, D1 Read): the size of `clx-edge`;
  - without the Analytics datasets the request, write and read metrics are **unavailable**, not
    guessed: the advice then shows only size and the backpressure state, and says why;
- **metrics**, each against its Free limit: worker requests/day (100,000), D1 writes/day (100,000),
  D1 reads/day (5M), `clx-edge` size (500 MB);
- **data**: the last 7 complete UTC days (today is never used); the trend is a least-squares line
  through them, used only when there are at least 4 days and the slope is positive — otherwise
  "no forecast"; the days count from the first day with use, so a new account gets no forecast
  until it has 4; size is judged by its current value, without a trend (it grows slowly);
- **backpressure** is not reported by the worker separately: it is on exactly when the database
  is at 400 MB (`FULL_BYTES`), so the advice reads it from the size — 400 MB is `over`;
- **levels** — the highest one that applies, per metric; the account shows its worst metric:
  - `over` — a limit was reached on any of the 7 days (requests, writes or reads at the limit,
    size ≥ 500 MB, backpressure on, or pushes reporting write failures — the last not yet read,
    `docs/TODO.md`): e-mail at once, with what
    stopped working (the list above);
  - `upgrade_soon` — the busiest day ≥ 80%, or the forecast reaches 100% within 7 days: e-mail
    (at most once a week per account) and a banner;
  - `watch` — the busiest day ≥ 60%, or the forecast reaches 100% within 30 days;
  - `ok` — none of the above;
  - each level names the metric, the busiest day and, when there is one, the forecast date: "D1
    writes: busiest day 84,000 of 100,000; at this trend the limit is reached around 19.10";
- size grows slowly and has a free alternative: when it alone is `watch` or worse, the advice also
  offers shorter hourly retention (31 → 14 days) instead of an upgrade;
- **schedule and failures:** at most once per UTC day per account (never sooner than 20 hours, and
  only once a new complete day exists), a slice of accounts per hourly run; `403` leaves that
  metric unavailable; `401` stores nothing and hands the account to the token check (§3), which
  owns `revoked`; anything passing (`429`, `5xx`, network) is retried the next hour;
- the advice is in the UI (account status) and in the API (`GET /v1/accounts/{id}`, §15), so an
  integrator can pass it on to its customer — only while the account is in service (`ready`,
  `no_connection`): an account no longer measured shows none. See
  [ADR 0005](./decisions/0005-upgrade-advice.md).

**clx limits** (one place to change — `src/limits.ts`):

| | `free` | `api` (§15) |
|---|---|---|
| Cloudflare accounts | 1 | 50 |
| sites | 10 | 500 |
| links | 200 | 10,000 |
| rules per link | 10 | 10 |
| totals writes on clx.cx a day | 3,000 | 3,000 + 110 per site + 3 per link |
| breakdown requests a minute | 30 | 30 |
| API keys | 1 | 5 |

## 9. clx.cx accounts

- Kept from v1: PBKDF2-SHA256 passwords with 100,000 rounds (`src/auth/password.ts`; workerd's
  WebCrypto is believed to refuse more than 100,000 iterations — to be checked at stage 6), a
  15-minute JWT (`src/auth/jwt.ts`), a 7-day refresh session in KV `SESSIONS`
  (`src/auth/routes.ts`).
- New:
  - `POST /auth/signup {email, password, turnstile, locale}` → a confirmation e-mail (24 h) with a
    link `/app#/confirm?t=<token>` (in the fragment, so the token reaches no server log or
    `Referer`; `/ru/app#/…` for a Russian account — the account keeps the sign-up page's language,
    and every e-mail speaks it, [ADR 0015](./decisions/0015-app-language.md));
    `POST /auth/confirm {token}`; a signed-in unconfirmed user can ask again
    (`POST /auth/confirm/resend`, the new link replaces the old one). Before confirming the user
    can sign in but cannot connect a Cloudflare account (`email_unconfirmed`). Passwords: 10–256
    characters. Users made by `scripts/user.mjs` are confirmed;
  - `POST /auth/reset {email, turnstile}` + `POST /auth/reset/confirm {token, password}` — password
    reset by e-mail (1 h, `/app#/reset?t=<token>`); a reset ends all sessions: every refresh session and
    access token carries the user's session version, a reset bumps it (`users.session_version`), so
    all issued before are refused at once; it confirms the address too. A new user starts at the
    sign-up time as the version, so a deleted user's sessions never open a user who gets the same
    id (ADR 0010). What tells a known address
    from an unknown one — a token, an e-mail through Cloudflare — is done after the answer, and the
    e-mail limit is taken for any address; a new link replaces the old one only when its e-mail
    goes;
  - one-time e-mail tokens: 32 random bytes, D1 keeps only the SHA-256 and the expiry; consumed by
    one `DELETE … RETURNING`, so a second use fails;
  - sign-up and reset answer the same for a known and an unknown e-mail ("if the address exists, the
    e-mail is on its way"); an existing address that signs up again gets an "you already have an
    account" e-mail;
  - at most one e-mail per address per 10 minutes and 5 a day — a counter in D1 (global, unlike the
    rate limiting binding);
  - Turnstile on sign-up and reset;
  - IP floods — the rate limiting binding (60 s window, per location — a first line, not exact);
  - e-mail — Cloudflare Email Sending from `no-reply@clx.cx` (the `send_email` binding `EMAIL`,
    `env.EMAIL.send({to, from, subject, text})`; beta, Workers Paid only — docs, 07.10.2026). Until a
    domain is onboarded for sending, e-mail reaches only the account's verified addresses
    (`email-service/platform/limits`). clx.cx was onboarded on 07.10.2026: the records sit on
    `cf-bounce` (MX, SPF) and `cf-bounce._domainkey` (DKIM); the zone's own mail server keeps the
    apex MX, SPF and its DMARC record (`docs/cloudflare-facts.md`).
    New accounts start with a daily quota Cloudflare does not publish;
  - deleting an account (`DELETE /v1/me` with the password, page session only): first every session
    and API key of the user ends (a fence — nothing of theirs can start a new connect meanwhile),
    then every Cloudflare account is disconnected (§4), then its totals, call log, e-mail counters
    and the user with keys, sites and links go at once. Refused while an operation runs on one of
    its accounts. Refresh sessions in KV are not indexed by user: they stop working at once and
    expire within 7 days;
- Pages `/privacy`, `/terms`, `/abuse`.

## 10. Reports on clx.cx

The page stack stays (`ui/*`, CSP without `unsafe-inline`); every page action is a `/v1` call (§15).
Pages:
- **Connection:** a "bootstrap token → check → install" wizard with step status.
- **Sites:** add a site by its host, suggested from the account's zones as the reader types
  (`GET /v1/accounts/{id}/zones`; a host in none of them is flagged before sending) — clx.cx still
  finds the zone itself, as the API does ([ADR 0011](./decisions/0011-zone-picker.md)) — the
  snippet, excluded paths, rotate, delete, route status.
- **Links:** the link host, a list of links with 7-day clicks, create and edit, rules, QR (SVG).
- **Report** of a site and of a link — "today", 7, 30 days. Hours arrive up to an hour late, so
  "today" is labelled "as of HH:00 UTC"; visitors — "sum of daily uniques".
- **Status:** last push, bundle and schema version, queue depth, last error, rejected rows, the
  upgrade advice (a banner at `upgrade_soon` and `over`, §8), "reinstall", "renew the token" and
  "disconnect" — the last shows what could not be removed and the link to revoke the working
  token in Cloudflare (§4).
- **API keys** (1 on `free`, 5 on `api`): issue with scopes and allow lists, the key shown once, revoke — keys
  are issued only from a page session (§15), so without this page a user cannot get one.

## 11. Open source

- **clx:** a public repository with a clean history, AGPL-3.0, a README, `wrangler.example.jsonc`.
  The repository holds the product only.
- **`@301st/qr-svg`** — a separate open library on npm, MIT, in its own public repository. API:
  `generateMatrix(text, opts)`, `renderSvg(matrix, opts)`, `buildPathData`. Build with tsup → ESM +
  `.d.ts`, `exports`/`files`, `sideEffects: false`, one dependency — `uqr`; tests decode the output
  back with `jsqr`; a README; CI — tests on PRs, publishing on a tag with provenance. Links do not
  wait for it: until it is published, clx keeps **a copy of its source in the repository**
  (`src/qr/`, with its MIT license and its tests) — a `file:` path would put a private folder into
  the public `package.json` ([ADR 0009](./decisions/0009-qr-copy-in-repo.md)).

## 12. What v1 loses

Removed at stage 1: the v1 collector (beacons forwarded through a CDN), its rollup and reports, the
service token and the site-registration API of the old network, the `sites`/`user_networks` tables
and the old network's data. What stays: sign-in, the page shell, the bot classifier (`src/bots.ts`,
moving into `clx-edge`).

## 13. Risks and open questions

1. **Users' tokens are the main target.** Whoever gets `MASTER_KEYS` and the D1 `clx` rows can write workers
   into every connected account. Measures: minimal rights (§3), the secret only in the Worker,
   decryption in one function, a log of every Cloudflare API call made on a user's behalf (account,
   method, path, status, time) in D1 `clx`, visible to the user, 90 days.
2. **A link host without a DNS record.** Options: (a) Workers Custom Domains
   (`/accounts/{id}/workers/domains`) — per the docs (`workers/configuration/routing/custom-domains`,
   04.10.2026) it creates the DNS record and certificate itself and cannot sit on a host with a
   CNAME; the token rights are not documented; (b) DNS Write and a proxied `AAAA 100::`; (c) the user
   creates the record by following instructions. **MVP — (c)**, no extra rights; (a) is tried on a
   test account at stage 2.
3. **The D1 REST API** accepts several statements separated by `;` or as an array (API docs,
   04.10.2026) but does not promise a transaction — so the config sync (§6) and snapshots (§7) are built
   so that a partial failure is safe. (On a Free account 05.10.2026 a call whose second of three
   statements failed left nothing of the first — but one observation is not a promise: migrations
   stay re-runnable, §4.)
4. **Free quotas are shared** with the user's other workers — the upgrade advice (§8) reads the
   whole account through the Analytics API; without it we see only our own use.
5. **Route conflicts** with the user's other workers and Pages — refuse, never overwrite.
6. **The user deleted the worker or database by hand** — the heartbeat stops (§4); "reinstall"
   installs again (the IDs in our records will not match — the old records are dropped); totals on
   clx.cx are kept.
7. **The working token's lifetime** — one year; renewal — a new bootstrap token.
8. **Privacy.** No cookies ≠ anonymous: IP and UA are processed in memory, the daily hash is a
   pseudonymous identifier until the day closes, a page path can carry personal data (measures —
   §5). Roles: the site owner is the controller, the worker runs in their account; clx.cx is the
   processor of totals. Retention — the table in §2. The `/privacy` text and a template for the
   user's own site policy — stage 6; legal review is out of the spec's scope.
9. **Pages on the same host — the main integrator case, verified 05.10.2026** on a Free account
   (`scripts/probe-pages.mjs`): a worker route `<host>/<path>/*` runs on a Pages custom domain; the
   worker answers its own paths (`POST` → 204, the script → 200); a pass-through `fetch(request)`
   reaches the Pages project — a probe under the path gets the project's own 404, another method its
   own 405, with the same headers as the same request outside the route. One difference remains: on
   HTTP/1.1 header names come back in another case and order through the worker
   (`CF-Cache-Status` / `cf-cache-status`); on HTTP/2 every header name is lower case anyway. The
   check needed no Pages right in the token.
10. **Footprint scan of our own output** (`test/snippet.test.ts`). A test builds snippets for 1,000
    seeds and checks that: no identifier or string literal of 4+ characters other than browser API
    names and values is shared by more than 1% of them; the shape of the code (identifiers and
    literals masked) is shared by at most 1% of them; no `<path>` or name hits the forbidden word list
    (§5). The first draft asked for "no shared substring of 8+ characters" — unworkable as written:
    runs of JavaScript syntax such as `)=>{let ` are in every snippet and in every site's own code,
    so they are no signature; the names, literals and shape are (stage 4, 05.10.2026: 975 shapes in
    1,000 seeds, none more than twice).
11. **API keys reach the working tokens behind them**: a leaked key with the `accounts` or `sites`
    scope can change workers or routes in the Cloudflare accounts it may touch. Measures (§15):
    least-privilege scopes (a build pipeline holds no `accounts`), per-key allow lists of Cloudflare
    accounts and IPs, keys hashed and shown once, revocable one by one, the Cloudflare API call log
    (item 1) shows the key ID.
12. **Backups of the clx.cx database.** A nightly copy to R2 needs R2 switched on, a paid plan in
    the clx.cx account — decided 06.10.2026: after the release ([ADR 0006](./decisions/0006-backups-after-release.md)). The users'
    own databases are theirs; clx.cx keeps only totals (§7).

## 14. Implementation stages

Every stage — tests (vitest on a local D1), review, deploy, a live check. From stage 2 every feature
is built as `/v1` endpoints first (§15) and the page calls them; `docs/openapi.yaml` grows with each
stage.

1. **Public repository** (§11, §12): clean history, license, README, removal of the old network's
   data. Check: `git ls-files` has no agent files and no private strings.
2. **Connecting an account** (§3) and the API frame (§15): plans, API keys, idempotency, errors,
   `/v1/accounts`; bootstrap → working token → probe calls → encryption → log. First of all — the
   Pages check of §13 item 9 and the Analytics datasets on Free (§8). Check: on a test Cloudflare
   account the token is created, every operation in the §3 table passes, the bootstrap token is
   deleted; `401` and `403` give different states; a repeated `POST /v1/accounts` with the same
   `Idempotency-Key` creates nothing new.
3. **Deploy** (§4): bundle, migrations, install with rollback, update with a return to the previous
   bundle, disconnect. Check: on a test account everything is created and fully removed; a taken
   `clx-edge` name is left alone.
4. **Counter + totals** (§5, §7, §8): `/v1/sites`, route, the per-site snippet generator and its
   footprint test (§13 item 10), collector, rollup, queue, receiver, a report with breakdowns from
   the user's database, upgrade advice. Check: a site added by API on a test Pages site, the snippet
   embedded at build time → the visit is in the report within an hour; a probe under `<path>/` gets
   the site's own 404; a repeated and a late push of an hour and an old day snapshot do not change the numbers; a
   foreign target in the body is rejected; after 3 days of downtime the cron catches up within a day
   (15–18 runs), none over the query ledger of §5; a site with 1,500+ combinations in an hour stays within the caps.
   Built in parts, each with its own review and live check: 4a sites, route, snippet, config sync;
   4b the collector; 4c the worker's hourly run, the push and the receiver; 4d the report (4d-1) and
   the upgrade advice (4d-2); **4e the pages of §10** — connection, sites, report, status — for
   everything built so far (stages 2–4 were API only; links get their page in stage 5).
5. **Links, QR, rules** (§6): `/v1/links`, versioned sync, redirect, clicks. Check: a country rule, scanning a QR
   with a phone → a click with source `qr`; an interrupted sync leaves the previous links working.
6. **Sign-up** (§9): e-mails, Turnstile, reset, privacy/terms/abuse. Check: a live e-mail; reusing an
   e-mail token is refused.
7. **`@301st/qr-svg`** (§11) — in parallel with 2–4. At stage 5 clx keeps a copy of it in the
   repository (`src/qr/`), after publishing — takes it from npm and drops the copy.

## 15. Management API

The API is how clx is used without a browser: from a console, by an agent, or by a site generator
that adds a site and embeds its counter at build time.

- **One contract.** `/v1` is the only implementation: the clx.cx page is a thin client over the same
  endpoints with its session token, so the page and the API cannot drift apart. The contract is
  `docs/openapi.yaml`; a test checks that every route in the code is in it and back.
- **Plans** ([ADR 0014](./decisions/0014-a-key-on-free.md)). `free` — what sign-up gives (limits
  in §8), the page and one API key, so an agent can set clx up within those limits. `api` — the
  higher limits of §8 and up to 5 keys; switched on by an admin on request, free of charge for now
  (billing is out of scope; a paid plan comes later). Neither
  plan requires Workers Paid in the user's Cloudflare accounts — the upgrade advice (§8) says when
  one should move.
- **Keys.** `Authorization: Bearer <key>`; 32 random bytes with a readable prefix (`clx_`) so that
  secret scanners catch a leaked one; D1 keeps only the SHA-256. 1 per user on `free`, 5 on `api`, revoked one by
  one. Checking a key writes **at most once a day per key** (`last_used_at`), never per call.
  - **scopes**, chosen at creation, least by default: `accounts` (connect, renew, disconnect —
    the only scope that takes bootstrap tokens), `sites` (add, change, rotate, delete sites),
    `links` (links, rules, QR), `reports` (read totals and breakdowns); a build pipeline needs only
    `sites` + `reports`;
  - **allow lists**: optionally the Cloudflare accounts a key may touch (so one customer's key
    cannot reach another's) and the client IPs;
  - **issuing**: `POST /v1/keys` works only with a page session, never with a key; the answer
    carries the key once. Its idempotency record stores the key ID, not the key, so a repeat
    returns `409 key_already_issued` with that ID; a lost key is revoked and issued again.
    `GET /v1/keys` lists them (ID, prefix, scopes, allow lists, last use), `DELETE /v1/keys/{id}`
    revokes. Rotation — a new key, the old one revoked when the client has switched.
- **Idempotency.** Every `POST`, `PUT`, `PATCH` and `DELETE` takes an `Idempotency-Key` header
  (required with an API key, sent by the page too). The record is keyed by `(principal, method,
  canonical path, Idempotency-Key)` — the principal is the key ID, or the user for a page session —
  and stores a hash of the canonical body. A repeat with the same body returns the first answer and does nothing again; the same key
  with another body is `409 idempotency_conflict`; records live 24 hours.
  - **operations with Cloudflare side effects** (connect, install, route creation, rotation,
    delete) are recorded **before** the first Cloudflare call: an `operations` row (state, step,
    the ID of every resource created so far — §4 ownership) is reserved under the idempotency
    record, and every step writes its result before the next one starts. A retry, a crash or the
    cron resumes the same operation from its last recorded step — it never starts a second one;
  - a step can still die **after** Cloudflare created something and **before** its ID was written.
    So every resource clx creates has a deterministic identity — the script and database `clx-edge`,
    the route pattern of the site, the working token named `clx-<operation id>` — and a resumed step
    first **looks it up** (list scripts, databases, routes, tokens) and adopts what it finds instead
    of creating it again (a script is adopted only if its sha256 is a clx bundle, §4);
  - the working token is the one thing that cannot be adopted: its secret is shown only at
    creation. A resumed connect that finds a `clx-<operation id>` token it holds no secret for
    deletes it with the bootstrap token of the same request and creates a new one. The bootstrap
    token lives only in the request (§3 item 7): if the request dies before the working token is
    stored, the operation ends as `bootstrap_lost`, and its answer and the status page name the
    possibly orphaned token so the customer can revoke it; the next connect with a new bootstrap
    token looks for `clx-*` tokens of earlier lost operations and deletes them too.
- **Long operations** (connecting an account, install, update, route creation) answer `202` with the
  object in its current state; the caller polls `GET` on it. Webhooks to the integrator — later, if
  polling proves not enough.
- **Errors** — `{ "error": { "code": "route_conflict", "message": "…", "details": {…} } }`, codes
  stable and listed in the contract: `invalid_request`, `not_found`, `limit_reached`,
  `idempotency_conflict`, `scope_required`, `key_already_issued`, `account_not_ready`, `route_conflict`, `name_taken`,
  `resource_drift`, `permission_error`, `revoked`, `cron_limit`, `self_check_timeout`, `credentials_missing`, `credentials_unreadable`, `zone_not_found`, `site_exists`, `site_not_active`, `route_not_ours`, `link_host_required`, `link_exists`, `email_unconfirmed`, `invalid_password`, `bootstrap_lost`, `storage_limit`, `rate_limited`. `429` has `Retry-After`.
- **Rate limits** — the rate limiting binding per key: 120 requests a minute (per location, a first
  line), breakdown reports within the 30 a minute of §8. Mutations count towards the clx.cx write
  budget (§8): one idempotency row + the change itself.
- **Endpoints** (everything is scoped to the clx account of the key; another account's object is
  `404`, never `403`; a key outside its allow list or scope gets `404` or `403 scope_required` — paths
  under `/v1/accounts` need `accounts`, `/v1/sites` and the link host `sites`, `/v1/links` `links`
  (each also reads its own objects; reading accounts is open to `sites` too — a build pipeline
  needs the account ids), the reports `reports`):

| Method and path | What it does |
|---|---|
| `GET /v1/me` | plan, limits, current use, whether the address is confirmed, the language |
| `PATCH /v1/me` `{locale}` | the language of the app and the e-mails (page session only, ADR 0015) |
| `DELETE /v1/me` `{password}` | delete the account (page session only, §9) |
| `POST /v1/keys`, `GET /v1/keys`, `DELETE /v1/keys/{id}` | API keys — page session only |
| `POST /v1/accounts` `{cf_account_id, bootstrap_token}` | connect a Cloudflare account and install `clx-edge` (§3, §4) → `202` |
| `GET /v1/accounts`, `GET /v1/accounts/{id}` | state (`pending`, `bootstrap_lost`, `connected` — token ready, not yet installed, `installing`, `ready`, `permission_error`, `revoked`, `resource_drift`, `no_connection`), last push, versions, **upgrade advice** (§8) |
| `GET /v1/accounts/{id}/zones` | the account's zones, read live with the working token (Zone Read), up to 1,000 — the pages suggest a site's or link host's host from them |
| `POST /v1/accounts/{id}/token` `{bootstrap_token}` | renew the working token |
| `POST /v1/accounts/{id}/install` | install `clx-edge` again — after a failed install, or a reinstall (§4) → `202` |
| `DELETE /v1/accounts/{id}` | disconnect (§4) |
| `POST /v1/sites` `{account_id, host, excluded_paths?}` | add a site: the zone is found in the account, the route is created → the site with its snippet |
| `GET /v1/sites?account_id=`, `GET /v1/sites/{id}` | state (`route_pending`, `active`, `route_conflict`), `snippet: {inline, script_tag}` |
| `PATCH /v1/sites/{id}` | excluded paths |
| `POST /v1/sites/{id}/rotate` | a new seed → new `<path>`, names and snippet (§5); the old path counts for 30 more days |
| `DELETE /v1/sites/{id}` | remove the route; totals stay until the account is disconnected |
| `PUT /v1/accounts/{id}/link-host` `{host}` | the link host of that Cloudflare account (§6) |
| `POST /v1/links`, `GET /v1/links`, `GET`/`PATCH`/`DELETE /v1/links/{id}` | links with their rules (§6) |
| `GET /v1/links/{id}/qr.svg` | the QR code |
| `GET /v1/sites/{id}/report?period=`, `GET /v1/links/{id}/report?period=` | totals and series; `&breakdowns=1` adds the breakdowns (§7) |

- **For a site generator** the whole path is three calls: `POST /v1/accounts` once per customer
  account (its bootstrap token comes from the customer — clx needs its own working token, with the
  rights of §3), `POST /v1/sites` per site, and the `snippet` from the answer embedded into every
  page at build time. The snippet is stable, so rebuilding a site needs no call; only `rotate`
  changes it.

## 16. The site and the app

clx.cx is a public site with the app inside it ([ADR 0012](./decisions/0012-site-and-app.md)).
- **Addresses.** The site at the root: `/`, `/privacy`, `/terms`, `/abuse` in English, the same
  under `/ru` in Russian (`/ru`, `/ru/privacy`, …; no trailing slash). The app at `/app` (and
  `/ru/app`, ADR 0015) — the pages of §10, hash-routed (`/app#/accounts/…`), `noindex`. The API, sign-in and the workers' reports stay
  where they were (`/v1`, `/auth`, `/hook`, `/admin`).
- **One table** (`site/pages.ts`) lists the pages and their languages; the generated pages, their
  canonical and hreflang (with `x-default` on English), the sitemap, robots.txt and the footer all
  derive from it. The language comes from the address only.
- **Build.** `scripts/build-ui.mjs` bundles the app (`public/app.js`) and the site's script
  (`public/site.js`), then `site/build.ts` writes the pages; `scripts/check-site.mjs` checks the
  result before every deploy. Nothing generated is committed.
- **Languages.** English and Russian for the site; the app and the e-mails too
  ([ADR 0015](./decisions/0015-app-language.md)): the app at `/app` and `/ru/app` speaks the
  address's language until sign-in, then the account's (`users.locale`, set at sign-up from the
  page, changed on the profile page with `PATCH /v1/me {locale}`); the e-mails speak the account's
  and link to its app. The words are dictionaries of one shape (`ui/i18n/`, `src/mail-text.ts`).
  Legal texts exist in both, English is the original.
- **For agents** ([ADR 0013](./decisions/0013-docs-for-agents.md)), English only: `/agents` — the
  walkthrough an agent follows with a key from its person; `/api` — the reference, generated from
  `docs/openapi.yaml`, which is also served (`/openapi.yaml`, `/openapi.json`). Both and the home page
  have a markdown copy (`/agents.md`, `/api.md`, `/index.md` = `llms.txt`), also served at the page's
  own address to `Accept: text/markdown` (those paths run the Worker first; `Vary: Accept`). Beside
  them: `llms.txt`, `auth.md` (root and `/.well-known/`), `/.well-known/api-catalog` (RFC 9727,
  `application/linkset+json`), the skill `clx-sites` (`/.well-known/agent-skills/`, index with its
  sha256 digest), `Link: …rel="api-catalog", …rel="describedby"` on every page but the app, and
  `Content-Signal: search=yes, ai-input=yes, ai-train=yes` in robots.txt. The zone's Browser
  Integrity Check is off: it refused `Python-urllib` on every path, `/v1` included.
- **Planned** (the product plan, in parts): the app's design system (drawers, dialogs, navigation);
  the content pages and SEO (OG cards, JSON-LD).
