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
// The background is a sankey of affiliate-charts, as 301.sh's cards have a picture behind the words:
// flows made up from the card's path, so every page has its own, rising from under the words.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import opentype from 'opentype.js';
import sharp from 'sharp';
import Sankey from 'affiliate-charts/charts-sankey.js';

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

/** A made-up but steady random series from `seed`: the same card on every build. */
function random(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 10000) / 10000;
  };
}

/** The card's background: flows across four columns, drawn by affiliate-charts' sankey — the chart a
 *  link's report draws (ADR 0019) — made up from `seed` (the card's path), so each page has its own.
 *  The library's words go (its tags, key and titles); its ribbons and nodes stay, stretched over the
 *  card. */
function flows(seed) {
  const r = random(seed);
  const sizes = [4, 5, 4, 3].map((n) => n + Math.floor(r() * 2));
  const id = (c, i) => `c${c}n${i}`;
  const nodes = sizes.flatMap((n, c) => Array.from({ length: n }, (_, i) => ({ id: id(c, i), column: c, short: '-', label: '-', display: '-' })));
  const links = new Map();
  const add = (from, to, value) => links.set(`${from}>${to}`, { from, to, value: (links.get(`${from}>${to}`)?.value ?? 0) + value, display: '-' });
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < sizes[c]; i++) for (let k = 1 + Math.floor(r() * 2); k > 0; k--) add(id(c, i), id(c + 1, Math.floor(r() * sizes[c + 1])), 10 + Math.floor(r() * 90));
    // Every node of the next column gets a flow in.
    for (let j = 0; j < sizes[c + 1]; j++) if (![...links.values()].some((l) => l.to === id(c + 1, j))) add(id(c, Math.floor(r() * sizes[c])), id(c + 1, j), 10 + Math.floor(r() * 50));
  }
  const svg = Sankey.sankey(nodes, [...links.values()], { brand: VIOLET, theme: 'dark', classPrefix: 'og' })
    .replace(/<g class="og-key">[\s\S]*<\/g>/u, '')
    .replace(/<text[^>]*>[^<]*<\/text>/gu, '')
    .replace(/<title[^>]*>[^<]*<\/title>/gu, '')
    .replace(/^<svg[^>]*>/u, '')
    .replace(/<\/svg>$/u, '');
  // The plot is 240 high under an 8 px top: stretched to the card's height, a little past its edges;
  // it starts under the words and runs off the right edge, so its first nodes stay out of the title.
  const [x, w] = [470, W - 470 + 120];
  return `<svg x="${x}" y="-24" width="${w}" height="${H + 48}" viewBox="0 0 ${w} 256" preserveAspectRatio="none"><svg width="${w}" height="256">${svg.replace(/<rect class="og-node" x="0%"[^>]*>(<\/rect>)?/gu, '')}</svg></svg>`;
}

function card(title, description, seed = title) {
  const t = fit(semibold, title, [64, 58, 52, 46, 40], TEXT_W, 3);
  const titleTop = 232;
  const titleSvg = outline(semibold, t.lines, t.size, PAD, titleTop, 1.12, TEXT);
  const descTop = titleTop + (t.lines.length - 1) * t.size * 1.12 + 62;
  const d = description ? fit(regular, description, [28, 26, 24], TEXT_W, 3) : null;
  const descSvg = d ? outline(regular, d.lines, d.size, PAD, descTop, 1.35, MUTED) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="shade" x1="0" x2="1"><stop offset="0" stop-color="${BG}" stop-opacity=".94"/><stop offset=".5" stop-color="${BG}" stop-opacity=".7"/><stop offset="1" stop-color="${BG}" stop-opacity=".05"/></linearGradient><linearGradient id="bar" x1="0" x2="1"><stop offset="0" stop-color="${VIOLET}"/><stop offset="1" stop-color="${TINT}"/></linearGradient><linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="470" x2="760"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient><mask id="in"><rect width="${W}" height="${H}" fill="url(#fade)"/></mask></defs>
<rect width="${W}" height="${H}" fill="${BG}"/><g mask="url(#in)">${flows(seed)}</g><rect width="${W}" height="${H}" fill="url(#shade)"/><rect y="${H - 8}" width="${W}" height="8" fill="url(#bar)"/>
<svg x="${PAD}" y="64" height="56" width="${(56 * Number(logoBox.split(' ')[2])) / Number(logoBox.split(' ')[3])}" viewBox="${logoBox}">${logoInner}</svg>
${titleSvg}${descSvg}
<path fill="${MUTED}" d="${regular.getPath('clx.cx', W - PAD - regular.getAdvanceWidth('clx.cx', 26), 102, 26).toPathData(1)}"/>
</svg>`;
}

/** The card's SVG for a title and a description, as the script draws it (exported for the tests). */
export const cardSvg = card;
export { regular, semibold, TEXT_W };

async function main() {
  // From an empty folder: a card of a page or language since removed must not linger and be deployed.
  fs.rmSync(path.join(OUT, 'og'), { recursive: true, force: true });
  // The Russian host's pages too, when it has its own (ADR 0030): their cards stay on clx.cx.
  const { RU_ORIGIN } = await import('../site/urls.ts');
  const dirs = [OUT, ...(RU_ORIGIN ? [process.env.CLX_RU_OUT || 'dist-ru'] : [])];
  const pages = dirs.flatMap((dir) =>
    fs
      .readdirSync(dir, { recursive: true })
      .map((f) => path.join(dir, String(f)))
      .filter((f) => f.endsWith('.html')),
  );
  let made = 0;
  for (const f of pages) {
    const html = fs.readFileSync(f, 'utf8');
    const image = html.match(/<meta property="og:image" content="https:\/\/[^/]+(\/og\/[^"]+\.png)"/u)?.[1];
    if (!image) continue;
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/u)?.[1]?.replace(/<[^>]+>/gu, '').trim();
    if (!h1) throw new Error(`${f} has og:image but no <h1>`);
    const description = html.match(/<meta name="description" content="([^"]*)"/u)?.[1];
    const file = path.join(OUT, image.slice(1));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await sharp(Buffer.from(card(decode(h1), description ? decode(description) : null, image)))
      .png({ compressionLevel: 9 })
      .toFile(file);
    made++;
  }
  console.log(`og: ${made} cards`);
}

// Run as a script (scripts/build-ui.mjs); imported by the tests, it only lends its functions.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
