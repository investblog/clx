#!/usr/bin/env node
// node scripts/build-og.mjs — the Open Graph card of every indexed page and language (1200×630 PNG),
// at the path its `og:image` names (site/layout.ts, site/urls.ts `ogImagePath`). Run by
// scripts/build-ui.mjs after the pages are written; the output is not committed.
//
// The source is the built pages themselves: the card's path from `og:image`, its words from the
// page's <h1> and meta description — what the page says is what its card says.
//
// SVG → sharp → PNG, no browser (catchall.in's way). The text is drawn as outlines from the Onest cuts
// in site/brand (SIL OFL 1.1), not as <text>: librsvg would take whatever fonts the machine has, and
// the same build would make different cards on different machines. The logo is docs/brand/logo-dark.svg.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import opentype from 'opentype.js';
import sharp from 'sharp';

const OUT = 'public';
const W = 1200;
const H = 630;
const PAD = 72;
const TEXT_W = 640; // the words keep to the left; the chart takes the right
const BG = '#111111'; // --bg of the dark theme
const VIOLET = '#4D48ED';
const TINT = '#8B87FF';
const TEXT = '#FFFFFF';
const MUTED = '#A9ABB3';

const semibold = opentype.loadSync('site/brand/Onest-600.ttf');
const regular = opentype.loadSync('site/brand/Onest-400.ttf');
const logo = fs.readFileSync('docs/brand/logo-dark.svg', 'utf8');
const logoBox = logo.match(/viewBox="([^"]+)"/u)[1];
const logoInner = logo.replace(/^<svg[^>]*>/u, '').replace(/<\/svg>\s*$/u, '');

const decode = (s) =>
  s
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

/** The words of `text`, a word wider than `width` cut into pieces that fit (a long address or ID). */
function pieces(font, text, size, width) {
  return text.split(/\s+/u).flatMap((word) => {
    if (font.getAdvanceWidth(word, size) <= width) return [word];
    const out = [''];
    for (const ch of word) {
      if (out.at(-1) && font.getAdvanceWidth(out.at(-1) + ch, size) > width) out.push('');
      out[out.length - 1] += ch;
    }
    return out;
  });
}

/** Greedy word wrap at `width` px, no line wider than it; null when it needs more than `max` lines. */
export function wrap(font, text, size, width, max) {
  const lines = [];
  let line = '';
  for (const word of pieces(font, text, size, width)) {
    const next = line ? `${line} ${word}` : word;
    if (!line || font.getAdvanceWidth(next, size) <= width) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines.length <= max ? lines : null;
}

/** The largest size from `sizes` at which the text fits in `max` lines; at the smallest, the first
 *  `max` lines with the last cut to end in an ellipsis that still fits the width. */
export function fit(font, text, sizes, width, max) {
  for (const size of sizes) {
    const lines = wrap(font, text, size, width, max);
    if (lines) return { size, lines };
  }
  const size = sizes.at(-1);
  const lines = wrap(font, text, size, width, Infinity).slice(0, max);
  let last = lines[max - 1];
  while (last && font.getAdvanceWidth(`${last}…`, size) > width) last = last.slice(0, -1);
  lines[max - 1] = `${last.trimEnd()}…`;
  return { size, lines };
}

const outline = (font, lines, size, x, y, lead, fill) =>
  lines.map((l, i) => `<path fill="${fill}" d="${font.getPath(l, x, y + i * size * lead, size).toPathData(1)}"/>`).join('');

/** Fourteen columns of a made-up fortnight, views and visitors, in the brand's two violets. */
function chart() {
  const views = [52, 61, 47, 58, 72, 70, 74, 79, 66, 83, 100, 76, 80, 88];
  const [x0, base, colW, step, top] = [800, 556, 13, 24, 230];
  return views
    .map((v, i) => {
      const h = (v / 100) * top;
      const x = x0 + i * step;
      return `<rect x="${x}" y="${base - h}" width="${colW}" height="${h}" rx="3" fill="${VIOLET}"/><rect x="${x + colW - 2}" y="${base - h * 0.42}" width="${colW - 4}" height="${h * 0.42}" rx="2" fill="${TINT}" fill-opacity=".55"/>`;
    })
    .join('');
}

function card(title, description) {
  const t = fit(semibold, title, [64, 58, 52, 46, 40], TEXT_W, 3);
  const titleTop = 232;
  const titleSvg = outline(semibold, t.lines, t.size, PAD, titleTop, 1.12, TEXT);
  const descTop = titleTop + (t.lines.length - 1) * t.size * 1.12 + 62;
  const d = description ? fit(regular, description, [28, 26, 24], TEXT_W, 3) : null;
  const descSvg = d ? outline(regular, d.lines, d.size, PAD, descTop, 1.35, MUTED) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><radialGradient id="glow" cx="0.82" cy="0.18" r="0.7"><stop offset="0" stop-color="${VIOLET}" stop-opacity=".42"/><stop offset="1" stop-color="${VIOLET}" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="${BG}"/><rect width="${W}" height="${H}" fill="url(#glow)"/>
<svg x="${PAD}" y="64" height="56" width="${(56 * Number(logoBox.split(' ')[2])) / Number(logoBox.split(' ')[3])}" viewBox="${logoBox}">${logoInner}</svg>
${titleSvg}${descSvg}${chart()}
<path fill="${MUTED}" d="${regular.getPath('clx.cx', W - PAD - regular.getAdvanceWidth('clx.cx', 26), 102, 26).toPathData(1)}"/>
</svg>`;
}

/** The card's SVG for a title and a description, as the script draws it (exported for the tests). */
export const cardSvg = card;
export { regular, semibold, TEXT_W };

async function main() {
  // From an empty folder: a card of a page or language since removed must not linger and be deployed.
  fs.rmSync(path.join(OUT, 'og'), { recursive: true, force: true });
  const pages = fs
    .readdirSync(OUT, { recursive: true })
    .map((f) => String(f).replaceAll('\\', '/'))
    .filter((f) => f.endsWith('.html'));
  let made = 0;
  for (const f of pages) {
    const html = fs.readFileSync(path.join(OUT, f), 'utf8');
    const image = html.match(/<meta property="og:image" content="https:\/\/[^/]+(\/og\/[^"]+\.png)"/u)?.[1];
    if (!image) continue;
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/u)?.[1]?.replace(/<[^>]+>/gu, '').trim();
    if (!h1) throw new Error(`public/${f} has og:image but no <h1>`);
    const description = html.match(/<meta name="description" content="([^"]*)"/u)?.[1];
    const file = path.join(OUT, image.slice(1));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await sharp(Buffer.from(card(decode(h1), description ? decode(description) : null)))
      .png({ compressionLevel: 9 })
      .toFile(file);
    made++;
  }
  console.log(`og: ${made} cards`);
}

// Run as a script (scripts/build-ui.mjs); imported by the tests, it only lends its functions.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
