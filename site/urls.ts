// The only place that knows how (page, language) becomes an address and a file name; canonical,
// hreflang, the sitemap, links and the build layout all ask here.
//
// Workers Static Assets serve `privacy.html` at `/privacy` (html_handling = "drop-trailing-slash").
// English lives at the root, Russian under `/ru`. A language's home page has no trailing slash
// (`/ru`, not `/ru/`): with drop-trailing-slash `/ru/` answers with a redirect, and a canonical that
// redirects makes a search engine read the page again (catchall.in, measured 03.09).
import { APP_PATH, LOCALES, ORIGIN, type Locale } from './pages.ts';

export const prefixFor = (locale: Locale): string => (locale === 'en' ? '' : `/${locale}`);

/** The path on clx.cx: `/privacy`, `/ru/privacy`, `/`, `/ru`. */
export function pathFor(slug: string, locale: Locale): string {
  const prefix = prefixFor(locale);
  if (slug === '/') return prefix || '/';
  return `${prefix}${slug}`;
}

export const urlFor = (slug: string, locale: Locale): string => `${ORIGIN}${pathFor(slug, locale)}`;

/** The app of a language (ADR 0015): `/app`, `/ru/app` — the language until the person signs in. */
export const appPathFor = (locale: Locale): string => `${prefixFor(locale)}${APP_PATH}`;

/** The file in public/: `index.html`, `ru.html`, `privacy.html`, `ru/privacy.html`. */
export function fileFor(slug: string, locale: Locale): string {
  if (slug === '/') return locale === 'en' ? 'index.html' : `${locale}.html`;
  return `${prefixFor(locale).slice(1)}${locale === 'en' ? '' : '/'}${slug.slice(1)}.html`;
}

export interface Alternate {
  hreflang: string;
  href: string;
}

/**
 * The page's `<link rel="alternate">`: every language it has, plus `x-default` on the English one.
 * The same list makes the language switch, so the switch cannot offer a language the page lacks.
 */
export function alternatesFor(slug: string, locales: readonly Locale[]): Alternate[] {
  const list: Alternate[] = [];
  if (locales.includes('en')) list.push({ hreflang: 'x-default', href: urlFor(slug, 'en') });
  for (const locale of locales) list.push({ hreflang: LOCALES[locale].htmlLang, href: urlFor(slug, locale) });
  return list;
}
