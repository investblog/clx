---
title: A violet brand with its own mark; the report is drawn by affiliate-charts
type: decision
status: accepted
date: 2026-10-10
---

# 0016. A violet brand with its own mark; the report is drawn by affiliate-charts

**Context.** The app took its tokens and components from the 301.st UI, blue included, and its
header showed a generic chart icon. clx gets an identity of its own while keeping the family's
components. The report drew its chart by hand (one SVG of bars and a line) and its breakdowns as
lists with CSS bars.

**Decision.**
- **Colour.** The brand is violet, taken from the logo: `--violet-700` `#4D48ED` is `--primary` in
  both themes (white text on it ≈ 6.06:1); text and the mark on dark surfaces use `--violet-300`
  `#8B87FF` (≈ 6.30:1 on `#111`), hover and text on light ones `--violet-900` `#3A34C8` (≈ 8.38:1
  on white). `--logo` is the mark's colour per theme. The contrast test covers the text tokens.
- **Mark.** A link-and-counter mark drawn on a 100-unit grid (a slanted link between two cut
  brackets), in `public/icons.svg` as `i-mono-clx` (it takes `currentColor`) and in the header of
  the site and the app. Icons: `favicon.svg`; `favicon.ico` with 16, 32 and 48 px entries (search
  engines take a multiple of 48 px; old browsers ask for `/favicon.ico` whatever the page links);
  `apple-touch-icon.png` 180 px, full-bleed, since iOS rounds it and paints transparency black. All
  are listed in `STATIC_FILES`, so a missing one fails the build check.
- **Report charts** are drawn by `affiliate-charts` (MIT, by 301), pinned to an exact version: KPI
  tiles with sparklines, the series (an area for today's hours, columns for days with visitors in a
  tint of the brand, a left gutter sized from the card's width so the axis labels keep off the
  columns), rankings for the breakdowns and a donut for devices. It renders SVG strings with no
  inline styles, so it works under the app's CSP. Every chart is drawn again when the theme
  changes; a ranking or a donut carries its rows as text in its description for screen readers.
  Its licence goes with the bundle, in full, at the end of `public/app.js`.

**Rejected.** Keeping the 301 blue (clx would read as a 301 page). The opposite hue for the second
series (the library's default): for violet it is olive, and visitors are a part of views, not a
rival measure. The hand-drawn chart: no axis values, no tiles, and one more chart code to keep.
