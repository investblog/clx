// The one table of the site: which pages exist, in which languages, and how a language is addressed.
// Everything else derives from it — the generated files, canonical and hreflang, the sitemap, the
// header and footer links, the language switch and the build check (scripts/check-site.mjs). Kept in
// one place on purpose: in catchall.in's sibling projects a page forgotten in one list led readers
// to a 404 or to another language without failing the build.

export const ORIGIN = 'https://clx.cx';
export const REPO = 'https://github.com/investblog/clx';
/** The Telegram bot (docs/spec.md §17): the way in where clx.cx does not open. */
export const BOT_URL = 'https://t.me/clxcxbot';
/** The footer's glyph links here (site/layout.ts): 301.st, the parent service; its Russian site is 301.ru. */
export const COMPANY_URL: Record<PageLocale, string> = { en: 'https://301.st', ru: 'https://301.ru', de: 'https://301.st', es: 'https://301.st', fr: 'https://301.st', 'pt-br': 'https://301.st', tr: 'https://301.st' };
/** The app (sign-in and the pages of docs/spec.md §10): a hash-routed page, never indexed. */
export const APP_PATH = '/app';

/** The site's own languages: every page of clx, the app, the mail and the bot speak them. */
export type Locale = 'en' | 'ru';
/** The languages of the free QR code tools' pages alone (ADR 0046) — the extension's: on clx.cx under
 *  their prefix (`/de/qr-code-generator`); their header, footer and links lead to the English site. */
export type QrOnlyLocale = 'de' | 'es' | 'fr' | 'pt-br' | 'tr';
/** A language a page can be in. */
export type PageLocale = Locale | QrOnlyLocale;
export const isSiteLocale = (l: PageLocale): l is Locale => l === 'en' || l === 'ru';
/** The site's language a page in `l` falls back to for what `l` lacks: English for the QR-only ones. */
export const siteLocaleOf = (l: PageLocale): Locale => (isSiteLocale(l) ? l : 'en');

export interface LocaleMeta {
  /** `<html lang>` and hreflang. */
  htmlLang: string;
  /** `og:locale`. */
  ogLocale: string;
  /** How the language is named in the switch — in itself. */
  label: string;
}

export const LOCALES: Record<PageLocale, LocaleMeta> = {
  en: { htmlLang: 'en', ogLocale: 'en_US', label: 'English' },
  ru: { htmlLang: 'ru', ogLocale: 'ru_RU', label: 'Русский' },
  de: { htmlLang: 'de', ogLocale: 'de_DE', label: 'Deutsch' },
  es: { htmlLang: 'es', ogLocale: 'es_ES', label: 'Español' },
  fr: { htmlLang: 'fr', ogLocale: 'fr_FR', label: 'Français' },
  'pt-br': { htmlLang: 'pt-BR', ogLocale: 'pt_BR', label: 'Português (Brasil)' },
  tr: { htmlLang: 'tr', ogLocale: 'tr_TR', label: 'Türkçe' },
};
export const ALL_LOCALES: readonly Locale[] = ['en', 'ru'];
/** The QR code tools' pages: the site's languages and the extension's others. */
export const QR_LOCALES: readonly PageLocale[] = ['en', 'ru', 'de', 'es', 'fr', 'pt-br', 'tr'];

export interface PageDef {
  /** The path without the language prefix and without a trailing slash: "/" or "/privacy". */
  slug: string;
  locales: readonly PageLocale[];
  /** Key in `Strings.foot`: the page is linked from the footer. */
  foot?: 'how' | 'openSource' | 'qr' | 'agents' | 'api' | 'privacy' | 'terms';
  /** Key in `Strings.nav`: the page is in the header's menu, in the table's order. */
  nav?: 'analytics' | 'links' | 'generators' | 'pricing' | 'faq';
  /** A comparison page (site/compare.ts), linked from the footer of each language under that
   *  language's name. Most have one language: the other service is known in one market. */
  compare?: Partial<Record<Locale, string>>;
  indexed: boolean;
  /** A legal text: its body is `site/legal/<locale><slug>.html`. */
  legal?: boolean;
  /** Also served as markdown: `<slug>.md` (`index.md` for "/"), and to `Accept: text/markdown` at
   *  the page's own address (src/markdown.ts). The English page only. */
  markdown?: boolean;
  priority?: number;
  changefreq?: 'weekly' | 'monthly' | 'yearly';
}

export const SITE_PAGES: readonly PageDef[] = [
  { slug: '/', locales: ALL_LOCALES, indexed: true, priority: 1.0, changefreq: 'weekly', markdown: true },
  // The two tools, who they are for, what they cost, the questions (site/products.ts, site/faq.ts).
  { slug: '/analytics', locales: ALL_LOCALES, nav: 'analytics', indexed: true, priority: 0.9, changefreq: 'monthly' },
  { slug: '/short-links', locales: ALL_LOCALES, nav: 'links', indexed: true, priority: 0.9, changefreq: 'monthly' },
  { slug: '/for-site-generators', locales: ALL_LOCALES, nav: 'generators', indexed: true, priority: 0.8, changefreq: 'monthly' },
  { slug: '/pricing', locales: ALL_LOCALES, nav: 'pricing', indexed: true, priority: 0.8, changefreq: 'monthly' },
  { slug: '/faq', locales: ALL_LOCALES, nav: 'faq', indexed: true, priority: 0.7, changefreq: 'monthly' },
  // clx beside another service, by market; the facts and their sources: docs/comparisons.md.
  { slug: '/bitly-alternative', locales: ['en'], compare: { en: 'clx vs Bitly' }, indexed: true, priority: 0.6, changefreq: 'monthly' },
  { slug: '/plausible-alternative', locales: ['en'], compare: { en: 'clx vs Plausible' }, indexed: true, priority: 0.6, changefreq: 'monthly' },
  { slug: '/clck-alternative', locales: ['ru'], compare: { ru: 'Вместо Кликера' }, indexed: true, priority: 0.6, changefreq: 'monthly' },
  { slug: '/liveinternet-alternative', locales: ['ru'], compare: { ru: 'Вместо LiveInternet' }, indexed: true, priority: 0.6, changefreq: 'monthly' },
  // The parent service: not a rival, in both languages, its banner and links allowed (ADR 0018).
  { slug: '/vs-301', locales: ALL_LOCALES, compare: { en: 'clx and 301.st', ru: 'clx и 301.ru' }, indexed: true, priority: 0.6, changefreq: 'monthly' },
  // How it runs and the code, from the footer (site/products.ts).
  { slug: '/how-it-works', locales: ALL_LOCALES, foot: 'how', indexed: true, priority: 0.7, changefreq: 'monthly' },
  { slug: '/open-source', locales: ALL_LOCALES, foot: 'openSource', indexed: true, priority: 0.6, changefreq: 'monthly' },
  // The free QR code generator and its API on qr.clx.cx (site/qr-pages.ts, ADRs 0044–0046): the
  // generator and the browser extension in the extension's seven languages, the generator in every
  // footer; the API in English, like /api; their privacy policy a legal page of its own, the address
  // the extension's stores show.
  { slug: '/qr-code-generator', locales: QR_LOCALES, foot: 'qr', indexed: true, priority: 0.8, changefreq: 'monthly' },
  { slug: '/qr-code-api', locales: ['en'], indexed: true, priority: 0.6, changefreq: 'monthly' },
  { slug: '/qr-code-extension', locales: QR_LOCALES, indexed: true, priority: 0.6, changefreq: 'monthly' },
  { slug: '/qr-code-privacy', locales: QR_LOCALES, legal: true, indexed: true, priority: 0.3, changefreq: 'yearly' },
  // For agents and integrators; English only — the reader is a program (site/agents.ts, site/api.ts).
  { slug: '/agents', locales: ['en'], foot: 'agents', indexed: true, priority: 0.8, changefreq: 'monthly', markdown: true },
  { slug: '/api', locales: ['en'], foot: 'api', indexed: true, priority: 0.8, changefreq: 'monthly', markdown: true },
  { slug: '/privacy', locales: ALL_LOCALES, foot: 'privacy', legal: true, indexed: true, priority: 0.3, changefreq: 'yearly' },
  { slug: '/terms', locales: ALL_LOCALES, foot: 'terms', legal: true, indexed: true, priority: 0.3, changefreq: 'yearly' },
  { slug: '/abuse', locales: ALL_LOCALES, legal: true, indexed: true, priority: 0.3, changefreq: 'yearly' },
  // Served by Workers Static Assets for any missing path of its language (not_found_handling = 404-page).
  { slug: '/404', locales: ALL_LOCALES, indexed: false },
];

/** Hand-written files in public/ every build needs (the rest is generated). */
export const STATIC_FILES: readonly string[] = ['_headers', 'favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'icons.svg', 'sitemap.xsl', 'theme.js', 'fonts/onest-latin.woff2', 'fonts/onest-latin-ext.woff2', 'fonts/onest-cyrillic.woff2', 'fonts/OFL.txt'];

/** The footer of a language: its own pages, and the English-only ones (the agent docs) in English; a
 *  QR-only language has every footer page, those it lacks in English. */
export const footPages = (locale: PageLocale): PageDef[] => SITE_PAGES.filter((p) => p.foot && (p.locales.includes(locale) || p.locales.length === 1 || !isSiteLocale(locale)));

/** The comparison pages of a language, for its footer: none in a QR-only one. */
export const comparePages = (locale: PageLocale): PageDef[] => (isSiteLocale(locale) ? SITE_PAGES.filter((p) => p.compare?.[locale] && p.locales.includes(locale)) : []);

/** The menu's pages a language has: none in a QR-only one, which has no product page, so the header
 *  shows it the English ones, marked EN (site/layout.ts). */
export const navPages = (locale: PageLocale): PageDef[] => SITE_PAGES.filter((p) => p.nav && p.locales.includes(locale));

/** The markdown file of a page: `index.md`, `agents.md`. */
export const markdownFile = (slug: string): string => (slug === '/' ? 'index.md' : `${slug.slice(1)}.md`);
