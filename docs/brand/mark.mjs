// Generates the clx mark in every form from one geometry (100×100 grid, line 10).
// The brackets are filled polygons, not clipped strokes, so the mark works as a
// <symbol> inside the shared sprite (clipPath ids do not survive <use> well).
import fs from 'node:fs';

const LINK = 'M64 5H91Q95 5 95 9V36Q95 38 93.6 39.4L39.4 93.6Q38 95 36 95H9Q5 95 5 91V64Q5 62 6.4 60.6L60.6 6.4Q62 5 64 5Z';
const R2 = Math.SQRT2;
const n = (v) => +v.toFixed(2);

// Bracket for line width w: centreline y=5, x=5, chamfer x+y=27; drawn 1 unit
// inside and stroked 2 wide with round joins, which rounds its corners. Its end
// is cut parallel to the link's diagonal, 10.93 units (on x+y) clear of it.
const bracket = (w) => {
  const o = w / 2 - 1;
  const cut = 67 - (w / 2) * R2 - 10.93 - R2;
  const [t, b] = [5 - o, 5 + o];
  const [co, ci] = [27 - o * R2, 27 + o * R2];
  return `M${n(cut - t)} ${n(t)}H${n(co - t)}L${n(t)} ${n(co - t)}V${n(cut - t)}L${n(b)} ${n(cut - b)}V${n(ci - b)}L${n(ci - b)} ${n(b)}H${n(cut - b)}Z`;
};

const body = (c, w = 10) =>
  `<path d="${LINK}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linejoin="round"/>` +
  `<g fill="${c}" stroke="${c}" stroke-width="2" stroke-linejoin="round"><path d="${bracket(w)}"/><path d="${bracket(w)}" transform="rotate(180 50 50)"/></g>`;

const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>\n`;
// The tile: white mark on violet; padding and line differ so 16 px stays legible.
const tile = (rx, pad, w) => {
  const k = (100 - 2 * pad) / 100;
  return svg(`<rect width="100" height="100" rx="${rx}" fill="#4D48ED"/><g transform="translate(${pad} ${pad}) scale(${k})">${body('#fff', w)}</g>`);
};

const out = process.argv[2];
fs.writeFileSync(`${out}/mark.svg`, svg(body('#4D48ED')));
fs.writeFileSync(`${out}/mark-dark.svg`, svg(body('#8B87FF')));
fs.writeFileSync(`${out}/icon.svg`, tile(22, 20, 12));
fs.writeFileSync(`${out}/favicon.svg`, tile(20, 14, 14));
// iOS rounds the corners itself and paints transparency black: full-bleed square.
fs.writeFileSync(`${out}/apple.svg`, tile(0, 20, 12));
fs.writeFileSync(`${out}/symbol.txt`, `<symbol id="i-mono-clx" viewBox="0 0 100 100">${body('currentColor')}</symbol>\n`);
