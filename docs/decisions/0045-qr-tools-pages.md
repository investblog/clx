---
title: The QR code tools' pages — a generator drawn in the browser by its own script, the API and the extension documented, their own privacy policy
type: decision
status: accepted
date: 2026-11-12
---

# 0045. The QR code tools' pages

**Context.** With the API on `qr.clx.cx` ([ADR 0044](./0044-qr-api-on-qr-clx-cx.md)), the owner's
free QR code generator moves its pages to clx too: the generator itself, the API's documentation,
the browser extension's guide and a privacy policy the extension's store listings can point to. The
old site's searches were almost all for SVG ("qr code generator svg" and the like). clx's own product
is secondary here: a person who wants a QR code needs no account, no Cloudflare and no domain.

**Decision.**
- **Addresses** (`site/pages.ts`): `/qr-code-generator` in English and Russian (on `ru.clx.cx`),
  in every footer; `/qr-code-extension` in both (the extension speaks both); `/qr-code-api` in
  English, like `/api`; `/qr-code-privacy` in both, a legal page of its own. The extension's
  `homepage_url`, its links and the stores' privacy URL are to take these addresses in its next
  release; until then it still links to its old site.
- **The generator draws in the browser.** `site/qr.ts` is a script of its own, `/qr.js`, loaded by
  that page alone, with `@spintax/qr-svg` bundled and its MIT licence in full at the end. It has no
  `fetch`: what is typed is never sent. It draws the code, offers the SVG to download or copy, and
  builds the code's link on the API (`site/qr-core.ts`, the API's own rules: trimmed data, at most
  2,048 UTF-16 units, the preset in the path, `ecc` and `q` always in the query, strict encoding of
  `!'()*`) and an `<img>` snippet. The library draws byte for byte the SVG the API serves for the
  same parameters (measured 12.11 for four presets, all levels and margins; `scripts/probe-qr.mjs`
  checks it on every run). A result computed for an older text never replaces a newer one.
- **No sign-up call on these pages**: no button in the hero and no closing banner. clx appears as
  one card ("Track the scans") and a link to `/short-links`, which links back.
- **Their own privacy policy** rather than a section of `/privacy`: a store's reviewer lands on the
  tools' policy, not on one about clx accounts. `/privacy` and `/abuse` name `qr.clx.cx`.
- **The extension is renamed "SVG QR Code Generator"** (decided 12.11; the stores had no extension
  of that name): what is searched for, rather than a brand nobody looks for. The name lives in one
  constant (`EXTENSION_NAME`, `site/qr-pages.ts`); its store links are by listing id, so the old
  name in their slugs does no harm.
- **The old site's domain forwards** to `/qr-code-generator` once the extension's release with the
  new name, descriptions and links to these pages is out — not before: until then the extension
  still links there.

**Alternatives.**
- The generator in `site.js` — every page would carry the QR library (13.7 KB), and `site.js` calls
  `/auth`, so "nothing is sent" could not be checked by its absence of `fetch`.
- The generator calling `/qr.inline` as the old site did — every code typed would reach a server.
- The policy as `/privacy#qr` — a store reviewer would land on the accounts' policy, and the site's
  link checks allow fragments only for `/faq` groups and the sign-in card.
- The API's documentation in Russian too — its readers are programs and developers, as for `/api`.

**Consequences.** `qr.js` is built by `scripts/build-ui.mjs`, copied to the Russian host, listed in
`site/ru-files.ts` and required by `scripts/check-site.mjs`. The Russian generator links the English
API page; the site test allows that link as it does `/agents` and `/api`. `SVG` joins the Latin
names allowed in Russian anchors (`site/keywords.ts`).
