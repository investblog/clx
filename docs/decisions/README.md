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
| [0008](./0008-link-host-and-codes.md) | One link host per account, links keyed by code alone | 06.10.2026 | §6 |
| [0009](./0009-qr-copy-in-repo.md) | The QR library is copied into the repository until it is on npm | 06.10.2026 | §6, §11, §14 |
