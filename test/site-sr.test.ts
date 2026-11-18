// The Serbian pages (ADR 0047): Latin script and ekavian. Three faults a Serbian translation slips into
// that the other checks pass and only a reader's eye finds (met on the owner's other Serbian sites):
// 1. a Cyrillic letter inside Latin text, down to mixed words; `Intl` with bare `sr` writes Cyrillic too;
// 2. ijekavian and Croatian forms ("cijena" for "cena", "tjedan" for "nedelja") — a translator drifts
//    into them unnoticed;
// 3. "dj" for "đ" (takodje for takođe).
// Every string of the language is checked, and every built Serbian page as served.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { CONTENT_LOCALES, GENERATOR_LOCALES, LOCALES, SITE_PAGES } = await import('../site/pages.ts');
const { fileFor } = await import('../site/urls.ts');
const { LANG_TEXT } = await import('../site/lang/index.ts');
const { STRINGS } = await import('../site/i18n.ts');
const { PRODUCTS } = await import('../site/products.ts');
const { FAQ_TEXT } = await import('../site/faq.ts');
const { GENERATOR } = await import('../site/qr-pages.ts');

function strings(v: unknown, at: string, out: { path: string; text: string }[] = []): { path: string; text: string }[] {
  if (typeof v === 'string') out.push({ path: at, text: v });
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${at}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) strings(x, `${at}.${k}`, out);
  return out;
}

const all = strings(LANG_TEXT.sr, 'sr');

/**
 * Ijekavian and Croatian forms a Serbian ekavian text does not have. Roots, not words, so a case ending
 * cannot hide one; a word start (\b) where the root also sits inside ordinary Serbian words. Without
 * "što" (an ordinary Serbian conjunction) and "sigurn-" (Serbian has it too).
 */
const NOT_SERBIAN = [
  /cijen/i, /vrijem/i, /mjese/i, /mjest/i, /primjer/i, /uvijek/i, /rije[čc]/i, /lijep/i, /dijel/i,
  /\bprije(\b|dlog|vod|laz|nos)/i, /gdje/i, /bijel/i, /\btjed/i, /\btisu[ćc]/i, /\bsustav/i, /\buvjet/i,
  /\bto[čc]n/i, /izvje[šs]/i, /ra[čc]unal/i, /obitelj/i, /povijest/i, /\btko\b/i, /\bkruh/i,
  /zrakoplov/i, /glazb/i, /rijek/i, /rije[šs]/i, /\brje[šs]/i, /svjet/i, /vjerojat/i, /\bvje[čc]/i,
  // Ijekavian forms whose "dj" the đ check lets through as a prefix: odjel, podjela (odel, podela).
  /\bodjel/i, /\bpodjel/i,
];

/** "dj" is right only where a prefix meets a root: od-/pod- (odjednom, podjednako) and a few words. */
const LEGIT_DJ = /^(?:p?odj|nadja[čc]|adjektiv|adjunkt)/i;

describe('the Serbian texts (ADR 0047)', () => {
  it('Serbian stays on the pages about clx and the QR code generator', () => {
    // Easy to drop from the table and lose from production with the next deploy, unlike the texts.
    const pages = ['/', '/analytics', '/short-links', '/for-site-generators', '/pricing', '/faq', '/how-it-works', '/open-source', '/qr-code-generator', '/404'];
    expect(SITE_PAGES.filter((p) => p.locales.includes('sr')).map((p) => p.slug).sort()).toEqual([...pages].sort());
    expect(CONTENT_LOCALES).toContain('sr');
    expect(GENERATOR_LOCALES).toContain('sr');
    expect(LOCALES.sr.htmlLang).toBe('sr-Latn');
  });

  it('the same strings as the source: no row of a table, no question dropped', () => {
    // tsc checks the keys, not the length of a list: a question missing only in Serbian would pass it.
    const shape = (v: unknown) => strings(v, '').map((s) => s.path);
    expect(shape(STRINGS.sr)).toEqual(shape(STRINGS.en));
    for (const k of Object.keys(PRODUCTS) as (keyof typeof PRODUCTS)[]) expect(shape(PRODUCTS[k].sr), k).toEqual(shape(PRODUCTS[k].en));
    expect(shape(FAQ_TEXT.sr)).toEqual(shape(FAQ_TEXT.en));
    // The generator in a language other than English has the shape of the Russian one: its "see also"
    // without the API, which follows as a link to the English page.
    expect(shape(GENERATOR.sr)).toEqual(shape(GENERATOR.ru));
  });

  it('the same numbers as the source, string by string: prices, limits and periods survive the translation', () => {
    // The thousands separator and the decimal mark differ (10,000 / 10.000, $0.30 / $0,30): the numbers
    // are compared as their digits, sorted, so a sentence may put them in another order.
    const numbers = (s: string) => (s.replace(/(\d)[.,   ](?=\d{3}\b)/gu, '$1').replace(/(\d),(?=\d)/gu, '$1.').match(/\d+(?:\.\d+)?/gu) ?? []).sort();
    const pairs = (sr: unknown, src: unknown) => {
      const a = strings(sr, '');
      const b = new Map(strings(src, '').map((s) => [s.path, s.text]));
      return a.filter((s) => numbers(s.text).join(' ') !== numbers(b.get(s.path) ?? '').join(' ')).map((s) => `${s.path}: «${s.text}» vs «${b.get(s.path)}»`);
    };
    const bad = [
      ...pairs(STRINGS.sr, STRINGS.en),
      ...(Object.keys(PRODUCTS) as (keyof typeof PRODUCTS)[]).flatMap((k) => pairs(PRODUCTS[k].sr, PRODUCTS[k].en).map((x) => `${k}${x}`)),
      ...pairs(FAQ_TEXT.sr, FAQ_TEXT.en),
      ...pairs(GENERATOR.sr, GENERATOR.ru),
    ];
    expect(bad).toEqual([]);
  });

  it('not a single Cyrillic letter', () => {
    expect(all.filter((s) => /\p{Script=Cyrillic}/u.test(s.text)).map((s) => `${s.path}: ${s.text}`)).toEqual([]);
  });

  // Not complete by construction: it catches the common forms, not every one; a native reader still reads.
  it('no known ijekavian or Croatian form', () => {
    expect(all.flatMap((s) => NOT_SERBIAN.filter((re) => re.test(s.text)).map((re) => `${s.path}: ${re} in "${s.text}"`))).toEqual([]);
  });

  it('đ, not dj', () => {
    const bad = all.filter((s) => (s.text.match(/\p{L}*dj\p{L}*/giu) ?? []).some((w) => !LEGIT_DJ.test(w)));
    expect(bad.map((s) => `${s.path}: ${s.text}`)).toEqual([]);
  });
});

describe('the built Serbian pages', () => {
  const out = 'temp/site-test-sr';
  beforeAll(() => {
    fs.rmSync(out, { recursive: true, force: true });
    execFileSync(process.execPath, ['site/build.ts'], { stdio: 'pipe', env: { ...process.env, CLX_SITE_OUT: out, CLX_RU_OUT: `${out}-ru` } });
  });
  afterAll(() => {
    for (const d of [out, `${out}-ru`]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('no Cyrillic but the language switch’s own name of Russian; numbers in Latin', () => {
    for (const p of SITE_PAGES.filter((x) => x.locales.includes('sr'))) {
      const html = fs.readFileSync(path.join(out, fileFor(p.slug, 'sr')), 'utf8');
      const text = html.replace(/<div class="lang-dd__menu">[\s\S]*?<\/div>/u, '');
      expect(text.match(/\p{Script=Cyrillic}+/gu), p.slug).toBeNull();
      expect(html, p.slug).toContain('<html lang="sr-Latn"');
    }
  });

  it('titles and descriptions within the lengths the English and Russian pages keep', () => {
    const long: string[] = [];
    for (const p of SITE_PAGES.filter((x) => x.indexed && x.locales.includes('sr'))) {
      const head = fs.readFileSync(path.join(out, fileFor(p.slug, 'sr')), 'utf8').split('</head>')[0]!;
      const title = head.match(/<title>([^<]*)<\/title>/u)![1]!.replaceAll('&#39;', "'").replaceAll('&amp;', '&');
      const description = head.match(/<meta name="description" content="([^"]*)"/u)![1]!.replaceAll('&#39;', "'").replaceAll('&amp;', '&');
      if (title.length > 60) long.push(`${p.slug} title ${title.length}: ${title}`);
      if (description.length < 120 || description.length > 160) long.push(`${p.slug} description ${description.length}: ${description}`);
    }
    expect(long).toEqual([]);
  });

  it('sign-up, sign-in and the app lead to English; no sign-in card on the Serbian home page', () => {
    const home = fs.readFileSync(path.join(out, 'sr.html'), 'utf8');
    expect(home).not.toContain('data-auth');
    expect(home).toContain('href="/#register"');
    expect(home).toContain('href="/#login"');
    expect(home).toContain('href="/app"');
    expect(home).not.toMatch(/href="\/sr\/(app|privacy|terms|agents|api)"/u);
    // The brand leads to the Serbian home page; the legal pages to the English ones, marked as such.
    expect(home).toContain('<p class="brand"><a href="/sr">');
    expect(home).toContain('<a href="/privacy" hreflang="en">Privatnost (na engleskom)</a>');
  });
});
