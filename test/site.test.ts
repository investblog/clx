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
    expect(robots).toContain('Content-Signal: search=yes, ai-input=yes, ai-train=yes\n');
  });

  it('/api lists every operation of docs/openapi.yaml', () => {
    const api = read('api.html');
    const yaml = fs.readFileSync('docs/openapi.yaml', 'utf8').split(/\r?\n/u);
    let route = '';
    let n = 0;
    for (const line of yaml.slice(yaml.indexOf('paths:') + 1)) {
      const p = line.match(/^ {2}(\/\S+):$/u);
      const m = line.match(/^ {4}(get|post|put|patch|delete):/u);
      if (p) route = p[1]!;
      else if (m) {
        n++;
        expect(api).toContain(`<code>${m[1]!.toUpperCase()} ${route}</code>`);
      }
    }
    expect(n).toBeGreaterThan(20);
    expect(JSON.parse(read('openapi.json')).paths['/v1/sites']).toBeDefined();
  });

  it('the files for agents: markdown copies, the catalog, the skill and its index', () => {
    expect(read('agents.md')).toMatch(/^# clx for AI agents\n/u);
    expect(read('api.md')).toContain('### `POST /v1/sites`');
    expect(read('index.md')).toBe(read('llms.txt'));
    expect(read('auth.md')).toMatch(/^# clx auth\.md\n/u);
    expect(read('.well-known/auth.md')).toBe(read('auth.md'));
    const catalog = JSON.parse(read('.well-known/api-catalog'));
    expect(catalog.linkset[0].anchor).toBe('https://clx.cx/v1');
    expect(catalog.linkset[0]['service-desc'][0].href).toBe('https://clx.cx/openapi.json');
    const [skill] = JSON.parse(read('.well-known/agent-skills/index.json')).skills;
    expect(skill.name).toBe('clx-sites');
    expect(read(skill.url.slice(1))).toMatch(/^---\nname: clx-sites\ndescription: .+\n---\n/u);
  });

  it('the Russian footer links the English-only agent docs in English', () => {
    expect(read('ru.html')).toContain('<a href="/agents" hreflang="en">');
    expect(read('agents.html')).not.toContain('hreflang="ru"');
  });
});
