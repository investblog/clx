---
title: clx gives an account without one its workers.dev subdomain
type: decision
status: accepted
date: 2026-10-12
---

# 0027. clx gives an account without one its workers.dev subdomain

**Context.** A user's first install stopped at the cron step: `PUT …/workers/scripts/clx-edge/schedules`
answered `403`, code `10063` — the account had no workers.dev subdomain, because its Workers pages
had never been opened in the dashboard (`docs/cloudflare-facts.md`, 12.10.2026). The script and its
database had been made; the account was marked "missing rights", and the user went back to check a
bootstrap token that was right all along. The fix by hand is to open Workers & Pages once (the
dashboard makes the subdomain) and reinstall — a manual push in what is meant to run by itself.

**Decision.** When the crons are refused with `10063`, clx makes the subdomain itself with the
working token (`PUT /accounts/{id}/workers/subdomain`, Workers Scripts Write) and sets the crons
again, in the same step:

- the name is random — a letter and ten letters or digits — and says nothing of clx, so it is no
  footprint; a name another account holds is tried again with a new one, three attempts in all;
- `409 10036` (the account has one by now) counts as done;
- the operation records the name (`subdomain_created`) when Cloudflare's answer arrives — an
  answer lost on the way leaves the subdomain made and unrecorded; anything else refused stops the
  install as before;
- the subdomain is not undone when the install fails later: it is the account's, as one the
  dashboard made would be, and it serves nothing of clx.

An account that an install left in `permission_error` because of `10063` (stored with the error's
codes) may be installed again without a new bootstrap token: the token was never the problem
there. Any other `permission_error` — a right really missing, a refused token check — still waits
for a new token, and an update is refused as before.

**Consequences.** Installs work on fresh accounts without a visit to the dashboard. The account
gains a `<random>.workers.dev` it did not have; nothing of clx is served there — scripts uploaded
through the API are not enabled on it — and the user can rename it in the dashboard. Rejected:
only a clearer message asking the user to open Workers & Pages (a manual step in an automated
flow), and naming the subdomain after clx (a footprint across users' accounts).
