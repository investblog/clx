---
title: A Telegram bot as a full client, and the Russian pages on their own host
type: decision
status: accepted
date: 2026-10-16
---

# 0030. A Telegram bot as a full client, and the Russian pages on their own host

**Context.** clx.cx is a Worker behind Cloudflare, and from Russia sites behind Cloudflare often do
not open without a VPN. A Russian reader can find clx, but cannot read the Russian pages, sign up,
sign in or see a report. Telegram does open. The owner's other product, catchall.in, met the same
wall and solved it twice: its Russian pages moved to GitHub Pages, and a Telegram bot became a full
client of its API. clx takes that scheme (owner, 16.10.2026), adapted to what clx does.

## The bot

- **Where.** One route, `POST /hook/telegram`, in the main Worker — beside the workers' hooks, not
  under `/v1`: it is not a method of the management API, so it stays out of `docs/openapi.yaml` and
  the MCP tools. The bot reads and writes the same data as the app; a second Worker would need
  either a second binding to the same database or a right to act as any user.
- **How it acts.** It calls the same `/v1` handlers the app calls, in process, as a principal of its
  own kind — `telegram`, not a page session: a server-side list of the routes it may call (the
  sites, links and reports, connecting an account, the language), its own idempotency space
  (`t:<user>`, so the bot and a page never share a key) and the key `tg-<update_id>`, so a
  redelivered update repeats the stored answer. Routes reserved to a page session — issuing API
  keys, the password — refuse it like they refuse an API key.
- **Who it is.** `/start` asks for an e-mail address and mails a six-digit code to it. The code is
  kept as an HMAC with a Worker secret (a plain hash of six digits is reversed by trying all of
  them), lives 15 minutes and allows three tries, counted atomically. A right code finds the account,
  or makes one with the address confirmed — the code proves the mailbox as a link does — and links
  the Telegram user to it. The bot answers the same whether the address had an account or not. One
  Telegram user to one account, enforced by the schema (both sides unique). Updates from groups are
  ignored, silently: answers carry snippets and codes.
- **An account made in the bot has no password.** The bot never asks for one — a password typed into
  a chat stays in its history. To use the site such a person sets a password by the reset request,
  which mails a link as it does for anyone.
- **Sign-up limits.** The site's switches and limits hold. Turnstile cannot run in a chat, so each
  code costs: codes are limited per Telegram user (a few a day; the user's own limit is checked
  first, so a blocked user cannot use up an address's), per address, and by the same daily mail
  budget the site's sign-up draws from.
- **What it does.** Sign-up and sign-in; the sites and links with their views and clicks of today
  and 7 days (a text sparkline — the bot sends no images); adding a site (it answers with the
  snippet) and a short link; connecting a Cloudflare account; the notices clx now only mails — the
  upgrade advice, the token about to expire, the worker gone silent — also in Telegram when linked.
  Two languages, the account's.
- **What it does not do.** Change the password, issue API keys, disconnect an account or delete a
  site.
- **Taking a Telegram back.** A stolen Telegram reaches the account it is linked to, so the link is
  the account's to end from elsewhere: the app shows the linked Telegram user and unlinks it, and a
  password reset ends the link as it ends the sessions. A link and an unlink are mailed to the
  account's address (best effort — the mail budget and a failed send can lose it, so the app is the
  record), with a link to unlink: a single-use token valid 7 days that opens a page asking to
  confirm, the unlink itself a `POST` — a mail scanner opening the link changes nothing. That page
  and the app are on clx.cx, so a person who cannot open it has only the reset request, also on
  clx.cx; for them a stolen Telegram stays linked until they reach clx.cx somehow.
- **Connecting a Cloudflare account** asks for a code mailed to the account's address first — the
  second channel catchall.in also asks before its one dangerous action. The code is fresh, used
  once, with its own three tries, and bound to its purpose (`connect`), the user, the current link
  and the dialog that asked for it — a sign-in code or an older confirmation does not pass. Then
  the bot warns that the
  bootstrap token will stay in the chat's history, takes it and deletes the message that carried it.
  clx deletes a bootstrap token only when the connection ends (§3): a passing failure leaves the
  operation for a retry, and the bot does not keep the token to retry with. So unless the connection
  finished and clx confirmed the deletion, the bot says the token may still be valid and tells how
  to revoke it by hand, as the app does. catchall.in keeps Cloudflare tokens out of its bot; clx
  accepts them because a Russian user who cannot open clx.cx otherwise cannot connect at all.
- **The webhook.** The `X-Telegram-Bot-Api-Secret-Token` header is compared in constant time (401
  otherwise); 30 messages a minute per Telegram user. An update is recorded as handled
  (`update_id`) only once its outcome is stored; until then a passing failure (D1, the Telegram
  API) answers 500 and Telegram delivers it again — the actions' idempotency keys make the repeat
  safe. Everything final, the user's mistakes included, answers 200. A dialog step lives two
  hours, a mailed code 15 minutes; a command ends the dialog it interrupts (`/help` excepted).
- **Secrets.** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` and `TELEGRAM_CODE_KEY` (the HMAC
  key of the mailed codes); `scripts/tg-setup.mjs` generates the last two, puts them into the
  Worker and the webhook secret into `setWebhook`, printing none. Without them the route answers
  503 `telegram_not_configured`.

## The Russian pages

The Russian site moves to `ru.clx.cx` on GitHub Pages: a public repository that holds only the built
pages (an orphan commit of the build directory), a `CNAME` record that is DNS only — proxied, the
host is behind Cloudflare again. Russian has no `/ru` prefix there.

- `clx.cx/ru/<page>` answers 301 to the same page on `ru.clx.cx`. Two addresses stay on clx.cx:
  the app (`/ru/app`), which needs the API, and the Russian home page `clx.cx/ru`, which carries the
  sign-in card (§16) that the app, the e-mails and the site link to as `/ru#login`, `#register`,
  `#recover` — a fragment never reaches the server, so the Worker could not tell those apart from
  the plain page. It stays as the sign-in page for those who can open clx.cx: `noindex`, its
  canonical on `ru.clx.cx`.
- The pages table (`site/pages.ts`) keeps one URL function that knows the Russian host; canonical
  and hreflang derive from it across the two hosts. Each host has its own sitemap and robots.txt
  listing its own pages.
- On `ru.clx.cx` the first way in is the bot, then links to sign-up and sign-in on clx.cx. The CSP
  goes into a `<meta>` (GitHub Pages sends no headers of ours, so `frame-ancestors` is lost).

## Rejected

- *A separate Worker for the bot* — the same database in two places, or a right to act as anyone.
- *The bot as a page session* — it would pass every page-only route, key issuance among them.
- *A password asked in the chat* — it stays in the chat's history.
- *A Telegram Login Widget on the site* — it runs on a page the Russian reader cannot open.
- *The Russian pages on Yandex Object Storage, as 301.ru* — paid, its own deploy; GitHub Pages is
  free and the scheme already works twice (spintax.net, catchall.in).
- *Keeping Cloudflare tokens out of the chat* — it would leave the Russian user without the one step
  that makes clx work.

## Risks

A stolen Telegram can add sites and links and read the totals until the owner unlinks it; the mail
about a new link is what tells them, and it is best effort. GitHub Pages may become unreachable in Russia too; the build stays a
directory that can move. The code is the first mail, so it must arrive at Russian providers:
catchall.in confirmed Yandex live; mail.ru is unchecked.
