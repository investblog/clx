---
title: The bot's support goes to one group; its admins answer by reply and run operator commands
type: decision
status: accepted
date: 2026-10-19
---

# 0031. The bot's support group, operator commands and the start parameter

**Context.** clx had no way to ask for help or for the `api` plan (§15 says an admin switches it on
"on request", and there was nowhere to send the request). The plan was switched by
`scripts/user.mjs` from the owner's machine. The bot (ADR 0030) answers private chats only,
because its answers carry snippets, codes and account IDs. The owner's catchall.in bot already
routes support to an operator chat that only that chat's admins command. clx takes the scheme
(owner, 19.10.2026) and adds the answer by reply.

## Decision

- **One group, a var.** `TELEGRAM_SUPPORT_CHAT` in `wrangler.jsonc` is the group's chat id. The
  webhook takes messages from private chats and from that group only; every other group is answered
  200 unrecorded, as before. Without the var `/support` says support is not set up.
- **`/support`**, signed in or not (one who cannot sign in needs it most): the next message, or the
  text after the command, goes to the group as `🆘 #u<Telegram id> #<language>`, who wrote it, and
  for a linked Telegram the account's address, plan and source, in one message cut to fit once
  escaped (3,000 characters of the question at most). A message Telegram does not take is told to
  the person, not retried; the question's dialog ends before the send, so a failure after it does
  not post it twice.
- **Answer by reply.** An admin's reply to a question goes to the `#u<id>` of its first line, in
  its `#<language>`, and the group is told whether it went. Only that header routes: a tag the bot
  echoes elsewhere (`/user #u123`) does not, or an admin could make the bot write to anyone (Codex,
  19.10). The way back lives in the message itself: clx stores nothing, and the hashtags make one
  person's questions searchable in the group.
- **Who reads it.** Every member of the group reads the questions — the Telegram name and ID and,
  signed in, the address, plan and source. So the group holds the support staff only, and the
  privacy page names Telegram and what goes there.
- **Admins only.** Who is an admin is Telegram's answer (`getChatMember`: `creator` or
  `administrator`) for every reply and command; no answer is no. Anyone else in the group is not
  heard, and talk among the admins that is neither a command nor a reply to the bot is ignored; a
  command addressed to another bot of the group (`/plan@other_bot`) is not taken.
- **Operator commands** in the group: `/user <email>` (plan, dates, accounts, sites, Telegram,
  source), `/plan <email> free|api` (the person is told in Telegram if linked), `/sources [days]`
  (sign-ups by source, 30 days by default), `/help`. `scripts/tg-setup.mjs commands` shows them in the
  menu of the group's admins only (`scope: chat_administrators`).
- **The start parameter.** `t.me/clxcxbot?start=<source>` (1–32 of `A–Z a–z 0–9 _ -`, kept lower
  case) is written to `users.source` when the bot makes the account; an existing account's is left
  as it was. It tells the announcements apart (`/sources`).
- **`/terms`**: the terms in three lines and links to the full terms and privacy pages of the
  person's language.

## Not done

- An outbox for the group: a Worker that dies mid-send may lose a question asked in the dialog or
  post an inline one twice (Codex, 19.10). Rare, and harmless in a chat; the spec says so.

- A copy of each question by e-mail: clx has no support mailbox; the group is the one channel.
- A source for sign-ups on the site.
