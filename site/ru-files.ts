// Every file the Russian host serves (ADR 0030), and nothing else: scripts/check-site.mjs refuses a
// build with any other file in it, and scripts/deploy-ru.mjs publishes exactly these — a stray file
// in the folder (a log, a dump) never reaches the public repository.
import { SITE_PAGES, STATIC_FILES } from './pages.ts';
import { fileFor, hostOf } from './urls.ts';

export function ruHostFiles(): string[] {
  const pages = SITE_PAGES.flatMap((p) => p.locales.filter((l) => hostOf(l) === 'ru').map((l) => fileFor(p.slug, l)));
  return [...pages, 'CNAME', '.nojekyll', 'robots.txt', 'sitemap.xml', 'app.css', 'site.js', ...STATIC_FILES.filter((f) => f !== '_headers')];
}
