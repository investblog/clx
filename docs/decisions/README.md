# Decisions

Choices made while building clx v2 that reject a real alternative or depart from the first draft
of [`spec.md`](../spec.md). The spec states what is; these say why, and what was tried instead. A
decision is changed by a new record that supersedes the old one, not by editing it.

| # | Decision | Date | Spec |
|---|---|---|---|
| [0001](./0001-sync-check-in-heartbeat.md) | The worker-side sync check rides on the heartbeat, not on `GET /hook/sync` | 06.10.2026 | §6 |
| [0002](./0002-final-days-table.md) | A closed day's totals wait in `final_days`, not in new columns of `totals` | 06.10.2026 | §5, §7 |
| [0003](./0003-install-without-cron.md) | An install is ready without its first cron; `setup_ok` only confirms | 05.10.2026 | §4 |
| [0004](./0004-report-as-of.md) | The report is "as of" the last hour sent, breakdowns included | 06.10.2026 | §7 |
| [0005](./0005-upgrade-advice.md) | Upgrade advice: once a UTC day, backpressure read from size, 401 left to the token check | 06.10.2026 | §8 |
| [0006](./0006-backups-after-release.md) | Backups of the clx.cx database to R2 — after the release | 06.10.2026 | §13 |
| [0007](./0007-both-crons-at-upload.md) | The working cron is set at upload, next to the self-check | 06.10.2026 | §4, §5 |
| [0008](./0008-link-host-and-codes.md) | One link host per account, links keyed by code alone (superseded by 0024) | 06.10.2026 | §6 |
| [0009](./0009-qr-copy-in-repo.md) | The QR library is copied into the repository until it is on npm | 06.10.2026 | §6, §11, §14 |
| [0010](./0010-session-version-starts-at-sign-up.md) | A new user's session version starts at the sign-up time | 07.10.2026 | §9 |
| [0011](./0011-zone-picker.md) | The host fields suggest the account's zones | 10.10.2026 | §10, §15 |
| [0012](./0012-site-and-app.md) | A site at the root, the app at /app; English and Russian | 10.10.2026 | §9, §10, §16 |
| [0013](./0013-docs-for-agents.md) | Docs for agents, with the API reference generated from the contract | 10.10.2026 | §15, §16 |
| [0014](./0014-a-key-on-free.md) | The free plan has one API key; the api plan on request, unpaid for now | 10.10.2026 | §1, §8, §10, §15 |
| [0015](./0015-app-language.md) | The app's language comes from the address until sign-in, then from the account | 10.10.2026 | §9, §15, §16 |
| [0016](./0016-brand-and-report-charts.md) | A violet brand with its own mark; the report is drawn by affiliate-charts | 10.10.2026 | §10, §16 |
| [0017](./0017-app-in-the-site-frame.md) | The app sits in the site's frame; the sitemap has a view for people (its form superseded by 0020) | 11.10.2026 | §10, §16 |
| [0018](./0018-comparison-pages.md) | Comparison pages name the other service, one market each, facts with sources | 11.10.2026 | §16 |
| [0019](./0019-link-flows.md) | A click records where it was sent; a link with rules shows its flows as a sankey | 11.10.2026 | §6, §7, §10, §16 |
| [0020](./0020-sitemap-view-xslt.md) | The sitemap's view for people is an XSLT stylesheet, not a script in a `<url>` | 11.10.2026 | §16 |
| [0021](./0021-language-switch-in-the-header.md) | The language switch is in the header, the app's too; the profile has none | 11.10.2026 | §10, §16 |
| [0022](./0022-og-card-flows.md) | The Open Graph card's picture is a sankey of made-up flows, one per page | 11.10.2026 | §16 |
| [0023](./0023-mcp-server.md) | An MCP server at /mcp over the same /v1, signed in with the API key | 11.10.2026 | §15 |
| [0024](./0024-link-host-per-site.md) | Link hosts per site, random labels, made as Workers Custom Domains | 11.10.2026 | §3, §6, §13, §15 |
| [0025](./0025-anchor-map.md) | An anchor map at /keywords.json, built with the pages | 11.10.2026 | §16 |
| [0026](./0026-sign-in-on-the-home-page.md) | Sign-in, sign-up and the reset request are a card on the home page | 12.10.2026 | §16 |
| [0027](./0027-workers-subdomain-for-crons.md) | clx gives an account without one its workers.dev subdomain | 12.10.2026 | §4 |
| [0028](./0028-taking-back-a-clx-edge-left-behind.md) | A clx-edge that clx made and lost track of is taken back | 13.10.2026 | §4 |
| [0029](./0029-workers-paid-from-entitlements.md) | The upgrade advice reads Workers Paid from the account's entitlements | 15.10.2026 | §8 |
| [0030](./0030-telegram-bot-and-russian-host.md) | A Telegram bot as a full client; the Russian pages on ru.clx.cx (GitHub Pages) | 16.10.2026 | §16, §17 |
| [0031](./0031-bot-support-group.md) | The bot's support group: answers by reply, operator commands, the start parameter | 19.10.2026 | §15, §17 |
