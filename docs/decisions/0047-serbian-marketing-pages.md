---
title: Marketing languages — the pages about clx in a language the product does not speak; Serbian first, Latin and ekavian, on clx.cx/sr
type: decision
status: accepted
date: 2026-11-18
---

# 0047. Marketing languages: the pages about clx in Serbian

Supersedes, in part, [ADR 0046](./0046-qr-pages-in-the-extensions-languages.md) ("the rest of the
site in English" for a language beyond the site's two).

**Context.** The site is translated language by language, as the owner's other products are; Serbian
comes first (owner, 18.11.2026). clx itself — the app, the mail, the bot, support, the legal texts —
speaks English and Russian, and ADR 0046 kept every other language to the QR code tools' pages, so as
not to promise what clx does not offer in that language. A product page can be read in Serbian without
that promise as long as every step after it says plainly that it is in English.

**Decision.**
- **A third kind of language** (`site/pages.ts`): `MarketingLocale` (`sr`) beside `Locale` (`en`,
  `ru`: the site, the app, the mail, the bot) and `QrOnlyLocale` (ADR 0046). A marketing language has
  the pages about clx: the home page, `/analytics`, `/short-links`, `/for-site-generators`,
  `/pricing`, `/faq`, `/how-it-works`, `/open-source`, `/qr-code-generator` and the 404
  (`CONTENT_LOCALES`, `GENERATOR_LOCALES`). It has its own header and footer in its words.
- **What stays in English, linked as English.** The app, sign-up and sign-in (the home page has no
  sign-in card; "Start free" and "Sign in" lead to clx.cx's English card), the legal texts, `/vs-301`
  and the comparisons, the extension's page and its policy (the extension does not speak Serbian),
  the docs for agents. A link to them goes to the English page (`pagePathFor`), with `hreflang="en"`
  in the footer, and says "na engleskom" where the reader would not expect English: the legal pages in
  the footer, the extension and its policy, the QR code API, the home page's buttons to the docs for
  agents and the API reference. The app's own page names
  ("Balance", "Partners") are quoted in English.
- **Serbian is Latin script and ekavian only.** `lang` and hreflang `sr-Latn`, `og:locale` `sr_RS`,
  the switch shows `SR` with the Serbian flag. Numbers go through `Intl` with `sr-Latn`: bare `sr`
  writes Cyrillic. No Cyrillic twin, as on the owner's other Serbian site: Cyrillic queries had no
  measured search volume there, and a Latin–Cyrillic transliteration path is where Serbian pages broke.
- **Addresses** on clx.cx under the prefix: `/sr`, `/sr/pricing` — served by the static assets like
  any page; the Russian host lists them in its hreflang.
- **The words** of a marketing language live in `site/lang/<lang>/`, typed by `MarketingLanguage`
  (`site/lang/index.ts`): the strings, the product pages, the FAQ's frame, the generator, the
  banners of our other services, the anchors of `keywords.json` (not picked from measured search
  volumes, as ADR 0046's). English and Russian stay beside their templates; `byLocale` puts a
  marketing language beside them, so a missing key fails `tsc`.
- **A guard** (`test/site-sr.test.ts`): Serbian stays on its pages; its strings have the shape of the
  English (no question or table row dropped); not one Cyrillic letter, in the words and in the built
  pages (the language switch's name of Russian aside); none of the common ijekavian or Croatian roots;
  `đ`, not `dj`.

**Alternatives.**
- *Serbian as a site language, with the app, the mail and the bot* — every product text, the mail
  and the bot in a third language, for a market not yet measured.
- *Serbian as a QR-only language* (ADR 0046) — the generator alone; the owner wants the site.
- *Serbian in Cyrillic, or in both scripts* — see above; a script switch doubles every page and the
  places it can break.
- *A Serbian sign-up* — the account's language (`users.locale`) is `en` or `ru`; a Serbian card would
  sign people up into an English app and English mail without saying so.

**Consequences.** Ten Serbian pages more in the build, the sitemap, `keywords.json` and the Open Graph
cards; every page of the table names Serbian in its hreflang where it has it, on both hosts, so a
deploy of clx.cx is followed by `scripts/deploy-ru.mjs`. A change to the English text of these pages
is a change to the Serbian file too. The translation was written by an AI translator against the
English text; a native reader's review is welcome and was not done. The next marketing language is a
folder in `site/lang/`, a line in `MARKETING_LOCALES`, its flag and a guard of its own.
