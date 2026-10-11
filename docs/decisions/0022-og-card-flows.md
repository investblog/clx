---
title: The Open Graph card's picture is a sankey of made-up flows, one per page
type: decision
status: accepted
date: 2026-10-11
---

# 0022. The Open Graph card's picture is a sankey of made-up flows, one per page

Supersedes the card's picture in [ADR 0016](./0016-brand-and-report-charts.md) (a column chart).

**Context.** The cards (`scripts/build-og.mjs`) had the words on the left and the same small column
chart on the right of every page. 301.sh's cards put a picture behind the words, full width; its
picture comes from a library of backgrounds. The owner asked for the same idea drawn by the charts'
library — the sankey of a link's report (ADR 0019).

**Decision.**
- Behind the words: an affiliate-charts sankey of four columns, its flows made up from the card's
  path (an FNV-1a seed and xorshift), so every page has its own picture and the same page the same
  bytes on every build.
- The library's words go (tags, key, titles): librsvg would draw them in whatever font the machine
  has. Its ribbons and nodes stay, stretched over the right of the card and running off its edge;
  the first column's nodes go, and a mask fades the ribbons in from under the words; a shade from
  left to right keeps the words legible. A bar in the brand's violets closes the card.

**Consequences.** The picture says nothing about the page, as 301.sh's does not; it says what clx
draws. Its look follows affiliate-charts: a new version of the library may change the cards.
