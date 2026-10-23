---
title: Partners get 30% of their referrals' top-ups, for life, one level
type: decision
status: accepted
date: 2026-10-23
---

# 0036. Partners get 30% of their referrals' top-ups, for life, one level

**Context.** The release comes with a partner program. catchall.in has run one since 03.10.2026
on the same terms the owner chose for clx on 23.10; its shape and its lessons are taken over.

**Decision.**
- **30% of every credited deposit** of a referral, for the referral's life, one level, rounded down
  to the micro-USD. Bonuses, promo credit and partner money moved to a balance are not deposits and
  earn nothing. The rate is written into each commission row, so changing it never rewrites the
  past. Commission comes from deposits, not from daily charges: a balance cannot be split into
  "paid with money" and "paid with a bonus".
- **Held 30 days** from the deposit. The commission is always on the whole deposit; each refund
  writes a `clawback` (the rate times all refunded from that deposit, less earlier clawbacks), after
  the hold too and whether or not the commission is written yet, so the two always sum to the rate
  times what the deposit kept. A partner's wallet may so go below zero, and then nothing can be
  moved or paid out of it. A partner cannot delete their account while a referral's deposit is under
  90 days old, so a clawback always finds its wallet.
- **No commission is lost to an outage.** It is written in the same batch as the deposit — only
  while the partner's account exists and is not being deleted — and, for any that is missing, by the cron every 15 minutes — every credited deposit of a referral since the program
  started that has none yet, not a window of days.
- **The partner's wallet is its own journal** (`partner_ledger`). Moving to one's own clx balance is
  one D1 batch writing both journals, or neither; a payout is a request from $20 in USDT (TRC20) that
  reserves its money in the same batch, paid by hand by an operator and marked in the support group (`/paid`, `/reject`). Both are page
  actions only — an API key cannot move money.
- **Attribution.** `clx.cx/?ref=CODE` (any page) sets a 30-day cookie, last touch, only for a valid
  code; the bot takes `t.me/clxcxbot?start=ref_CODE`; a code typed at sign-up wins over the cookie.
  The referrer is written once, when the clx account is made, and never changes; one cannot refer
  oneself. The Russian pages on `ru.clx.cx` (GitHub Pages, §16) cannot set a cookie for clx.cx, so
  they carry the code in their links to clx.cx.
- **Promo codes** share one field and one name space with partner codes (a partner code is looked
  up first): a bonus to the first top-up, to any top-up for a period, or a start credit granted when
  the e-mail is confirmed. Once per user and code, on a deposit of at least $9; a refund of that
  deposit takes the bonus back. A use is counted when the bonus is granted, not when the code is bound.
- **Operators act from the support group** (§17), as for `/plan`: no separate admin page.

**Known risk.** A second account referred by oneself turns the commission into a discount. Softened
by the 30-day hold and by payouts checked by hand; not prevented. catchall.in also alerts when a
referral signs up from the partner's IP address; clx does not: it would mean keeping users' IP
addresses, which clx does nowhere else (§13), for a signal that NAT and mobile networks make weak.

**Rejected.** A second level, pay per sign-up (trivially abused with throwaway accounts), a shared
program with catchall.in (one cabinet for two products: more work and a tie between projects).

**Consequences.** `docs/spec.md` §9 (the sign-up's `code`), §15, §17 (`start=ref_…`), §19; the
app's "Partners" page.
