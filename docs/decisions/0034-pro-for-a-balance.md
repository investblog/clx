---
title: Pro is $9 for 30 days, paid from a prepaid balance charged by the day; what is beyond free is paused without it
type: decision
status: accepted
date: 2026-10-23
---

# 0034. Pro is $9 for 30 days, paid from a prepaid balance charged by the day

Supersedes the pricing part of [0014](./0014-a-key-on-free.md) — the `api` plan is no longer free —
and its consequence that what a user made on `api` keeps working on `free`.

**Context.** The release needs real payments. ADR 0014 aimed at a balance charged per connected
Cloudflare account; on 23.10 the owner chose a flat price instead — one paid plan, simpler to sell
and to explain. Market reference points: Plausible from $9 a month, Fathom $15, Bitly from $8,
Dub $24. clx's own cost per user is small (the counting runs in the user's Cloudflare account), so
the price is set by the market, not by cost. The mechanics come from catchall.in, which has run a
prepaid balance with daily charges since 09.2026.

**Decision.**
- **One paid plan, "Pro": $9 per 30 days**, the limits of today's `api` plan (50 Cloudflare
  accounts, 500 sites, 10,000 links, 5 API keys). The stored value stays `api` — integrators read
  it in `GET /v1/me` — and the site and the app call it Pro.
- **A prepaid balance**, in integer micro-USD, kept as an append-only journal (`ledger`); the
  balance is its sum, never a stored number. Money arrives as deposits
  ([0035](./0035-crypto-on-the-site-stars-in-the-bot.md)), never as a subscription a processor
  renews.
- **Charged by the UTC day: $0.30** (9,000,000 / 30 = 300,000 micro-USD, exact) — a calendar month
  is never used. Pro is a **period** (`pro_periods`: start, end): switching on opens one and
  charges the current day at once (a balance of at least $9 is needed); the cron charges each
  open period's current day at 00:05 UTC. One charge per user and day (a unique index), so a cron
  delivered twice, a switch racing the cron, or off-and-on within a day charges once. Switching off
  ends the period after the day already paid; on again the same day reopens it.
- **Not enough money — grace, then the period closes and the debt is forgiven.** A day the balance
  does not cover starts 3 days of grace: Pro keeps working, an e-mail and a Telegram notice go.
  Each top-up (and each cron run) pays the unpaid days of the open period, oldest first, a whole day
  at a time; when none is left the grace ends. If an unpaid day is still there after 3 days, the
  period is closed at its first unpaid day — the unpaid days fall outside it and are owed by no one —
  and the plan returns to `free`. Pro does not come back by itself: the user switches it on again.
- **On `free`, what is beyond free's limits is paused, not deleted** (owner, 23.10): chosen top
  down so that what is kept can work — the oldest Cloudflare account, then the 10 oldest sites and
  the 200 oldest links of that account, and the oldest key — keep working;
  the rest stop — a paused site does not count, a paused link does not redirect, a paused key is
  refused — and come back when Pro is on again. Without this, one day of Pro for $0.30 would buy
  Pro's estate for good.
- **A plan given by hand** (`/plan <email> api` in the support group) sets `plan_comp`: no charges
  while it is set; an open paid period is closed at its first unpaid day (or after today) and any
  grace ends. `/plan <email> free` clears it.
- **Users on `api` before billing** — all of them given by hand, before there was a price — get a
  $9 bonus and an open period, with notice 14 days before the bonus runs out; none becomes
  `plan_comp`.
- **Deleting a clx account** is refused while there is money on its balance or partner wallet, an
  open payout, refund or invoice, or a referral's deposit young enough to be refunded (owner, 23.10;
  the last so a clawback always finds its wallet). The check sets `deleting_at`, which every money
  writer requires to be empty. When it goes, its journal rows are kept
  for accounting in an archive without the address — never under its user id, which SQLite gives to
  the next user (ADR 0010).

**Rejected.** Per-account pricing (0014's aim): the owner wants one price to sell. Two tiers
(Pro / Agency): a boundary to argue about with no customers yet to price from. Subscriptions at a
processor: crypto and Stars do not renew themselves. Charging 30 days in advance: it narrows the
one-day loophole without closing it, and departs from the daily journal that catchall.in proved.
Keeping the grace days as a debt: a returning user would pay for days of a plan they had lost.

**Consequences.** The site's pricing texts, the FAQ and /terms change; `docs/spec.md` §1, §8, §9,
§15, §18.
