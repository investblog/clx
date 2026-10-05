---
title: clx — Cloudflare behaviour checked live
updated: 2026-10-06
---

# Cloudflare behaviour checked live

What clx relies on and found out by trying it on a Free account, not by reading. Each entry says
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
| The cron of a **new** script fires late and unevenly: first run after ~4.5, ~5.5 and ~6.5 min in three installs; in a fourth it fired at once and then not for 14 minutes; in a fifth it did not run at all within 15 minutes (no invocation of any kind in the analytics). The cron of an **existing** script that is updated fired after 40–49 s. | 05.10.2026, five live installs | an install does not wait for its first cron (§4); an update does |
| So a self-check must succeed from **one** cron run: clx.cx answers `503` while it is not ready, the worker asks again every 5 s for up to 50 s. | 05.10.2026 | `confirmSetup()`, `edge/worker.ts` |

## Routes and Pages (stages 2, 4)

| Fact | Checked | Used in |
|---|---|---|
| `GET /zones?account.id=&name=` matches the zone name exactly: `sub.example.com` finds nothing — try the host's suffixes. | 05.10.2026 | `zoneFor()` |
| `POST /zones/{zone}/workers/routes {pattern, script}` with the working token creates a route; the same pattern again → `409` code `10020`, the message names the worker that holds it; a route to a script that does not exist → `400` code `10019`; deleting a route twice → `404` code `10009`. | 05.10.2026 | `src/cf/sites.ts` |
| A worker route `<host>/<path>/*` runs on a host served by a Pages custom domain; `fetch(request)` from the worker reaches the Pages project (its own 404 / 405, same headers). No Pages right needed. | 05.10.2026 (`scripts/probe-pages.mjs`) | §5, §13 item 9 |
| Through the worker on HTTP/1.1 header names change case and order (`CF-Cache-Status` → `cf-cache-status`); on HTTP/2 all are lower case anyway. | 05.10.2026 | §5 footprint notes |

## Analytics (stage 2–3)

| Fact | Checked | Used in |
|---|---|---|
| GraphQL Analytics on Free answers `workersInvocationsAdaptive`, `d1AnalyticsAdaptiveGroups`, `d1StorageAdaptiveGroups` with Account Analytics Read. | 05.10.2026 | upgrade advice (§8) |
| D1 rows appear ~15 minutes after the writes; a script made minutes earlier is counted under `__unknown__`. | 05.10.2026 | §8: account-wide sums only |
| `workersInvocationsAdaptive` by `datetimeMinute` and `scriptName` shows when a script ran and how many subrequests it made — the way to see whether a user-side worker ran at all when there are no logs. | 05.10.2026 | diagnosing the self-check |
| Workers Observability (`…/workers/observability/telemetry/query`) is refused (`403`) to the clx.cx deploy token — it holds no Observability right. | 05.10.2026 | — |
