---
title: The QR code tools' pages in the extension's seven languages — five more on clx.cx under their prefix, only these pages, the rest of the site in English
type: decision
status: accepted
date: 2026-11-12
---

# 0046. The QR code tools' pages in the extension's languages

**Context.** The browser extension ([ADR 0045](./0045-qr-tools-pages.md)) speaks seven languages:
English, Russian, German, Spanish, French, Brazilian Portuguese and Turkish. Its store listings in
each are to link to its page, the generator and the privacy policy in the same language; the site had
English and Russian only. clx itself — the product pages, the app, the mail, the bot, support — stays
in English and Russian: a German page about clx would promise what clx does not offer in German.

**Decision.**
- **Two kinds of language** (`site/pages.ts`): `Locale` (`en`, `ru`) — the site's own, every page;
  `QrOnlyLocale` (`de`, `es`, `fr`, `pt-br`, `tr`) — the QR code tools' pages alone:
  `/qr-code-generator`, `/qr-code-extension` and `/qr-code-privacy` (`QR_LOCALES`). `/qr-code-api`
  stays English, as `/api` does.
- **Addresses**: on clx.cx under the language's prefix — `/de/qr-code-generator`,
  `/pt-br/qr-code-extension` (hreflang `pt-BR`); Russian stays on `ru.clx.cx`. Each page lists all
  seven in its hreflang and its language switch; `x-default` is English.
- **A QR-only page carries the site's header and footer in its language** (`chrome` in
  `site/qr-text.ts`): no menu (it has no product page), "Sign in" and the brand lead to the English
  site, the footer's pages to their English versions with `hreflang="en"`. Any link to a page of the
  table the language lacks goes to its English page (`pagePathFor`, `site/urls.ts`) — in the legal
  text, "see also" and the footer alike.
- **The words** of each QR-only language live in `site/qr-i18n/<lang>.ts`, typed by `QrLanguage`: a
  key missing fails `tsc`. They use the extension's own labels for its buttons, tabs and settings
  (its `_locales`), so the page and the extension say the same thing. The translations of the policy
  say that the English version prevails and link to it.
- **Anchors** (`keywords.json`) in each language come with its words; unlike the English and Russian
  ones they are not picked from measured search volumes.

**Alternatives.**
- Every page of the site in seven languages — the product, its support and the app speak two.
- The QR pages translated on a separate host or a subdomain per language — clx.cx already serves
  prefixed languages (`/ru` before ADR 0030), and one host keeps the hreflang set in one sitemap.
- Machine translation at request time — no static page for search engines to index, and no review.

**Consequences.** Five languages × three pages more in the build, the sitemap and `check-site`; the
language switch on the QR pages lists seven. A change to the English or Russian text of these pages
is a change to five more files. The translations were written by an AI translator against the
English text and the extension's labels; native review is welcome and was not done.
