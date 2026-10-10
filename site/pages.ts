// The one table of the site: which pages exist, in which languages, and how a language is addressed.
// Everything else derives from it — the generated files, canonical and hreflang, the sitemap, the
// header and footer links, the language switch and the build check (scripts/check-site.mjs). Kept in
// one place on purpose: in catchall.in's sibling projects a page forgotten in one list led readers
// to a 404 or to another language without failing the build.

export const ORIGIN = 'https://clx.cx';
export const REPO = 'https://github.com/investblog/clx';
/** The app (sign-in and the pages of docs/spec.md §10): a hash-routed page, never indexed. */
export const APP_PATH = '/app';

export type Locale = 'en' | 'ru';

export interface LocaleMeta {
  /** `<html lang>` and hreflang. */
  htmlLang: string;
  /** `og:locale`. */
  ogLocale: string;
  /** How the language is named in the switch — in itself. */
  label: string;
}

export const LOCALES: Record<Locale, LocaleMeta> = {
  en: { htmlLang: 'en', ogLocale: 'en_US', label: 'English' },
  ru: { htmlLang: 'ru', ogLocale: 'ru_RU', label: 'Русский' },
};
export const ALL_LOCALES: readonly Locale[] = ['en', 'ru'];

export interface PageDef {
  /** The path without the language prefix and without a trailing slash: "/" or "/privacy". */
  slug: string;
  locales: readonly Locale[];
  /** Key in `Strings.foot`: the page is linked from the footer. */
  foot?: 'privacy' | 'terms' | 'abuse';
  indexed: boolean;
  /** A legal text: its body is `site/legal/<locale><slug>.html`. */
  legal?: boolean;
  priority?: number;
  changefreq?: 'weekly' | 'monthly' | 'yearly';
}

export const SITE_PAGES: readonly PageDef[] = [
  { slug: '/', locales: ALL_LOCALES, indexed: true, priority: 1.0, changefreq: 'weekly' },
  { slug: '/privacy', locales: ALL_LOCALES, foot: 'privacy', legal: true, indexed: true, priority: 0.3, changefreq: 'yearly' },
  { slug: '/terms', locales: ALL_LOCALES, foot: 'terms', legal: true, indexed: true, priority: 0.3, changefreq: 'yearly' },
  { slug: '/abuse', locales: ALL_LOCALES, foot: 'abuse', legal: true, indexed: true, priority: 0.3, changefreq: 'yearly' },
  // Served by Workers Static Assets for any missing path of its language (not_found_handling = 404-page).
  { slug: '/404', locales: ALL_LOCALES, indexed: false },
];

/** Hand-written files in public/ every build needs (the rest is generated). */
export const STATIC_FILES: readonly string[] = ['_headers', 'favicon.svg', 'icons.svg', 'theme.js', 'ui.css', 'app.css'];

export const footPages = (locale: Locale): PageDef[] => SITE_PAGES.filter((p) => p.foot && p.locales.includes(locale));
