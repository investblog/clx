// The only place that knows how (page, language) becomes an address and a file name; canonical,
// hreflang, the sitemap, links and the build layout all ask here.
//
// Workers Static Assets serve `privacy.html` at `/privacy` (html_handling = "drop-trailing-slash").
// English lives at the root, Russian under `/ru`. A language's home page has no trailing slash
// (`/ru`, not `/ru/`): with drop-trailing-slash `/ru/` answers with a redirect, and a canonical that
// redirects makes a search engine read the page again (catchall.in, measured 03.09).
//
// The Russian host (docs/spec.md §16, ADR 0030): when the build is given `CLX_RU_ORIGIN`
// (https://ru.clx.cx), Russian pages live there, without the `/ru` prefix, and a link between the
// two hosts is absolute. The app and the sign-in card stay on clx.cx (`/ru/app`, `/ru#login`): they
// need the API. Without it everything is on clx.cx, as before.
import { APP_PATH, LOCALES, ORIGIN, type Locale } from './pages.ts';

/** Set to 'https://ru.clx.cx' once that host serves the Russian pages (both builds then agree). */
const RU_LIVE: string | null = 'https://ru.clx.cx';
/** The Russian host's origin, or null while Russian lives under clx.cx/ru. `CLX_RU_ORIGIN` sets it
 *  for a build that tries a layout out (the tests): an origin, or `off` for Russian under /ru. */
const RU_ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.CLX_RU_ORIGIN;
export const RU_ORIGIN: string | null = RU_ENV === 'off' ? null : RU_ENV || RU_LIVE;

export type Host = 'main' | 'ru';
/** The host a language's pages are on. */
export const hostOf = (locale: Locale): Host => (locale === 'ru' && RU_ORIGIN ? 'ru' : 'main');
export const originOf = (host: Host): string => (host === 'ru' ? RU_ORIGIN! : ORIGIN);

/** The host of the page being written: links to its own host are paths, to the other — URLs. */
let rendering: Host = 'main';
export const renderingOn = (host: Host): void => void (rendering = host);
export const renderingHost = (): Host => rendering;
const link = (host: Host, path: string): string => (host === rendering ? path : `${originOf(host)}${path}`);

/** The language's prefix on clx.cx: '' for English, `/ru` for Russian. */
const mainPrefix = (locale: Locale): string => (locale === 'en' ? '' : `/${locale}`);
/** The prefix on the language's own host: none on the Russian host. */
export const prefixFor = (locale: Locale): string => (hostOf(locale) === 'ru' ? '' : mainPrefix(locale));

/** The path on the page's own host: `/privacy`, `/ru/privacy`, `/`, `/ru` (or `/privacy`, `/` on ru.clx.cx). */
export function localPathFor(slug: string, locale: Locale): string {
  const prefix = prefixFor(locale);
  if (slug === '/') return prefix || '/';
  return `${prefix}${slug}`;
}

export const urlFor = (slug: string, locale: Locale): string => `${originOf(hostOf(locale))}${localPathFor(slug, locale)}`;

/** A link to the page from the page being written: a path on the same host, else the full URL. */
export const pathFor = (slug: string, locale: Locale): string => link(hostOf(locale), localPathFor(slug, locale));

/** The app of a language (ADR 0015): `/app`, `/ru/app` — the language until the person signs in.
 *  Always on clx.cx. */
export const appPathFor = (locale: Locale): string => link('main', `${mainPrefix(locale)}${APP_PATH}`);

/** A form of the home page's sign-in card (site/auth.ts, ADR 0026): `/#login`, `/ru#register` —
 *  always on clx.cx, where the API is. */
export type AuthTab = 'login' | 'register' | 'recover';
export const authPathFor = (locale: Locale, tab: AuthTab): string => link('main', `${mainPrefix(locale) || '/'}#${tab}`);

/** The file in its host's output: `index.html`, `ru.html`, `privacy.html`, `ru/privacy.html` (or
 *  `index.html`, `privacy.html` in the Russian host's own directory). */
export function fileFor(slug: string, locale: Locale): string {
  const prefix = prefixFor(locale);
  if (slug === '/') return prefix ? `${prefix.slice(1)}.html` : 'index.html';
  return `${prefix ? `${prefix.slice(1)}/` : ''}${slug.slice(1)}.html`;
}

/** The app's file on clx.cx: `app.html`, `ru/app.html`. */
export const appFileFor = (locale: Locale): string => `${mainPrefix(locale) ? `${mainPrefix(locale).slice(1)}/` : ''}${APP_PATH.slice(1)}.html`;

/** The page's Open Graph card (scripts/build-og.mjs draws it): `/og/en/home.png`, `/og/ru/pricing.png`. */
export const ogImagePath = (slug: string, locale: Locale): string => `/og/${locale}/${slug === '/' ? 'home' : slug.slice(1)}.png`;

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
