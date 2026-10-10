// The site's addresses and pages (site/, docs/spec.md §16): one table, one URL function, and what
// the generator prints from them.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { SITE_PAGES } from '../site/pages.ts';
import { alternatesFor, fileFor, pathFor, urlFor } from '../site/urls.ts';

describe('addresses', () => {
  it('English at the root, Russian under /ru, no trailing slash on a home page', () => {
    expect(pathFor('/', 'en')).toBe('/');
    expect(pathFor('/', 'ru')).toBe('/ru');
    expect(pathFor('/privacy', 'en')).toBe('/privacy');
    expect(pathFor('/privacy', 'ru')).toBe('/ru/privacy');
    expect(urlFor('/terms', 'ru')).toBe('https://clx.cx/ru/terms');
  });

  it('files match the addresses static assets serve them at', () => {
    expect(fileFor('/', 'en')).toBe('index.html');
    expect(fileFor('/', 'ru')).toBe('ru.html');
    expect(fileFor('/privacy', 'en')).toBe('privacy.html');
    expect(fileFor('/privacy', 'ru')).toBe('ru/privacy.html');
    expect(fileFor('/404', 'ru')).toBe('ru/404.html');
  });

  it('alternates: x-default on English, then every language of the page', () => {
    expect(alternatesFor('/abuse', ['en', 'ru'])).toEqual([
      { hreflang: 'x-default', href: 'https://clx.cx/abuse' },
      { hreflang: 'en', href: 'https://clx.cx/abuse' },
      { hreflang: 'ru', href: 'https://clx.cx/ru/abuse' },
    ]);
  });
});

describe('generated pages', () => {
  const read = (f: string) => fs.readFileSync(`public/${f}`, 'utf8');
  beforeAll(() => {
    execFileSync(process.execPath, ['site/build.ts'], { stdio: 'pipe' });
  });

  it('every page of the table, in its languages, with canonical and hreflang; the 404 is noindex', () => {
    for (const p of SITE_PAGES)
      for (const l of p.locales) {
        const html = read(fileFor(p.slug, l));
        expect(html).toContain(`<html lang="${l}"`);
        if (p.indexed) {
          expect(html).toContain(`<link rel="canonical" href="${urlFor(p.slug, l)}" />`);
          expect(html).toContain(`hreflang="x-default" href="${urlFor(p.slug, 'en')}"`);
          expect(html).not.toContain('noindex');
        } else expect(html).toContain('<meta name="robots" content="noindex" />');
      }
  });

  it('the home page links to the app, the other language and the legal pages of its own language', () => {
    const ru = read('ru.html');
    expect(ru).toContain('href="/app"');
    expect(ru).toContain('href="/" hreflang="en"');
    expect(ru).toContain('href="/ru/privacy"');
    expect(read('index.html')).toContain('href="/ru" hreflang="ru"');
  });

  it('robots.txt keeps crawlers off the app and the API; the sitemap lists indexed pages only', () => {
    const robots = read('robots.txt');
    // `$` ends the rule at /app: a prefix rule would also keep crawlers off /app.css, which the site loads.
    for (const p of ['/app$', '/v1/', '/auth/', '/admin/', '/hook/']) expect(robots).toContain(`Disallow: ${p}\n`);
    const sitemap = read('sitemap.xml');
    expect(sitemap).toContain('<loc>https://clx.cx/ru/terms</loc>');
    expect(sitemap).not.toContain('404');
  });
});
