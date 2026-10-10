---
title: clx — brand files
updated: 2026-10-10
---

# Brand files

The decisions behind them: [ADR 0016](../decisions/0016-brand-and-report-charts.md).

| File | What |
|---|---|
| `logo.svg`, `logo-dark.svg` | The mark and "clx" in Onest 600, as outlines — for light and dark backgrounds |
| `mark.svg`, `mark-dark.svg` | The mark alone |
| `icon.svg` | The app icon: the white mark on violet, rounded |
| `apple.svg` | The same, full-bleed: the source of `public/apple-touch-icon.png` (iOS rounds it itself) |

Colours: violet `#4D48ED` (`--violet-700`) on light, `#8B87FF` (`--violet-300`) on dark; the text
`#111111` / `#FFFFFF`. The typeface: [Onest](https://github.com/googlefonts/onest) (SIL OFL 1.1).

## Making them again

- `node mark.mjs <dir>` — the mark from one geometry (a 100-unit grid, a line of 10): `mark*.svg`,
  `icon.svg`, `apple.svg`, `public/favicon.svg` and the sprite symbol `i-mono-clx` of
  `public/icons.svg` (`symbol.txt`).
- `python -P wordmark.py <Onest[wght].ttf> <dir>` — `logo*.svg`: fontTools pins the variable font at
  weight 600 and turns "clx" into outlines; the l stands as high as the mark, on its baseline.
  The font: `ofl/onest/Onest[wght].ttf` in the google/fonts repository.
- `public/favicon.ico` (16, 32 and 48 px) and `public/apple-touch-icon.png` (180 px) are
  `favicon.svg` and `apple.svg` drawn on a browser canvas at those sizes, the ICO holding the three
  PNGs.
