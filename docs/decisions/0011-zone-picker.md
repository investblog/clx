---
title: The host fields suggest the account's zones
type: decision
status: accepted
date: 2026-10-10
---

# 0011. The host fields suggest the account's zones

**Context.** Spec §10 had the site form take a typed host, with no zone picker and no zones
endpoint: clx.cx finds the zone itself when the site is added, and refuses a host in no zone of the
account (`zone_not_found`). In the live check of 10.10 the owner found this error-prone — the reader
does not see which domains the account holds and learns of a typo only after sending.

**Decision.** `GET /v1/accounts/{id}/zones` lists the account's zones (name and status) with the
working token, which already has Zone Read: 50 a call, up to 1,000, `truncated` past that. The host
fields of the site form and the link host form load the list on first focus, suggest zones as the
reader types, mark inactive ones, keep a typed subdomain, and flag a host that is in none of them.
The server's check when a site is added stays as it was.

**Alternatives.** A plain select of zones — cannot take a subdomain (`blog.example.com`). Searching
Cloudflare per keystroke (`name=contains:`) — a call per key, and a host typed in full matches no
zone name.

**Consequences.** One more read call to Cloudflare per form opened. An account with more than 1,000
zones gets no warning about a missing zone (the list is not complete); the server still refuses.
