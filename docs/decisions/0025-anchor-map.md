---
title: An anchor map at /keywords.json, built with the pages
type: decision
status: accepted
date: 2026-10-11
---

# 0025. An anchor map at `/keywords.json`, built with the pages

**Context.** The owner promotes clx through a link pipeline that places links in articles on other
sites. The pipeline makes up no words: it takes each target's anchors from a map the site publishes
and the picture from the page's `og:image` (ADR 0022 gives every page its own). Its format: one
public JSON file, `{ generated, pages: [{ url, locale, primary, keywords, type, title, tags,
excerpt, date }] }`; anchors are plain words (a hyphen or apostrophe only inside a word), no word
or root twice in one anchor, the page's language, 2–7 words, noun phrases rather than search
queries. A broken anchor would be repeated in every article, so the map is checked before it ships.

**Decision.**
- `site/keywords.ts` holds the anchors per page and language; `site/build.ts` writes
  `public/keywords.json` with the url, title (without " — clx"), and description of the page it
  renders, so the map cannot drift from the pages. `generated` is the build time; `date` is the
  last commit that touched `site/`.
- Targets: every indexed page and language except the legal ones (privacy, terms, abuse) — 13
  English, 11 Russian. The home page of a language is `general`, the rest `product`.
- Anchors come from Ahrefs volumes (US and RU, 11.10.2026), rewritten from queries ("how to add a
  visitor counter to a website", "сократить ссылку онлайн") into phrases that fit inside a
  sentence, and say what the page says: `/for-site-generators` is about generated sites, so its
  anchors are too.
- Urls are the canonical ones, without a trailing slash (`https://clx.cx/analytics`): a slash form
  answers 307 to them, and a link through a redirect is worse than the pipeline's slash convention.
- No `<meta name="keywords">`: it is optional, and a second copy is one more place to drift.
- `test/site.test.ts` checks the mechanical rules: every target present once, url and locale in
  agreement, 3–5 alternatives, no anchor shared by two targets of a language, plain words, 2–7 of
  them, no root (first five letters, parts of a hyphenated word apart) twice, English in Latin
  letters, Russian with Cyrillic words and Latin only for names. That an anchor is a noun phrase
  and claims nothing its page does not say is checked by reading, not by the test.

**Consequences.** A new indexed page fails the test until it has anchors. Changing an anchor
changes what new articles say; articles already placed keep the old one.
