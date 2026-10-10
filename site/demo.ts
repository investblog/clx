// The site's example charts (ADR 0016): drawn at build time, in Node, by the library the app's report
// uses, so a page carries plain SVG and no script. A static page knows neither its theme nor its width:
// each chart is drawn for both themes (`themed`), the series also for a wide card and a phone, and the
// stylesheet shows one copy. The data is made up and the same every build; its days end the day before.
import Rank from 'affiliate-charts/charts-rank.js';
import Series from 'affiliate-charts/charts-series.js';
import Share from 'affiliate-charts/charts-share.js';
import Spark from 'affiliate-charts/charts-spark.js';
import { LOCALES, type Locale } from './pages.ts';
import { STRINGS } from './i18n.ts';
import { escapeHtml } from './layout.ts';

export type Theme = 'light' | 'dark';
const BRAND = '#4D48ED'; // --violet-700, as in the app (ui/report.ts)
const THEMES: readonly Theme[] = ['dark', 'light'];
/** The series' left gutter (% of its width) keeps the axis labels off the columns: for a wide card
 *  (~1000 px) and a phone (~330 px). */
const SIZES = [['wide', 6], ['narrow', 16]] as const;

/** A chart in both themes; the stylesheet shows the one of the page's theme. */
export const themed = (cls: string, draw: (theme: Theme) => string): string => THEMES.map((t) => `<div class="${cls} themed--${t}">${draw(t)}</div>`).join('');

/** The library's options for a theme, with the language's numbers. */
export function chartOptions(locale: Locale) {
  const nf = new Intl.NumberFormat(LOCALES[locale].htmlLang);
  const num = (v: number) => nf.format(v);
  return { num, o: (theme: Theme) => ({ brand: BRAND, theme, classPrefix: 'cx', format: num }) };
}

/** `dd.mm` of the i-th of `n` days ending the day before the build (UTC). */
export function dayLabel(i: number, n: number): string {
  const today = new Date();
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - n + i));
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Fourteen days of a made-up site: a weekly rhythm, a slow rise, a spike. */
function demoDays(): { views: number; visitors: number; bots: number }[] {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: 14 }, (_, i) => {
    const weekday = (i + 3) % 7;
    const base = 1700 + i * 45 + (weekday >= 5 ? -520 : 0) + (i === 10 ? 1300 : 0);
    const views = Math.round(base + rnd() * 380);
    return { views, visitors: Math.round(views / (2.2 + rnd() * 0.5)), bots: Math.round(170 + rnd() * 120) };
  });
}

/**
 * The example report of example.com: tiles, the series, and two panels under it — sources and
 * devices on the home page, pages and countries on the analytics page.
 */
export function demoReport(locale: Locale, panels: 'sources' | 'pages'): string {
  const s = STRINGS[locale].demo;
  const { num, o } = chartOptions(locale);
  const days = demoDays();
  const sum = (k: 'views' | 'visitors' | 'bots') => days.reduce((a, d) => a + d[k], 0);
  const [views, visitors, bots] = [sum('views'), sum('visitors'), sum('bots')];
  const share = (n: number) => `${num(n)} · ${Math.round((n / views) * 100)}%`;
  const tiles = [
    { label: s.tiles[0], value: num(visitors), trend: days.map((d) => d.visitors) },
    { label: s.tiles[1], value: num(views), trend: days.map((d) => d.views) },
    { label: s.tiles[2], value: (views / visitors).toLocaleString(LOCALES[locale].htmlLang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), trend: days.map((d) => d.views / d.visitors) },
    { label: s.tiles[3], value: `${Math.round((bots / (bots + views)) * 100)}%`, trend: days.map((d) => d.bots / (d.bots + d.views)) },
  ];
  const points = days.map((d, i) => ({ x: dayLabel(i, days.length), values: [d.views, d.visitors], display: [num(d.views), num(d.visitors)] }));
  const rankPanel = (title: string, labels: readonly string[], counts: number[]) =>
    `<div class="demo__panel"><p class="demo__h">${escapeHtml(title)}</p>${themed('demo__chart', (theme) => Rank.rank(counts.map((n, i) => ({ label: labels[i]!, value: n, display: share(n) })), o(theme)))}</div>`;
  const row =
    panels === 'sources'
      ? rankPanel(s.sourcesTitle, s.sources, [4120, 3310, 1290, 760, 540]) +
        `<div class="demo__panel"><p class="demo__h">${escapeHtml(s.devicesTitle)}</p>${themed('demo__chart', (theme) => Share.share([12840, 8930].map((n, i) => ({ label: s.devices[i]!, value: n, display: num(n) })), { ...o(theme), form: 'donut' }))}</div>`
      : rankPanel(s.pagesTitle, s.pages, [6210, 3480, 2150, 1320, 910]) + rankPanel(s.countriesTitle, s.countries, [7340, 4120, 2760, 1980, 1450]);
  const rowClass = panels === 'pages' ? 'demo__row demo__row--even' : 'demo__row';
  return `<figure class="demo" aria-hidden="true">
  <div class="demo__bar"><span class="demo__dots"><i></i><i></i><i></i></span><span class="demo__site">example.com</span><span class="demo__period">${escapeHtml(s.period)}</span></div>
  <div class="demo__tiles">${tiles.map((t) => themed('demo__tile', (theme) => Spark.tile(t, o(theme)))).join('')}</div>
  <div class="demo__series">${SIZES.map(([size, gutter]) => `<div class="demo__size--${size}">${themed('demo__chart', (theme) => Series.series(points, { ...o(theme), names: [s.views, s.visitors], form: 'columns', second: 'tint', gutter }))}</div>`).join('')}</div>
  <div class="${rowClass}">${row}</div>
</figure>
<p class="demo__note">${escapeHtml(s.note)}</p>`;
}
