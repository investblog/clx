---
title: clx — Cloudflare behaviour checked live
updated: 2026-10-07
---

# Cloudflare behaviour checked live

What clx relies on and found out by trying it — on a Free account unless a section says otherwise —
not by reading. Each entry says
when it was checked, what was used and where clx depends on it. **Look here before designing
against Cloudflare, and add to it whenever a probe finds something new** — a fact goes in once,
with its date; when Cloudflare changes, the entry is corrected, not duplicated.

Probes run with the rights of the working token (`src/cf/connect.ts`: `ACCOUNT_RIGHTS`,
`ZONE_RIGHTS`) unless stated otherwise: a call that works with a Global API Key may still be refused
to the token clx actually holds.

## Tokens (stage 2)

| Fact | Checked | Used in |
|---|---|---|
| A bootstrap token with Account Settings Read + Account API Tokens Write can verify itself, read the permission-group catalog, list, create and delete the account's tokens. | 05.10.2026 | `src/cf/connect.ts` |
| A token just created may answer `401`/`403` for a moment; a few short retries settle it. | 05.10.2026 | `settled()` in `src/cf/connect.ts` |
| The creation answer carries the token's `policies`, so its rights can be compared with what was asked. | 05.10.2026 | `rightsMatch()` |
| `401` = the token is gone; `403` = a right or a plan is missing on one resource. They are never mixed. | 05.10.2026 | `CfError.tokenState` |

## D1 (stage 3)

| Fact | Checked | Used in |
|---|---|---|
| `PRAGMA user_version` (read or write) is refused through the REST API: `7500 not authorized: SQLITE_AUTH`. The schema number lives in a table (`meta`). | 05.10.2026 | `edge/migrations.ts`, `migrate()` |
| `POST …/d1/database/{id}/query` takes several statements separated by `;` and answers one result per statement. A call whose second of three statements failed left nothing of the first — observed once, not promised: migrations stay re-runnable. | 05.10.2026 | `migrate()` |
| `GET …/d1/database?name=` filters by name (treat it as a filter, compare the exact name). | 05.10.2026 | `databaseNamed()` |
| A new database already holds an internal table `_cf_KV`. | 05.10.2026 | — |
| Deleting a database twice: the second answers `7404` "could not be found" — treat as done. | 05.10.2026 | `undo()`, `disconnect()` |
| `/query` takes a `CREATE TRIGGER … BEGIN …; …; END` among other statements in one call; an `UPSERT` inside a trigger body works. | 05.10.2026 | migration 3 (`rows_hourly`) |
| `meta.rows_written` counts index entries too: a new row in a table with a `TEXT PRIMARY KEY` or a composite key = 2, in a `WITHOUT ROWID` table = 1; an update of an existing row = 1 either way; an `UPDATE` matching nothing = 0. | 05.10.2026 | the collector's tables are `WITHOUT ROWID` (§8) |
| An ignored `INSERT OR IGNORE` (or `ON CONFLICT DO NOTHING`) writes 0 rows; a trigger on it does not fire. | 05.10.2026 | repeat visitors (§8), the cap counters (§5) |
| Window functions (`row_number()`/`count()` `OVER (PARTITION BY …)`), row-value comparison and `(a, b) IN (SELECT …)`, `json_group_array(json_object(…))`, `json_each(?)` over a bound string, a CTE with windows inside an `INSERT`, and `INSERT … SELECT * FROM (… UNION ALL …) WHERE true ON CONFLICT DO UPDATE` all work. `ALTER TABLE … ADD COLUMN` works on a `WITHOUT ROWID` table, but it cannot be repeated — a migration that must be re-runnable adds a table instead. | 06.10.2026 | the day close and the queue (§5, §7) |
| `/query` with `params` takes one statement only: `7400 params with multiple statements is not supported`. | 06.10.2026 | clx.cx's REST calls inline literals (`lit()`) |
| The 5-term limit is per compound SELECT, not per statement: the breakdowns query (three 2-term compounds in its CTEs) with one more `UNION ALL` at the top, `json_object`/`json_array`/`json_group_object` and `json_each(?)` in it, runs as one statement with params. | 07.10.2026, live clx-edge database | a link's report reads its live days and breakdowns in one read |
| A compound SELECT takes at most **5 terms**: 6 `UNION ALL` terms fail with `7500 too many terms in compound SELECT` (stock SQLite allows 500, so local tests do not see it). A multi-row `VALUES` and `json_each` do not count. | 06.10.2026, live clx-edge database | the report's breakdowns: one pass joined with `json_each`, not a `UNION ALL` per dimension; the fake D1 refuses more than 4 `UNION`s |
| `INSERT … SELECT … WHERE … ON CONFLICT DO NOTHING / DO UPDATE` works as SQLite documents (the `WHERE` must be there). Every answer carries `meta.size_after`, the database size in bytes. | 05.10.2026 | the collector batch, backpressure (§5, §8) |

## Workers scripts (stage 3)

| Fact | Checked | Used in |
|---|---|---|
| A secret can be sent as a `secret_text` binding inside the upload's metadata — no separate secrets call. | 05.10.2026 | the `uploading` step |
| A re-upload with `keep_bindings: ["secret_text"]` and no secret keeps the existing secret. | 05.10.2026 | update |
| The upload answer's `deployment_id` is the new version's id **without dashes**; `GET …/deployments` gives it with dashes — read it from there. | 05.10.2026 | `liveVersion()` |
| `GET …/workers/scripts/{name}` answers `multipart/form-data` with a new boundary every time; the part named `worker.js` is byte for byte what was uploaded. Hash that part, never the whole answer. | 05.10.2026 | `scriptDigest()` |
| The script list's `etag` depends only on the code (same code with other bindings → same etag), but it is not the code's sha256. | 05.10.2026 | — (clx hashes the code itself) |
| `POST …/workers/scripts/{name}/deployments` `{strategy: "percentage", versions: [{version_id, percentage: 100}]}` returns to an earlier version, with its bindings and secrets. Crons are not part of a version — restore them separately. | 05.10.2026 | `undo()` |
| After such a rollback the code endpoint and the list's `etag` still show the **latest uploaded** version, not the one serving. | 05.10.2026 | drift check (§4) |
| The `workers.dev` address of a script uploaded through the API is off by default. | 05.10.2026 | `edge/worker.ts` (404 there anyway) |
| The script list carries `handlers`; only scripts with `scheduled` can hold cron triggers, so only they need `GET …/schedules`. | 05.10.2026 | the `cron_limit` check |
| A missing script answers `404` with code `10007` ("This Worker does not exist"). | 05.10.2026 | `scriptDigest()`, `undo()` |
| Every call above — D1 create/query/delete, upload, versions, deployments, schedules, delete — works with the working token's rights. | 05.10.2026 | §3 table |

## Cron triggers of a new script (stage 3) — the one that bit

| Fact | Checked | Used in |
|---|---|---|
| Replacing the cron of a **new** script (`PUT …/schedules`, `* * * * *` → `5 * * * *`, at 11:22, ~5 min after the upload) takes effect late: the schedules API showed only the new cron at once, but the old one kept firing every minute until 12:56 (~94 min), and the new one did not fire at 12:05 — first at 13:05 (`workersInvocationsAdaptive` by minute; the script counted as `__unknown__` for the first hour). The day before, a replacement 15 min after the upload fired at the next :05, ~46 min later. | 06.10.2026, one install each | both crons are set at upload, not swapped after the self-check (ADR 0007) |
| Both crons set at upload (`* * * * *` + `5 * * * *`, ADR 0007): in one install (14:45) the self-check confirmed at 14:53 and the working cron pushed at the first `:05` (15:05, 21 min after the install). In the next install (15:22 — re-created **one minute after the same script name was deleted** by the previous probe's disconnect) neither cron fired at all for 65 minutes, until the script was deleted (no invocation of any kind in the analytics; only the beacons, as `__unknown__`). clx.cx's operations log of the test installs that ran to the self-check (05–06.10) points the same way: installs made 0.5–4.5 min after the previous disconnect deleted `clx-edge` got no `setup_ok` in 4 of 4; those 6+ min after it got one in 6 of 7 (the exception, 80 min after, ran on an older clx). A pattern, not a controlled test. | 06.10.2026, two installs + the log | the heartbeat (26 h) stays the backstop; a reinstall right after a disconnect may wait for its cron |
| …but a quick reinstall is not the only case. Install at 01:52 UTC on the test account, whose `clx-edge` had last been deleted **three days** before (07.10): neither cron fired for 80 minutes, until the probe disconnected (`workersInvocationsAdaptive` by minute: only the 4 beacons at 01:53, as `__unknown__`; the install ended `not_confirmed`). The same night an install on another account (00:28) got its `setup_ok` within 5 min. | 10.10.2026, one install | a new user's first totals may wait an hour or more; the heartbeat (26 h) stays the backstop |
| The cron of a **new** script fires late and unevenly: first run after ~4.5, ~5.5 and ~6.5 min in three installs; in a fourth it fired at once and then not for 14 minutes; in a fifth it did not run at all within 15 minutes (no invocation of any kind in the analytics). The cron of an **existing** script that is updated fired after 40–49 s. | 05.10.2026, five live installs | an install does not wait for its first cron (§4); an update does |
| So a self-check must succeed from **one** cron run: clx.cx answers `503` while it is not ready, the worker asks again every 5 s for up to 50 s. | 05.10.2026 | `confirmSetup()`, `edge/worker.ts` |

## Routes and Pages (stages 2, 4)

| Fact | Checked | Used in |
|---|---|---|
| `GET /zones?account.id=&name=` matches the zone name exactly: `sub.example.com` finds nothing — try the host's suffixes. | 05.10.2026 | `zoneFor()` |
| `POST /zones/{zone}/workers/routes {pattern, script}` with the working token creates a route; the same pattern again → `409` code `10020`, the message names the worker that holds it; a route to a script that does not exist → `400` code `10019`; deleting a route twice → `404` code `10009`. | 05.10.2026 | `src/cf/sites.ts` |
| A worker route `<host>/<path>/*` runs on a host served by a Pages custom domain; `fetch(request)` from the worker reaches the Pages project (its own 404 / 405, same headers). No Pages right needed. | 05.10.2026 (`scripts/probe-pages.mjs`) | §5, §13 item 9 |
| A link host with no origin: a proxied `AAAA <host> 100::` record (made seconds before) plus the route `<host>/*` → the worker, made with the working token — the worker answers every request there at once (302 / 404 within a second of the sync); Universal SSL covers a new one-level subdomain right away. The answer carries only Cloudflare's own headers besides the worker's (`cf-ray`, `server`, `alt-svc`, `nel`, `report-to`). | 06.10.2026 (`scripts/probe-links.mjs`) | §6, §13 item 2 |
| `https://<host>/cdn-cgi/trace` shows `loc=` — the country `request.cf.country` gives that client — a way for a probe to know which country rule must match. | 06.10.2026 | `scripts/probe-links.mjs` |
| Through the worker on HTTP/1.1 header names change case and order (`CF-Cache-Status` → `cf-cache-status`); on HTTP/2 all are lower case anyway. | 05.10.2026 | §5 footprint notes |

## Analytics (stage 2–3)

| Fact | Checked | Used in |
|---|---|---|
| GraphQL Analytics on Free answers `workersInvocationsAdaptive`, `d1AnalyticsAdaptiveGroups`, `d1StorageAdaptiveGroups` with Account Analytics Read. | 05.10.2026 | upgrade advice (§8) |
| On Free the three datasets keep **90 days** (`settings { … notOlderThan }` = 7,776,000 s) and one query spans at most **32 days** (`maxDuration` = 2,764,800 s; a wider range is refused: "cannot request a time range wider than 4w4d"); `maxPageSize` 10,000. | 06.10.2026, the dataset `settings` node | §8: 7 days of history are always there |
| D1 rows appear ~15 minutes after the writes; a script made minutes earlier is counted under `__unknown__`. | 05.10.2026 | §8: account-wide sums only |
| `workersInvocationsAdaptive` by `datetimeMinute` and `scriptName` shows when a script ran and how many subrequests it made — the way to see whether a user-side worker ran at all when there are no logs. | 05.10.2026 | diagnosing the self-check |
| Workers Observability (`…/workers/observability/telemetry/query`) is refused (`403`) to the clx.cx deploy token — it holds no Observability right. | 05.10.2026 | — |

## Email Sending and Email Routing (stage 6, the clx.cx zone)

Checked on the clx.cx account (Workers Paid) with the owner's Global API Key — a one-off setup, not
something clx does with its token. The zone's own mail stays on an outside server (apex MX and SPF).

| Fact | Checked | Used in |
|---|---|---|
| `POST /zones/{zone}/email/sending/subdomains {"name": "<zone apex>"}` onboards the domain and **creates its DNS records itself**: three MX and an SPF TXT on `cf-bounce.<zone>`, a DKIM TXT on `cf-bounce._domainkey.<zone>`. Its `…/dns` also lists `_dmarc` `p=reject`, but an existing DMARC record is left as it is (none added). Apex MX and SPF untouched. | 07.10.2026 | §9 e-mail |
| After onboarding, `POST /accounts/{account}/email/sending/send` delivers to any address at once; to an outside server it arrives from `bounces@cf-bounce.<zone>` with SPF, DKIM (`s=cf-bounce; d=<zone>`) and DMARC passing (the receiving MailCow's log). A text body comes quoted-printable. | 07.10.2026 | §9 e-mail |
| A send the receiver refuses (550) shows only in GraphQL `emailSendingAdaptive` (`status: deliveryFailed`, `errorCause`); the send call answers 200 `queued`, and no suppression is added. | 07.10.2026 | diagnosing e-mail |
| Email Routing works on a subdomain while the apex MX points elsewhere: `POST /zones/{zone}/email/routing/dns {"name": "t.<zone>"}` adds MX and SPF on that name only (plus `cf2024-1._domainkey.<zone>`). The zone then reports `enabled: true, status: misconfigured` (`mx.foreign` for the apex) — a report only; the apex records stay. The docs do not say what the call does without `name` — never send it so on a zone with outside mail. | 07.10.2026 | the probes' inbox |
| A routing rule and `support_subaddress` (`PATCH /zones/{zone}/email/routing`) take effect after a delay: mail sent seconds after was refused `550 5.1.1 Address does not exist`, a minute or two later it went through. | 07.10.2026 | the probes' inbox |
| Plus-addressing works on a subdomain: one literal rule `probe@t.<zone>` → a Worker gets `probe+<tag>@t.<zone>`, and the Worker's `message.to` is the full address, tag included. | 07.10.2026 | the probes' inbox (`mailbox/`) |
