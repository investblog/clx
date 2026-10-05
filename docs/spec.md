---
title: clx — spec of the open visit counter and short links
updated: 2026-10-05
---

# clx v2 spec: an open visit counter and short links on users' own workers

clx v1 was a private visit counter for one network of sites. v2 is an open product: anyone with a
site on Cloudflare can sign up. The spec was reviewed in three rounds (Codex, 04–05.10.2026); the
fixes from the third round have not been re-reviewed yet.

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
- paid clx plans — there are limits, there is no billing.

The code is AGPL-3.0 in a public repository; anyone can run their own clx.

## 2. Architecture

The platform's worker is installed into the user's Cloudflare account; the user's worker sends totals
back.

```
 visitor ──► example.com/<path>/e ─┐                         ┌─ clx.cx (our account, Workers Paid)
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
| Views with breakdowns (page, source, country, device, browser, OS) | hours — 31 days, days — 400 days | none |
| Totals: views, clicks, bots by hour; visitors by day | computed here | copy: hours — 2 days ("today" chart), days — 400 days |
| Visitor hashes, the day's salt | until the day is closed | never |
| Links and rules | working copy (generations, §6) | source of truth |

Why:
- traffic and writes run on the user's quotas; clx.cx pays about 72 D1 writes a day per site or
  link with traffic (§8);
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
| link host without a DNS record | Workers Custom Domains or DNS | see §13 item 2 |

   Not taken: KV, Pages, Transform/Redirect Rules, SSL, WAF, Firewall, Cache, Analytics, API Tokens
   Edit. Whether a Pages check is needed — open question §13 item 9.
5. Storage: AES-GCM-256, random IV, AAD = record ID + Cloudflare account ID (a ciphertext cannot be
   moved to another account). The key comes from the `MASTER_KEYS` keyring (`key_id → secret`):
   encrypt with the current key, decrypt by the record's `key_id`; rotation — add a new key, re-encrypt
   in the background, then remove the old key. D1 `clx` holds metadata (token ID, expiry, account ID,
   `key_id`); the ciphertext is in KV `CREDENTIALS`.
6. Token state:
   - `401` or `verify` ≠ active → `revoked`, calls stop, the user gets an e-mail;
   - `403` → `permission_error` with the endpoint and Cloudflare's error code; the token is left
     alone — this may be a missing right or plan on one resource;
   - a daily cron runs `verify` on idle tokens; 30 days before expiry — a "renew the connection"
     e-mail (a new bootstrap).
7. Limit: one Cloudflare account per clx user; one Cloudflare account belongs to one clx user.

## 4. Deploy and updates

- **One bundle** `clx-edge` — the same code for everyone; everything user-specific is in bindings
  (`HOOK_URL`) and secrets (`EDGE_KEY`). The bundle's sha256 is pinned by a test, and before a
  rollout it is checked with `GET /admin/edge/bundle-info` (a broken bundle must never reach all
  accounts at once).
- **Resource ownership.** clx.cx records the ID of everything it creates: the database UUID, route
  IDs, the script's name and sha256. If `clx-edge` (worker or database) already exists and is not in
  our records, the install stops with "name taken" and deletes nothing. Rollback and disconnect
  delete only recorded IDs. Before updating or deleting the script, clx.cx reads its current sha256:
  if it matches no clx bundle — status `resource_drift`, the automatic operation stops.
- **Schema migrations** — one ordered list `edge/migrations.ts`, the number kept in
  `PRAGMA user_version`. clx.cx applies them through the D1 REST API **before** uploading new code;
  every migration is compatible with the previous code version (additive only: new tables and
  columns with defaults). The worker compares `user_version` and reports a mismatch in the heartbeat.
- **Install** (every step is checked):
  1. D1 `clx-edge` + migrations;
  2. the worker key: 32 random bytes, we keep only its SHA-256; on reinstall the previous hash is
     accepted for one more day;
  3. upload the script (`PUT …/workers/scripts/clx-edge`, `compatibility_date` fixed in the bundle)
     → secrets → an **every-minute** cron;
  4. self-check: within the next minute the worker sends `setup_ok {deployment_id, bundle,
     user_version}` to `HOOK_URL`; `deployment_id` is single-use and passed as a binding of this
     deployment, so an old or delayed `setup_ok` cannot count for another deployment. When all three
     fields match, clx.cx sets the working cron `5 * * * *`. No `setup_ok` within 5 minutes — the
     install failed.
  A failure in steps 1–4 deletes what this run created.
- **Update**: migrations → upload the new script with a new `deployment_id` and the every-minute
  cron → self-check (as step 4) → the working cron. Before the upload clx.cx remembers the previous
  bundle's sha256 (all bundles are kept in the repository by sha256); if the secrets, the cron or the
  self-check fail, the previous bundle is uploaded again and the `5 * * * *` cron restored. Rollout —
  by an admin command, to everyone or a list, with `dry_run`; the result per account goes into a
  table. Compatibility: the receiver accepts body version `v` of the current and the previous
  release.
- **Liveness:** a heartbeat in every push (§7): bundle sha256, `user_version`, last error, queue
  depth. 26 hours of silence — "no connection" in the UI and an e-mail to the user.
- **Disconnecting clx** by the user: the working token removes the recorded routes, deletes the
  recorded worker and database; we delete the ciphertext. The working token cannot delete itself (it
  has no API Tokens Edit right and never will) — the user revokes it in Cloudflare from a link, or
  pastes a new bootstrap token and clx deletes the working one with it. Totals on clx.cx are deleted
  after 30 days (or at once, by a button).
- **Worker cron:** one, `5 * * * *` (Free allows 5 crons per account).

## 5. Counter

- **Route** `example.com/<path>/*` → `clx-edge`. clx issues `<path>` when a site is added: 6–10
  characters `[a-z0-9]`, different for every site. The worker does not touch the rest of the site.
  If the pattern already has someone else's route — refuse (`route_conflict`), never overwrite.
- **Snippet** — an inline script under 600 bytes: `navigator.sendBeacon('/<path>/e',
  document.referrer)` on load and on SPA address changes (`pushState`/`popstate`). Alternative —
  `<script defer src="/<path>/s.js">` (the same code, served by the worker, cached for a day).
- **Collector** `POST /<path>/e`. The counter is **not fraud-resistant**: the path is visible in
  the HTML, and `Origin`, `Referer`, UA and body can be forged by any client. The checks below drop
  browser noise and cap quota use, but do not prove authenticity.
  - body — `text/plain`, up to 2 KB (no more is read), UA — up to 512 characters;
  - site — by `Host` (+ matched against `Origin` when present);
  - page — the path from a same-host `Referer`, up to 200 characters, **without query and
    fragment**; segments that look like an e-mail, a UUID or a long number/hex (≥ 16 characters) are
    replaced with `:id`; plus the site's list of excluded path prefixes;
  - source — the host from the body (the first absolute URL), own host → empty;
  - country — `request.cf.country`; IP — `cf-connecting-ip`; browser and OS — from the UA; device —
    by UA (`Mobile|Android|iPhone`);
  - **row cap:** at most 300 `views_hourly` rows (combinations of all dimensions) per target per
    hour. D1 enforces the cap, not isolate memory: a `rows_hourly(target, hour, n)` row and the view
    write go in one `batch`: (1) `UPDATE` the existing combination row; (2) if there is none and
    `n < 300` — `INSERT` the row and `n + 1`; (3) if there is none and `n ≥ 300` — upsert an
    `(other)` row (all dimensions `(other)`). A new row costs 2 writes, an existing one 1;
  - IP, UA and body are written neither to the database nor to the log (`console.*`);
  - the answer is always `204 no-store`.
- **Bots** — the classifier `src/bots.ts` (UA signatures, `headless`). `request.cf.botManagement`
  is empty without paid Bot Management (docs `workers/runtime-apis/request`, 04.10.2026) — not
  used. Bots are counted separately.
- **Visitors** — `sha256(day salt | target | IP | UA)` (target — a site or a link, so hashes of
  different links cannot be matched), PK `(target, day, vhash)`; the salt is random and kept in the
  user's D1; hashes and salt are deleted when the day is closed. The metric over a period is the
  **sum of daily uniques** (and labelled so in the UI): one person on two different days counts as
  two.
- **Storage on the user's side** — every table carries a `target` dimension (`s<id>` for a site,
  `l<id>` for a link): `views_hourly`/`views_daily` (target, hour or day, page, source, country,
  device, browser, OS → views), `visitors_daily` (hashes of the open day) / `visitors` (daily
  counts), `bots_hourly`/`bots_daily` (category → hits), `salts`, `closed_days`; plus `outbox` and
  `sync_status` (§7).
- **Worker cron** (hourly; on Free a call may make at most 50 D1 queries, so the work is capped by a
  budget and the rest waits for the next hour):
  1. close at most 3 past days; the rollup is set-based `INSERT … SELECT … GROUP BY` per day, not row
     by row. Closing a day is one D1 transaction (`batch`): hours → days, the visitor count, **the
     day's final row into `outbox`**, deleting hashes and salt, a mark in `closed_days`. On failure
     the day stays open as a whole;
  2. queue in `outbox` the closed hours after the `outboxed_through` cursor and the running row of
     the current day; the cursor moves in the same transaction;
  3. send `outbox` — at most 5 requests of 500 rows (§7);
  4. delete expired data.

## 6. Short links, QR, rules

- **Link host** — the user's choice: a subdomain (`go.example.com`) or a separate domain in their
  account. Route `go.example.com/*` → `clx-edge`. How the subdomain gets its DNS record — §13
  item 2.
- **Link:** a code (3–32 characters `[A-Za-z0-9_-]`, chosen or a random 6) → target; `302`,
  `cache-control: no-store` (every click must reach the worker). A click is written as a view of
  target `l<id>` (page empty, source — the `Referer` host).
- **QR** — SVG via `@301st/qr-svg` (§11), built on clx.cx (download as SVG). The address in the QR
  is `go.example.com/<code>?q`; the worker records `?q` as source `qr` and does not pass it on.
- **Rules:** `{country[], device[], target}`, the first match wins, otherwise the main target. Up
  to 10 rules per link.
- **Targets:** `https://` only, not on the link host (no loops), up to 2048 characters.
- **Sync clx.cx → worker** (a delete-then-insert sync can leave links without rules for as long as
  the second half fails; this design never has a gap):
  - a generation is `(revision, UUID)`: `revision` is a growing per-account number that clx.cx
    issues in the same transaction as the change; sync jobs of one account run one at a time (one in
    flight, the next takes the latest `revision`);
  - writing to the user's D1 through the D1 REST API: insert the whole generation → switch the active
    one conditionally (`UPDATE active SET gen = ?, revision = ? WHERE revision < ?`), so a late old
    generation cannot override a new one → delete generations other than the active one and the two
    before it by `revision` (rollback stays possible);
  - the worker reads a link in one query with a subquery for the active generation
    (`… WHERE code = ? AND gen = (SELECT gen FROM active)`), so the generation cannot vanish between
    two reads;
  - fallback — the worker's cron asks `GET clx.cx/hook/sync?revision=<N>` with `Bearer EDGE_KEY`;
    the account is resolved from the key alone; `304` if `revision` is current, otherwise the full
    generation, which the worker writes the same way;
  - a link cache in isolate memory — 60 s, for speed only.
- **Abuse** is the domain owner's responsibility; on clx.cx: an `/abuse` page and disabling a clx
  account by an admin command (the worker gets an empty generation).

## 7. Totals on clx.cx

- **What is sent** — totals only, no breakdowns. An `outbox` row:
  - hour: `(id, target, hour) → views, bots` — closed hours only, the values are final;
  - day: `(id, target, day, as_of_hour, final) → views, bots, visitors`. While the day runs — a
    running snapshot as of the end of `as_of_hour`; after closing — `final = true`, the day's full
    totals. Daily totals are computed by the worker (it has all the hours); clx.cx does not
    recompute days from hours.
- **Body** (`v: 1`, up to 500 rows and 64 KB): `{ v, bundle, schema, queue, error?, rows: [...] }`.
  The body carries no account.
- **The receiver `POST /hook/push` does not trust the body:**
  - `Bearer EDGE_KEY` → SHA-256 → the current or previous hash → the internal `account_id`;
  - a strict schema: known fields only, `target` belongs to the account, `hour`/`day` not in the
    future and not older than 31 days, numbers — integers ≥ 0 and ≤ 10⁹, the strings
    `bundle`/`schema`/`error` — up to 200 characters;
  - answer `200 {accepted: [id], rejected: [{id, reason}]}`; a bad row is rejected on its own, the
    rest are accepted.
- **Writing on clx.cx** — one D1 transaction (`batch`), inserts of 14 rows per statement (D1 takes
  at most 100 parameters per query, `d1/platform/limits`):
  - hour: `INSERT … ON CONFLICT DO UPDATE` with the same values — a repeat and a late delivery are
    safe;
  - day: update only if the new row's `(final, as_of_hour)` is greater than the stored one (`final`
    never goes back from `true` to `false`), so an old snapshot never overwrites a new one.
  A double push is harmless by protocol; no lock is needed.
- **The queue on the user's side:** after the answer the worker deletes `accepted` rows and bumps
  the attempt count of `rejected` ones; after 3 the row moves to `outbox_rejected` and shows in the
  status UI. Rows older than 31 days are deleted with a mark in the heartbeat (clx.cx would refuse
  them anyway).
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
- **Report:** totals and charts — from clx.cx `hourly`/`daily`; breakdowns (top 10 pages, sources,
  countries, devices, browsers, OS, bots by category) — from the user's D1 through the D1 REST API
  when the report is opened:
  - one `/query` call with a fixed set of queries, 5 s timeout;
  - identical requests in flight are merged; the answer is cached for 5 minutes (in isolate memory —
    for speed only);
  - at most 30 breakdown requests a minute per user;
  - a Cloudflare `429`/`5xx`/timeout or a missing token — totals are shown, breakdowns are
    "temporarily unavailable".

## 8. Quotas and limits

Checked against Cloudflare's live documentation pages on 04.10.2026: `workers/platform/limits`,
`workers/platform/pricing`, `d1/platform/pricing`, `d1/platform/limits`,
`email-service/platform/pricing`.

**clx.cx, Workers Paid.** Included: 10M requests/month, D1 50M writes/month and 25B reads, Email
Sending 3,000 e-mails/month. Beyond that it is billed ($0.30 per 1M requests, $1 per 1M D1 writes,
$0.35 per 1,000 e-mails), so the budget is capped by D1 writes, not by rows per body:
- a target with traffic, per day: 24 hour writes + up to 24 updates of the day row + 24 hour
  deletions after 2 days ≈ **72 writes**; repeats after a lost answer are the same writes again
  (margin ×1.5 ≈ 110);
- **write budget per account** — 3,000 a day (≈ 27 targets with traffic), counted by the receiver.
  Over budget only the final day rows are accepted (1 per target per day); hours and running
  snapshots are rejected for good (`reason: budget`, no retry) — daily totals stay exact, the
  "today" chart is marked "incomplete";
- **connected accounts cap** — 500 at launch: 500 × 3,000 × 30 = 45M writes/month in the worst
  case, the rest (sign-up, sessions, the API call log, expiry deletions) fits in the remaining 5M;
  beyond that — a waiting list until the operator decides to raise it (every +100 accounts is at
  worst ≈ +9M writes ≈ up to $9/month extra);
- the Cloudflare API call log (§13 item 1) records only mutating calls; breakdown reads are not
  logged;
- requests: ≤ 24 pushes a day per account × 500 ≈ 0.4M/month — negligible.

**The user's account, Workers Free.** 100,000 worker requests/day, 10 ms CPU per request, 5 crons
per account; D1 — 100,000 writes/day, 5M reads, 10 databases, 500 MB per database, 50 D1 queries
per invocation. D1 writes spent:

| Event | Writes |
|---|---|
| a view or click, the hour row exists | 1 (`views_hourly`) |
| a visitor new for the day | +2: `visitors_daily` at once, the hash deletion when the day closes (a repeat visitor is `INSERT OR IGNORE`; whether an ignored insert counts as a write is checked at stage 4, the estimate counts it: +1) |
| a new hour row (a new combination) | +4: the `rows_hourly` counter, the day row at rollup, the hour deletion after 31 days, the day deletion after 400 days |
| a bot | 1 (`bots_hourly`) + 2 for a new row (deletions) |
| overhead, per target with traffic per day | `outbox` ≈ 100 (insert and delete of ~50 rows); link sync — per save |

The steady-state worst case — every event comes from a new visitor and makes a new hour row:
1 + 2 + 4 = **7 writes**; overhead at 210 targets with traffic ≈ 21,000. The guaranteed ceiling is
(100,000 − 21,000) / 7 ≈ **11,000 events a day**; the UI shows it as "guaranteed". A typical site
(returning visitors, repeating pages — 1–2 writes per event) gets 35–45 thousand; the UI estimates
from actual use in the totals. The quotas are shared with the user's other workers. When a quota
runs out:
- **worker requests (100k)** — Cloudflare stops invoking the worker: the counter route returns an
  error (the site's pages are not affected — the worker sits only on `<path>/*`), **links stop
  working**;
- **D1 writes** — writes fail; the collector answers `204` without writing, redirects keep working
  (reads remain);
- **D1 reads (5M)** — a redirect cannot read the link → `503 Retry-After`; the isolate cache is no
  guarantee.
The UI warns at 70% of the ceiling, from the totals. To grow, the user moves to Workers Paid; clx
changes nothing.

**clx limits** (one place to change — `src/limits.ts`): per account — 10 sites, 200 links, 10 rules
per link, 3,000 total writes a day, 30 breakdown requests a minute; per service — 500 connected
accounts.

## 9. clx.cx accounts

- Kept from v1: PBKDF2-SHA256 passwords with 100,000 rounds (`src/auth/password.ts`; workerd's
  WebCrypto is believed to refuse more than 100,000 iterations — to be checked at stage 6), a
  15-minute JWT (`src/auth/jwt.ts`), a 7-day refresh session in KV `SESSIONS`
  (`src/auth/routes.ts`).
- New:
  - `POST /auth/signup {email, password}` → a confirmation e-mail (24 h); before confirming the user
    can sign in but cannot connect a Cloudflare account;
  - `POST /auth/reset` + `POST /auth/reset/confirm` — password reset by e-mail (1 h); a reset ends all
    sessions;
  - one-time e-mail tokens: 32 random bytes, D1 keeps only the SHA-256 and the expiry; consumed by
    one `DELETE … RETURNING`, so a second use fails;
  - sign-up and reset answer the same for a known and an unknown e-mail ("if the address exists, the
    e-mail is on its way"); an existing address that signs up again gets an "you already have an
    account" e-mail;
  - at most one e-mail per address per 10 minutes and 5 a day — a counter in D1 (global, unlike the
    rate limiting binding);
  - Turnstile on sign-up and reset;
  - IP floods — the rate limiting binding (60 s window, per location — a first line, not exact);
  - e-mail — Cloudflare Email Sending from `no-reply@clx.cx`; until clx.cx is onboarded as a sending
    domain, e-mail reaches only the account's verified addresses (`email-service/platform/limits`,
    04.10.2026) — onboarding the sending domain is part of stage 6;
  - deleting an account — disconnecting clx (§4) + deleting the user and the totals.
- Pages `/privacy`, `/terms`, `/abuse`.

## 10. Reports on clx.cx

The page stack stays (`ui/*`, CSP without `unsafe-inline`), plus:
- **Connection:** a "bootstrap token → check → install" wizard with step status.
- **Sites:** add a site (a zone from the account, a host), the snippet, excluded paths, route status.
- **Links:** the link host, a list of links with 7-day clicks, create and edit, rules, QR (SVG).
- **Report** of a site and of a link — "today", 7, 30 days. Hours arrive up to an hour late, so
  "today" is labelled "as of HH:00 UTC"; visitors — "sum of daily uniques".
- **Status:** last push, bundle and schema version, queue depth, last error, rejected rows, a
  "reinstall" button.

## 11. Open source

- **clx:** a public repository with a clean history, AGPL-3.0, a README, `wrangler.example.jsonc`.
  The repository holds the product only.
- **`@301st/qr-svg`** — a separate open library on npm, MIT, in its own public repository. API:
  `generateMatrix(text, opts)`, `renderSvg(matrix, opts)`, `buildPathData`. Build with tsup → ESM +
  `.d.ts`, `exports`/`files`, `sideEffects: false`, one dependency — `uqr`; tests decode the output
  back with `jsqr`; a README; CI — tests on PRs, publishing on a tag with provenance. Links do not
  wait for it: until it is published, clx takes it from a local folder (`file:`).

## 12. What v1 loses

Removed at stage 1: the v1 collector (beacons forwarded through a CDN), its rollup and reports, the
service token and the site-registration API of the old network, the `sites`/`user_networks` tables
and the old network's data. What stays: sign-in, the page shell, the bot classifier (`src/bots.ts`,
moving into `clx-edge`).

## 13. Risks and open questions

1. **Users' tokens are the main target.** Whoever gets `MASTER_KEYS` and the KV can write workers
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
   04.10.2026) but does not promise a transaction — so generations (§6) and snapshots (§7) are built
   so that a partial failure is safe.
4. **Free quotas are shared** with the user's other workers — we see only our own use.
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
9. **Pages on the same host.** Whether a `<path>/*` route on a host served by Pages behaves
   predictably is not verified. Stage 3: test on a Pages custom domain. If it interferes — add the
   Pages Read right and a check; if not — record that here.

## 14. Implementation stages

Every stage — tests (vitest on a local D1), review, deploy, a live check.

1. **Public repository** (§11, §12): clean history, license, README, removal of the old network's
   data. Check: `git ls-files` has no agent files and no private strings.
2. **Connecting an account** (§3): bootstrap → working token → probe calls → encryption → log.
   Check: on a test Cloudflare account the token is created, every operation in the §3 table passes,
   the bootstrap token is deleted; `401` and `403` give different states.
3. **Deploy** (§4): bundle, migrations, install with rollback, update with a return to the previous
   bundle, disconnect. Check: on a test account everything is created and fully removed; a taken
   `clx-edge` name is left alone.
4. **Counter + totals** (§5, §7): route, snippet, collector, rollup, queue, receiver, a report with
   breakdowns from the user's database. Check: a visit to a test site → in the report within an
   hour; a repeated and a late push of an hour and an old day snapshot do not change the numbers; a
   foreign target in the body is rejected; after 3 days of downtime the cron catches up in a few
   runs without exceeding 50 D1 queries.
5. **Links, QR, rules** (§6): generations, redirect, clicks. Check: a country rule, scanning a QR
   with a phone → a click with source `qr`; an interrupted sync leaves the previous links working.
6. **Sign-up** (§9): e-mails, Turnstile, reset, privacy/terms/abuse. Check: a live e-mail; reusing an
   e-mail token is refused.
7. **`@301st/qr-svg`** (§11) — in parallel with 2–4. At stage 5 clx takes it from a local folder
   (`file:`), after publishing — from npm.
