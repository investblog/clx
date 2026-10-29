---
title: External sites — a site not on Cloudflare counted by the user's own clx-edge, on Pro
type: decision
status: accepted
date: 2026-10-30
---

# 0037. External sites: a site not on Cloudflare, counted in the user's own account

**Context.** clx counted only a site whose host is in a zone of a connected Cloudflare account: the
counter is a route `<host>/<path>/*` on the site itself (§5). Owners with sites elsewhere — other
hosting, another DNS — asked for one dashboard of all their sites; the backlog had "a proxy mode for
a site not on Cloudflare, if needed". Two ways were weighed:
- **the beacons go to clx.cx** — rejected: clx.cx would carry its users' traffic on its own quota
  ($5 Workers Paid for everyone), process their visitors' addresses, and one shared address in every
  page is the first thing a blocker list takes;
- **the beacons go to the user's own `clx-edge`**, on a host of one of the user's zones — taken: the
  traffic stays on the user's account and quota, clx.cx still holds only totals, and the address in
  the page is the user's own domain.

The owner chose the second on 30.10.2026, and **only on Pro**: it is a feature to sell, not a teaser.

**Decision.**
- **An external site** (`kind: external`) is added with a `collector_host`; its own host must be in
  no zone of that account (one that is must be added without `collector_host`, as a zone site). Its beacons go to the **collector
  host** — a host in a zone of the same account, already served through Cloudflare (proxied); the
  host of an active site of clx in that account is suggested. clx makes no DNS record (the working
  token has no DNS rights), so a collector host that does not answer through Cloudflare counts
  nothing; the page says so. A collector host is never a link host, and a link host is never a
  collector: a link host passes nothing through.
- **One path for life, no rotation.** Each external site has its own seed and a route `<collector
  host>/<path>/*`, made and removed as a site's (§5, §15), on the collector host's zone. It is not
  rotated (`rotate` answers `400 invalid_request`): its config key is its path, and a
  rotation would leave keys of retired paths that an incremental sync can no longer withdraw (Codex,
  30.10). The footprint a rotation fights is not promised for it anyway; a site on a blocker list is
  deleted and added again.
- **Its config** is the key `ext:<collector host><path>` (§6): target, names, script, excluded paths
  and `origins` — the host names allowed: its host with and without `www.`. One key per site and the seed never changes, so
  a delete or a pause withdraws exactly that key, as a zone site's. The worker looks there when the
  request's host has no site path that matches, by the first two segments of the path, then by the
  first.
- **No two paths on one collector host meet.** Paths come from random seeds; on a shared collector
  host two could be equal, and `ensureRoute` would adopt the other's route as its own. Every new
  seed on a host — a new site of either kind, a zone site's rotation — is drawn and recorded under
  the account's lease, checked against every path the account's sites hold on that host (external
  sites' and the zone site's current, rotating and retiring ones), and drawn again on a match. The
  lease makes the check and the record one step: two adds at once cannot both pass it (Codex, 30.10).
- **The collector of an external site** answers a CORS request: the snippet sends a simple `POST`
  (`fetch`, `keepalive`, `text/plain`, mode `cors`), so the browser always sends the page's real
  `Origin` — a no-cors request (`sendBeacon` with a string, `mode: 'no-cors'`) may carry `null`
  under a strict `Referrer-Policy` (Codex, 30.10). `Origin` must parse as `http://` or `https://`
  with no port but the scheme's own, its lower-case host name in `origins`; the answer is `204`
  with `access-control-allow-origin` set to the `Origin` exactly as sent. A beacon without one, with `null` (a sandboxed
  document) or with another is dropped and answered `204` without the header. A cross-site `Referer`
  carries only the origin by the browsers' default policy, so the page comes from the body: the
  first line is `location.pathname`, the second `document.referrer` (an SPA change sends the path
  only). The rest is the common count — totals, the capped detail, the visitor hash, bots. The
  address and the country are the visitor's: the browser talks to Cloudflare directly. Not
  fraud-resistant, as no beacon is (§5).
- **Its snippet** comes from the same generator, with the absolute address `https://<collector
  host><path>/<c>`, or as `<script src="https://<collector host><path>/<s>.js">`. A page whose CSP
  limits `connect-src` (and, for the tag, `script-src`) must allow the collector host; the page
  says so. No `<img>` pixel: a page without scripts is mostly a bot.
- **The footprint promise does not hold for it.** Its page carries another host's address — the
  user's own, but not the page's — and an integrator's external sites on one collector share it.
  §1 and §5 say so plainly; the site says so too.
- **Hosts.** A live zone site's host stays unique across clx. A user holds a host once, as a zone or
  an external site. An external site reserves its host for no one else: owning a host off
  Cloudflare cannot be shown, and counts arrive only from pages that carry the snippet.
- **Link hosts.** `POST /v1/link-hosts {site_id}` is refused for an external site — its host is in
  no zone; `{account_id, host}` names one.
- **Pro only.** `free` has 0 external sites; an add is `403 limit_reached` (`limit: 0`). They count
  within the plan's sites. When Pro ends every one is paused (§18).
- **A bundle that serves them.** Older bundles never read `ext:`, so an external site is added only
  on an account whose bundle is at or after the first one in `edge/released.json` that serves them;
  else `409 update_required`. The rollout follows ADR 0032.
- **Out of scope:** an account with no zone at all (`workers.dev` — the worker answers 404 there on
  purpose, a request to it would loop).

**Consequences.** The out-of-scope line "sites not on Cloudflare" leaves §1; "clx.cx carries no user
traffic" stays true. The site sells two modes: hidden, for sites on Cloudflare; simple, for any site.
