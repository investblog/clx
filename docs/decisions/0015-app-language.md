---
title: The app's language comes from the address until sign-in, then from the account
type: decision
status: accepted
date: 2026-10-10
---

# 0015. The app's language comes from the address until sign-in, then from the account

**Context.** The site speaks English at the root and Russian under `/ru`, the language taken from
the address only (ADR 0012). The app and the e-mails were Russian strings in code. They now speak
both languages, and a signed-out visitor — on the sign-in, sign-up or reset page — has no account
to ask yet, while an e-mail is sent when nobody has a page open at all.

**Decision.**
- The app has a page per language: `/app` (English) and `/ru/app` (Russian), the same script; the
  site's links lead to the app of their own language. Signed out, the app speaks the address's
  language and offers the other one at the same page.
- The account keeps a language (`users.locale`, `en` or `ru`). Sign-up writes the language of the
  page it came from; the profile page changes it (`PATCH /v1/me {locale}`, page session only);
  `GET /v1/me` returns it. Signed in, the app speaks the account's language whichever address it was
  opened at.
- Every e-mail speaks the account's language and links to the app of that language. An e-mail to an
  address that already has an account (a repeated sign-up) speaks that account's language, not the
  sign-up page's.
- The words are TypeScript dictionaries with one shape (`ui/i18n/`, `src/mail-text.ts`): a text
  missing in one language fails `tsc`, nothing falls back silently. Dates and numbers go through
  `Intl` in the language in use.

**Rejected.** `Accept-Language` or a cookie for the signed-out language (the site keeps the language
in the address only; a cookie would make the same address answer differently); one `/app` with the
language picked in the page (the site's "Sign in" link could not carry it).

**Consequences.** Users made before this have Russian (the migration sets it); new ones made by
`scripts/user.mjs` get English. The API's own error messages stay English — the app shows its
dictionary's text for each code.
