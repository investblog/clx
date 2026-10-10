// What clx tells an AI agent: the /agents page, the skill file, auth.md and llms.txt. English only —
// the reader is a program. Written by hand, against docs/openapi.yaml (the /api page is made from
// it); a curl here that the API does not take is a bug of this file.
import { ORIGIN } from './pages.ts';

export const SKILL = {
  name: 'clx-sites',
  description:
    "Connect a person's Cloudflare account to clx, add their sites and embed the visit counter, make short links with QR codes and rules, and read visit and click reports through the clx API. Use when asked to count visits or make short links on a domain the person keeps on Cloudflare.",
};

const CF_TOKENS = 'https://dash.cloudflare.com/?to=/:account/api-tokens';

/** The body of /agents. */
export function agentsBody(): string {
  return `<article class="doc">
<h1>clx for AI agents</h1>
<p class="lead">You are setting up visit counting or short links for a person whose domains are on Cloudflare. clx installs a small worker, <code>clx-edge</code>, and a D1 database into their own Cloudflare account; visits and clicks are counted there, and clx.cx keeps only totals. This page is the whole walkthrough. Every endpoint is in the <a href="/api">API reference</a>.</p>

<h2 id="ask">What to ask your human for</h2>
<ol>
<li><strong>An API key</strong> <code>clx_…</code>. The person signs up at <a href="/app">clx.cx/app</a> and confirms their address. The free plan has one key, enough for one Cloudflare account, 10 sites and 200 links; the <code>api</code> plan (more accounts, sites and keys) is switched on by clx on request. They issue the key on the <a href="/app#/keys">Keys</a> page with the scopes you need: <code>accounts</code>, <code>sites</code>, <code>links</code>, <code>reports</code> for the whole setup; <code>sites</code> + <code>reports</code> for a build pipeline that only adds sites. The key is shown once.</li>
<li><strong>The Cloudflare account ID</strong> — 32 hex characters, in the dashboard address after <code>dash.cloudflare.com/</code>.</li>
<li><strong>A bootstrap token</strong>, made by the person in that account. clx uses it within one request to make its own working token, then deletes it. Steps for them:
<ol>
<li>Open <a href="${CF_TOKENS}">Manage account → Account API Tokens</a> (Super Administrator role) → Create Token → Start from scratch (custom token).</li>
<li>Any name, e.g. <code>clx bootstrap</code>.</li>
<li>Permissions, scope Entire Account — search for each name alone: <code>Account API Tokens</code> — Edit; <code>Account Settings</code> — Read.</li>
<li>Expiration: tomorrow. Create the token and hand it to you.</li>
</ol>
</li>
</ol>
<p>Do not store the bootstrap token or print it in logs; do not ask for a Global API Key — clx does not take one.</p>

<h2 id="connect">1. Connect the account</h2>
<pre><code>export CLX=https://clx.cx
export CLX_KEY=clx_...   # from the person

curl -s $CLX/v1/me -H "Authorization: Bearer $CLX_KEY"   # via "key"; plan "free" or "api" sets the limits

curl -s -X POST $CLX/v1/accounts \\
  -H "Authorization: Bearer $CLX_KEY" \\
  -H "Idempotency-Key: connect-&lt;cf_account_id&gt;-1" \\
  -H "Content-Type: application/json" \\
  -d '{"cf_account_id": "&lt;32 hex&gt;", "bootstrap_token": "&lt;token&gt;"}'</code></pre>
<p>The answer is <code>202</code> with <code>account</code>; keep <code>account.id</code>. clx then installs <code>clx-edge</code>: poll <code>GET /v1/accounts/{id}</code> every 5–10 seconds while <code>state</code> is <code>installing</code>; it settles as <code>ready</code> (usually under a minute) or as a problem to show the person. At <code>ready</code>, go on: the worker serves already. It also confirms itself on its first cron, which Cloudflare may run late — until then <code>account.operation</code> shows the install at step <code>selfcheck</code> (up to 15 minutes), and a confirmation that never comes leaves the warning <code>not_confirmed</code> in <code>error.warnings</code>. Neither needs waiting for or acting on.</p>
<ul>
<li><code>connected</code> with an <code>error</code> — the install failed; show the error to the person, then <code>POST /v1/accounts/{id}/install</code>.</li>
<li><code>permission_error</code>, <code>revoked</code>, <code>resource_drift</code>, <code>bootstrap_lost</code> — stop polling and show <code>error</code> to the person: a right is missing, the working token was revoked, <code>clx-edge</code> was changed outside clx, or the connect died before clx stored its token (revoke the token named there and connect again with a new bootstrap token).</li>
<li>A <code>5xx</code> or <code>cloudflare_unavailable</code> answer to the connect leaves the account <code>pending</code>: send the same request again with the same Idempotency-Key (the bootstrap token must still be valid) and clx resumes where it stopped. A connect left alone for an hour turns <code>bootstrap_lost</code>. Three <code>502</code> codes end the connect instead — <code>token_rights_mismatch</code>, <code>token_check_failed</code>, <code>permission_catalog</code>: nothing is left to resume; show the error to the person and connect again later with a new Idempotency-Key.</li>
<li><code>invalid_bootstrap</code>, <code>bootstrap_permission_error</code> — the token is wrong or lacks a right: ask for a new one with exactly the rights above.</li>
<li><code>name_taken</code> — a worker or database named <code>clx-edge</code> that clx did not make is in the account; clx will not touch it. The person decides.</li>
<li><code>limit_reached</code>, <code>account_taken</code>, <code>already_connected</code> — report to the person; do not retry.</li>
</ul>

<h2 id="site">2. Add a site and embed the counter</h2>
<p>The host must be in a zone of that account and proxied through Cloudflare (orange cloud). <code>GET /v1/accounts/{id}/zones</code> lists the zones to pick from.</p>
<pre><code>curl -s -X POST $CLX/v1/sites \\
  -H "Authorization: Bearer $CLX_KEY" \\
  -H "Idempotency-Key: site-example.com-1" \\
  -H "Content-Type: application/json" \\
  -d '{"account_id": "&lt;account.id&gt;", "host": "example.com"}'</code></pre>
<p>The answer carries <code>site.snippet</code>: <code>inline</code> (a <code>&lt;script&gt;</code> under 600 bytes) or <code>script_tag</code> (an external <code>&lt;script src="…"&gt;</code> with <code>defer</code> — use it if the site's CSP forbids inline scripts). Put one of them into every page, e.g. before <code>&lt;/body&gt;</code>. The snippet is stable — a rebuild needs no call; only <code>POST /v1/sites/{id}/rotate</code> changes it. The counter answers once <code>site.config</code> is <code>synced</code> and <code>site.state</code> is <code>active</code> (seconds). <code>route_conflict</code> means another worker already holds the host's route: show <code>error</code> to the person.</p>

<h2 id="links">3. Short links and QR codes</h2>
<p>Links live on a link host — a subdomain given wholly to <code>clx-edge</code>, e.g. <code>go.example.com</code>, with no site on it. It needs a proxied DNS record that clx does not make: the person (or you, if you have their Cloudflare access) adds <code>AAAA go.example.com 100::</code>, proxied. Setting the host takes the scope <code>sites</code> (it routes a host, as a site does); the links themselves, <code>links</code>. Then:</p>
<pre><code>curl -s -X PUT $CLX/v1/accounts/&lt;account.id&gt;/link-host \\
  -H "Authorization: Bearer $CLX_KEY" -H "Idempotency-Key: host-1" \\
  -H "Content-Type: application/json" -d '{"host": "go.example.com"}'

curl -s -X POST $CLX/v1/links \\
  -H "Authorization: Bearer $CLX_KEY" -H "Idempotency-Key: link-spring-1" \\
  -H "Content-Type: application/json" \\
  -d '{"account_id": "&lt;account.id&gt;", "url": "https://example.com/spring", "code": "spring",
       "rules": [{"countries": ["DE", "AT"], "url": "https://example.com/de/spring"},
                 {"devices": ["mobile"], "url": "https://example.com/m/spring"}]}'</code></pre>
<p><code>link.short_url</code> is the address to share. Rules are tried in order; the first match wins, else <code>url</code>. The QR code is <code>GET /v1/links/{id}/qr.svg?size=512</code> with the same <code>Authorization</code> header — scans count with source <code>qr</code>.</p>
<p>To check a link, open it without following the redirect: <code>curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://go.example.com/spring</code> → <code>302</code> and the target. Such a <code>GET</code> is counted as a bot (curl and scripts are), not as a view — a person's click in a browser is a view; a <code>HEAD</code> (<code>curl -I</code>) is redirected but not counted. A rule by country can only be seen from that country; the <code>rules</code> in the link's answer are what the worker applies.</p>

<h2 id="reports">4. Reports</h2>
<pre><code>curl -s "$CLX/v1/sites/&lt;site.id&gt;/report?period=7d&amp;breakdowns=1" -H "Authorization: Bearer $CLX_KEY"</code></pre>
<p><code>period</code> is <code>today</code>, <code>7d</code> or <code>30d</code>; <code>breakdowns=1</code> adds the top pages, sources, countries, devices, browsers, OS and bots, read from the account's own database. Totals reach clx.cx hourly, so a new site shows nothing for the first hour — sometimes longer, when Cloudflare is slow to start the new worker's cron. <code>as_of</code> says how fresh today is (<code>null</code> before the worker's first push). Links have the same report at <code>/v1/links/{id}/report</code>; their today is read live from the account's database, so a click shows within minutes.</p>
<p>When <code>unavailable</code> is set, the breakdowns are missing, and a link's report also lacks the days the worker has not sent yet — its totals then cover clx.cx's closed days only, so do not report them as complete: <code>rate_limited</code> — more than 30 reads of the account databases a minute for this user, ask again in a minute; <code>cloudflare</code> — retry later; <code>not_installed</code> — the worker or its token is gone, check the account's <code>state</code>.</p>

<h2 id="generator">For a site generator</h2>
<p>Three calls: <code>POST /v1/accounts</code> once per customer's Cloudflare account, <code>POST /v1/sites</code> per site, then embed <code>snippet.inline</code> into every page at build time. A key with <code>sites</code> + <code>reports</code>, limited to the customer's account, is enough after the connect.</p>

<h2 id="rules">Ground rules</h2>
<ul>
<li>Send an <code>Idempotency-Key</code> with every POST, PUT, PATCH and DELETE: a new key per intended action, the same key when you retry it. A retry then never does the thing twice.</li>
<li><code>429</code>: wait <code>Retry-After</code> seconds. <code>409 operation_in_progress</code>: another operation on the account is running — wait a few seconds and retry. <code>5xx</code> and <code>cloudflare_unavailable</code>: retry with backoff, with the same Idempotency-Key.</li>
<li>Branch on <code>error.code</code>; show <code>error.message</code> to the person when you stop. Do not loop on a <code>4xx</code>.</li>
<li>clx changes nothing in the person's zones but the routes it makes for <code>clx-edge</code>. Zone settings are theirs: Cloudflare Web Analytics can stay on (clx answers carry no HTML, so it does not interfere; turn it off in the dashboard if one counter is enough), and Browser Integrity Check may refuse scripted clicks on short links.</li>
<li>Disconnecting (<code>DELETE /v1/accounts/{id}</code>) removes <code>clx-edge</code> and its database; the answer names the working token for the person to revoke in Cloudflare, and anything clx could not delete in <code>left</code>.</li>
</ul>

<h2 id="cheatsheet">Cheat sheet</h2>
<pre><code>base_url:      ${ORIGIN}
auth:          Authorization: Bearer clx_...   (1 key on free, 5 on api; scopes accounts, sites, links, reports)
idempotency:   Idempotency-Key on every POST/PUT/PATCH/DELETE; replays for 24 h
connect:       POST /v1/accounts {cf_account_id, bootstrap_token} -&gt; 202; poll GET /v1/accounts/{id}
               while pending|installing; ready, else show error
bootstrap:     Account API Tokens Edit + Account Settings Read, Entire Account, expires tomorrow
site:          POST /v1/sites {account_id, host} -&gt; site.snippet.inline | script_tag
link host:     AAAA &lt;host&gt; 100:: proxied, then PUT /v1/accounts/{id}/link-host {host}
link:          POST /v1/links {account_id, url, code?, rules?} -&gt; link.short_url
qr:            GET /v1/links/{id}/qr.svg?size=512
report:        GET /v1/{sites|links}/{id}/report?period=today|7d|30d&amp;breakdowns=1
limits:        120 req/min per key (429 + Retry-After); reads of the account's database for reports
               30/min per user, cached 5 min (over: 200 with unavailable "rate_limited")
errors:        {"error": {"code", "message", "details"}}
reference:     ${ORIGIN}/api  (${ORIGIN}/api.md, ${ORIGIN}/openapi.json)</code></pre>
</article>`;
}

export function skillMd(): string {
  return `---
name: ${SKILL.name}
description: ${SKILL.description}
---

# Skill: clx sites and links

## What this skill does
Sets up clx for a person: connects their Cloudflare account (clx installs the \`clx-edge\` worker
and a D1 database there), adds sites and returns the counter snippet to embed, makes short links
with rules and QR codes on a link host, and reads visit and click reports.

## When to use it
- The person wants visits counted on a site they keep on Cloudflare, without a third-party script.
- The person wants short links or QR codes on their own domain.
- A site generator has to add a site and embed its counter at build time.

## Prerequisites (from the person)
- A clx API key \`clx_…\` (one comes with the free plan) with the scopes needed: \`accounts\`, \`sites\`, \`links\`, \`reports\`.
- The Cloudflare account ID and a bootstrap token: Account API Tokens — Edit, Account Settings —
  Read, scope Entire Account, expiring tomorrow. clx deletes it after use; never store it.

## How to call it
Base URL \`${ORIGIN}\`; \`Authorization: Bearer $CLX_KEY\`; an \`Idempotency-Key\` on every POST, PUT,
PATCH and DELETE (new per action, the same on retry).

1. \`POST /v1/accounts {"cf_account_id", "bootstrap_token"}\` → \`202\`; poll \`GET /v1/accounts/{id}\`
   while \`state\` is \`pending\` or \`installing\`; go on at \`ready\`, else show \`error\` to the person.
2. \`POST /v1/sites {"account_id", "host"}\` → embed \`site.snippet.inline\` (or \`script_tag\`) in every page.
3. Links: the person adds \`AAAA <host> 100::\` proxied; \`PUT /v1/accounts/{id}/link-host {"host"}\`;
   \`POST /v1/links {"account_id", "url", "code"?, "rules"?}\` → \`link.short_url\`;
   QR at \`GET /v1/links/{id}/qr.svg\`.
4. \`GET /v1/sites/{id}/report?period=7d&breakdowns=1\` (and \`/v1/links/{id}/report\`). Totals arrive hourly.

## Rules
- Branch on \`error.code\`; show \`error.message\` to the person and stop on a \`4xx\` you cannot fix.
- \`429\`: wait \`Retry-After\`. \`409 operation_in_progress\`: retry in a few seconds.
- Full walkthrough: ${ORIGIN}/agents.md. Reference: ${ORIGIN}/api.md, ${ORIGIN}/openapi.json.
`;
}

export function authMd(): string {
  return `# clx auth.md

clx's management API (${ORIGIN}/v1) takes **bearer API keys**:

    Authorization: Bearer clx_...

## Getting a key
- A person signs up at ${ORIGIN}/app (e-mail and password, with a CAPTCHA) and confirms the address.
- The person issues a key on the Keys page of the app, choosing its scopes (\`accounts\`, \`sites\`,
  \`links\`, \`reports\`) and, optionally, the Cloudflare accounts and client IPs it may be used for.
  The key is shown once; one per user on the free plan, up to 5 on the \`api\` plan (switched on by
  clx on request), revoked one by one.

## Registration / provisioning
There is no OAuth and no self-service registration for agents: an agent gets its key from its
person. Issuing a key needs the person's signed-in session, never another key.

## Cloudflare access
To connect a Cloudflare account, clx takes a short-lived bootstrap token from the person (Account
API Tokens — Edit, Account Settings — Read) inside one request, makes its own working token with
it and deletes it. See ${ORIGIN}/agents.
`;
}

export function llmsTxt(): string {
  return `# clx

> A visit counter and short links with QR codes that run as a worker in your own Cloudflare
> account. clx.cx installs the worker, keeps only totals, and has a management API for agents
> and site generators. Open source (AGPL-3.0).

## Docs

- [For AI agents](${ORIGIN}/agents.md): the end-to-end setup an agent runs with an API key from its person
- [Management API](${ORIGIN}/api.md): every endpoint, authentication, idempotency, errors
- [OpenAPI](${ORIGIN}/openapi.json): the contract, machine-readable
- [Authentication](${ORIGIN}/auth.md): how keys are issued
- [Agent skill](${ORIGIN}/.well-known/agent-skills/${SKILL.name}/SKILL.md)

## Policies

- [Privacy](${ORIGIN}/privacy)
- [Terms](${ORIGIN}/terms)
- [Abuse](${ORIGIN}/abuse)
`;
}

export function apiCatalog(): string {
  return `${JSON.stringify(
    {
      linkset: [
        {
          anchor: `${ORIGIN}/v1`,
          'service-desc': [{ href: `${ORIGIN}/openapi.json`, type: 'application/openapi+json', title: 'OpenAPI description' }],
          'service-doc': [{ href: `${ORIGIN}/api`, type: 'text/html', title: 'Management API reference' }],
          describedby: [{ href: `${ORIGIN}/agents`, type: 'text/html', title: 'Guide for AI agents' }],
        },
      ],
    },
    null,
    2,
  )}\n`;
}
