---
title: Top-ups by crypto on the site (Trybit) and by Telegram Stars in the bot
type: decision
status: accepted
date: 2026-10-23
---

# 0035. Top-ups by crypto on the site (Trybit) and by Telegram Stars in the bot

**Context.** The balance of [0034](./0034-pro-for-a-balance.md) needs money in. catchall.in, run
by the same seller, takes crypto through Trybit on its site and Telegram Stars in its bot, and has
met the traps of both live. Telegram allows digital goods inside a bot to be paid only in Stars
([payments for digital goods](https://core.telegram.org/bots/payments-stars)), and clx has a bot
(§17).

**Decision.**
- **On the site — crypto through Trybit**: `USDT_TRC20`, `USDT_BSC`, `USDT_ERC20`, `USDC_ERC20`
  (coin and network in one code, as Trybit names them). `POST /v1/billing/invoices {usd, coin}`
  — whole dollars, $9 to $1,000; at most 3 `pending` invoices per user — makes an invoice with our id
  as `order_id`; the page shows the address and the exact amount to send, network and service fees
  included (the payer bears them).
- **The webhook is only a signal, and it must be signed.** Trybit's token signs no amount, so
  `POST /hook/trybit` only says "look at invoice N": a request without a valid token is refused
  (401) — the reconcile run (below) finds anything a refused or lost webhook would have told — and
  the status is read with our own key from Trybit's API, then settled by the same code as the
  reconcile run.
- **What arrived is credited** — `received_usd`, converted to micro-USD rounding down, never the
  nominal or `amount_paid_usd`, which include the fees. A `partial` payment, one paid with nothing,
  or a canceled invoice with money goes to `review` with a notice in the support group; an operator
  credits what arrived as a `deposit` on that invoice (it earns a partner's commission like any
  other).
- **Reconcile** every 15 minutes (the minute cron of clx.cx): `pending` invoices older than 20
  minutes and `expired` ones up to 30 days old are asked again, 20 a run, honouring `Retry-After`. A
  `pending` invoice a day past its expiry becomes `expired` unless Trybit reports money (`review`);
  crypto that comes to an `expired` invoice later is still credited. `review` ends as `paid` or, when
  nothing came, `void` (operators).
- **In the bot — Telegram Stars**: `/pay` offers packs that match what Telegram sells (750★ → $9,
  2500★ → $30, about $0.012 a star, to be checked against the Telegram dashboard before the
  release). The invoice is made by the same route with `{stars}`; its payload is our invoice id.
  `pre_checkout_query` is answered from reads only. `successful_payment` is checked again before
  money moves: the invoice of the payload, the Telegram user linked to its owner, currency `XTR`,
  the exact number of stars of that invoice, and a state that may still be paid (an hour, plus 15
  minutes for a payment approved just before its end); anything else goes to `review` with a
  notice. Credited once per `telegram_payment_charge_id`; every payment is first kept by that id in
  a table of its own, tied to no user or invoice, so a lost notice, a deleted account or a delivery
  held up cannot lose stars already taken. Past those 15 minutes no checkout is approved, so an
  unpaid Stars invoice expires and, unlike a crypto one, does not hold up deleting the account.
- **One way to credit** for both rails: one deposit per invoice, held by a unique index, so a
  webhook, a reconcile run and a repeated Telegram update cannot credit twice.
- **Refunds** are asked for by the user in the app (`POST /v1/billing/refunds`, with the address
  for crypto — typed by the user, not passed through support) and made by an operator, each tied to
  one deposit: at most what that deposit brought in
  less what was refunded from it already, and never more than the balance holds — both checked in
  the same `INSERT`, and recorded (`refunds`, `pending`) before any money leaves. Within 90 days,
  less the network fee, to an address the user confirms; Stars are refunded in Stars, the whole
  payment only (`refundStarPayment` returns no part), retried from the recorded row if the call
  fails; a Stars payment in review that was never credited goes back by its charge id
  (`/refundstars`), its held invoice made `void` first. A refund takes back the partner's commission and a promo bonus earned by that deposit. No tax handling: the seller is
  301ST Ltd, as for catchall.in.

**Rejected.** Cards through a merchant of record (Paddle, Lemon Squeezy): a new contract and a
review would delay the release; it can be added later as a third rail. Crypto inside the bot:
forbidden by Telegram, and the penalty hides the bot from mobile users. Accepting an unsigned
webhook (catchall.in tolerates one, after Trybit's own sample): with the reconcile run behind it a
refused webhook only delays a credit by minutes.

**Consequences.** Secrets `PAYMENTS_API_KEY`, `PAYMENTS_WEBHOOK_SECRET`; vars `PAYMENTS_SHOP_ID`,
`PAYMENTS_API_URL`. Routes `POST /v1/billing/invoices`, `POST /hook/trybit`; the bot's `/pay`.
`docs/spec.md` §15, §17, §18.
