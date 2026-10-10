// The frame of a site page: <head> with canonical and hreflang, the header (brand, language,
// theme, sign-in), the footer. No inline script or style (the CSP allows neither): the theme is set
// by /theme.js before the first paint and switched by /site.js.
import { LOCALES, REPO, footPages, navPages, type Locale, type PageDef } from './pages.ts';
import { STRINGS } from './i18n.ts';
import { alternatesFor, appPathFor, pathFor, urlFor } from './urls.ts';

export function escapeHtml(v: string): string {
  return v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export interface LayoutInput {
  page: PageDef;
  locale: Locale;
  title: string;
  description?: string;
  /** Markup inside <main>. */
  body: string;
}

const icon = (name: string, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="/icons.svg#i-mono-${name}"></use></svg>`;

/** Links to the page in its other languages — from the same list as the `<link rel="alternate">`. */
function langSwitch(page: PageDef, locale: Locale): string {
  if (!page.indexed || page.locales.length < 2) return '';
  const items = page.locales
    .filter((l) => l !== locale)
    .map((l) => `<a class="lang-switch" href="${pathFor(page.slug, l)}" hreflang="${LOCALES[l].htmlLang}" lang="${LOCALES[l].htmlLang}">${escapeHtml(LOCALES[l].label)}</a>`);
  return items.join('');
}

/** The menu: the table's `nav` pages, printed in the page, beside the brand. On a phone it folds behind
 *  the menu button — last in the header, where it shows — only once /theme.js has marked the page `js`
 *  (that file also opens it and moves focus into it); without scripts it stays a row of links. */
function nav(page: PageDef, locale: Locale): { menu: string; button: string } {
  const s = STRINGS[locale];
  const items = navPages(locale).map((p) => `<a href="${pathFor(p.slug, locale)}"${p.slug === page.slug ? ' aria-current="page"' : ''}>${escapeHtml(s.nav[p.nav!])}</a>`);
  if (!items.length) return { menu: '', button: '' };
  return {
    menu: `<nav class="site-nav" id="site-nav" aria-label="${escapeHtml(s.nav.menu)}">${items.join('')}</nav>`,
    button: `<button type="button" class="btn-close site-nav__toggle" id="site-nav-toggle" aria-controls="site-nav" aria-expanded="false" aria-label="${escapeHtml(s.nav.menu)}">${icon('menu')}</button>`,
  };
}

function header(page: PageDef, locale: Locale): string {
  const s = STRINGS[locale];
  const { menu, button } = nav(page, locale);
  return `<header class="topbar">
  <div class="topbar__inner">
    <p class="brand"><a href="${pathFor('/', locale)}">${icon('clx', 'icon brand__mark')}<span>clx</span></a></p>
    ${menu}
    ${langSwitch(page, locale)}
    <button type="button" class="btn-close" id="theme" aria-label="${escapeHtml(s.theme)}" title="${escapeHtml(s.theme)}">${icon('theme-light-dark')}</button>
    <a class="btn btn--ghost btn--sm" href="${appPathFor(locale)}">${escapeHtml(s.signIn)}</a>
    ${button}
  </div>
</header>`;
}

function footer(locale: Locale): string {
  const s = STRINGS[locale];
  const links = footPages(locale).map((p) =>
    p.locales.includes(locale)
      ? `<a href="${pathFor(p.slug, locale)}">${escapeHtml(s.foot[p.foot!])}</a>`
      : `<a href="${pathFor(p.slug, p.locales[0]!)}" hreflang="${LOCALES[p.locales[0]!].htmlLang}">${escapeHtml(s.foot[p.foot!])}</a>`,
  );
  links.push(`<a href="${REPO}" rel="noopener">${escapeHtml(s.foot.source)}</a>`);
  return `<footer class="site-foot">${links.join(' · ')}</footer>`;
}

export function layout(input: LayoutInput): string {
  const { page, locale, title, description, body } = input;
  const head = [
    '<meta charset="UTF-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `<title>${escapeHtml(title)}</title>`,
    description ? `<meta name="description" content="${escapeHtml(description)}" />` : '',
    page.indexed
      ? [`<link rel="canonical" href="${urlFor(page.slug, locale)}" />`, ...alternatesFor(page.slug, page.locales).map((a) => `<link rel="alternate" hreflang="${a.hreflang}" href="${a.href}" />`)].join('\n    ')
      : '<meta name="robots" content="noindex" />',
    '<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
    '<link rel="stylesheet" href="/app.css" />',
    '<script src="/theme.js"></script>',
    '<script src="/site.js" defer></script>',
  ].filter(Boolean);
  return `<!doctype html>
<html lang="${LOCALES[locale].htmlLang}" data-theme="dark">
  <head>
    ${head.join('\n    ')}
  </head>
  <body>
${header(page, locale)}
<main class="site-main">
${body}
</main>
${footer(locale)}
  </body>
</html>
`;
}
