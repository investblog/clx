// The site report (stage 4e-3, docs/spec.md §7, §10): totals, the chart and the breakdowns of
// GET /v1/sites/{id}/report. Everything is "as of" the last hour the worker sent (ADR 0004).
import Rank from 'affiliate-charts/charts-rank.js';
import Series from 'affiliate-charts/charts-series.js';
import Share from 'affiliate-charts/charts-share.js';
import Spark from 'affiliate-charts/charts-spark.js';
import { call } from './api';
import { h } from './dom';
import { locale, num, t, when } from './i18n';
import type { Link } from './links';
import type { Site } from './sites';

type Top = { key: string; n: number }[];
type Dim = 'pages' | 'sources' | 'countries' | 'devices' | 'browsers' | 'os' | 'bots';
interface Report {
  period: 'today' | '7d' | '30d';
  from: string;
  to: string;
  as_of: string | null;
  totals: { views: number; bots: number; visitors: number };
  series: { at: string; views: number; bots: number; visitors?: number }[];
  incomplete: boolean;
  breakdowns?: Record<Dim, Top> | null;
  unavailable?: 'not_installed' | 'cloudflare' | 'rate_limited';
}

const PERIODS: Report['period'][] = ['today', '7d', '30d'];
/** Browser and system names are names in every language; only "other" is translated. */
const PROPER: Record<string, string> = { chrome: 'Chrome', safari: 'Safari', firefox: 'Firefox', edge: 'Edge', opera: 'Opera', samsung: 'Samsung Internet', windows: 'Windows', android: 'Android', ios: 'iOS', macos: 'macOS', linux: 'Linux', chromeos: 'ChromeOS' };

const countryNames = new Map<string, Intl.DisplayNames | null>();
function country(code: string): string {
  if (!countryNames.has(locale))
    try {
      countryNames.set(locale, new Intl.DisplayNames([locale], { type: 'region' }));
    } catch {
      countryNames.set(locale, null);
    }
  return countryNames.get(locale)?.of(code) ?? code;
}

const label = (dim: Dim, key: string): string => {
  const r = t.report;
  if (key === '(other)') return r.other;
  if (dim === 'sources') return key || r.direct;
  if (dim === 'pages') return key || r.noPage;
  if (dim === 'countries') return key ? country(key) : r.unknown;
  return (r.names as Record<string, Record<string, string>>)[dim]?.[key] ?? PROPER[key] ?? (key || r.unknown);
};
const pct = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)}%` : '—');
const hourLabel = (iso: string) => `${iso.slice(11, 13)}:00`;
const dayLabel = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/**
 * A chart drawn by affiliate-charts: an SVG string for the current theme, drawn again when it changes.
 * A `sized` chart also gets its container's width (0 before it is on the page) and is drawn again
 * when the width changes.
 */
type Draw = (o: Series.Common, width: number) => string;
const BRAND = '#4D48ED'; // --violet-700; the library fits it to each theme's surface
const theme = (): 'light' | 'dark' => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

/** The charts of the report on screen. The router swaps pages without telling them, so the charts of a
 *  report are let go when the next report is built (`releaseCharts`) and the theme watcher drops any
 *  it finds off the page: at most one report's worth outlives its page. */
type Chart = { el: HTMLElement; paint: () => void; resize: ResizeObserver | null };
const charts = new Set<Chart>();
const release = (c: Chart) => (c.resize?.disconnect(), charts.delete(c));
const releaseCharts = () => charts.forEach(release);
/** Bumped by every report as it starts; a report that is no longer the latest builds nothing. */
let reports = 0;
new MutationObserver(() => charts.forEach((c) => (c.el.isConnected ? c.paint() : release(c)))).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

function drawn(cls: string, draw: Draw, sized = false): HTMLElement {
  const el = h('div', { class: cls });
  let width = 0;
  const paint = () => Series.init(el, draw({ brand: BRAND, theme: theme(), classPrefix: 'cx', format: num }, width));
  paint();
  const resize = sized
    ? new ResizeObserver(([e]) => {
        const w = Math.round(e!.contentRect.width);
        if (w !== width) (width = w), paint();
      })
    : null;
  resize?.observe(el);
  charts.add({ el, paint, resize });
  return el;
}

/** The left margin, in % of the width, that keeps the value axis' labels off the first columns: the
 *  longest label is at most a character longer than the largest value, ~7.5 px a character at 13 px,
 *  plus a gap. */
const gutter = (max: number, width: number) => (width ? Math.min(50, Math.ceil((((num(max).length + 1) * 7.5 + 8) / width) * 100)) : 4);

/** A KPI tile; the hint, when there is one, stays HTML text under it. */
function tile(label: string, value: string, trend: (number | null)[] | undefined, hint?: string): HTMLElement {
  return h('div', { class: 'stat-card' }, drawn('chart-svg', (o) => Spark.tile({ label, value, ...(trend && trend.length > 1 ? { trend } : {}) }, { ...o, title: `${label}: ${value}` })), hint ? h('span', { class: 'text-subtle text-sm' }, hint) : null);
}

/** The words of a site's report, or of a link's: a link's view is a click. */
type Words = { views: string; empty: string };

function chart(r: Report, w: Words): HTMLElement {
  const hourly = r.period === 'today';
  if (!r.series.length) return h('div', { class: 'card chart-card' }, h('p', { class: 'muted' }, w.empty));
  const title = hourly ? t.report.byHour(w.views) : t.report.byDayAria(w.views);
  // Today is hours of views alone (the worker sends no hourly uniques); a day carries both.
  const points = r.series.map((p) => {
    const x = hourly ? hourLabel(p.at) : dayLabel(p.at);
    const vals = hourly ? [p.views] : [p.views, p.visitors ?? null];
    return { x, values: vals, display: vals.map((v) => (v === null ? null : num(v))) };
  });
  const names: [string] | [string, string] = hourly ? [w.views] : [w.views, t.report.visitors];
  // Visitors are a part of views: a tint of the brand, not its opposite hue.
  const max = Math.max(...r.series.map((p) => Math.max(p.views, p.visitors ?? 0)));
  return h(
    'div',
    { class: 'card chart-card' },
    drawn('chart-svg', (o, width) => Series.series(points, { ...o, names, form: hourly ? 'area' : 'columns', title, gutter: gutter(max, width), ...(hourly ? {} : { second: 'tint' as const }) }), true),
  );
}

/** Devices are few and add up to the whole: a donut. Everything else is a ranking in the API's order.
 *  The chart is one image to a screen reader, so its rows go into its description as text. */
function breakdown(dim: Dim, rows: Top, total: number): HTMLElement {
  const title = t.report.dims[dim];
  const parts = rows.map((r) => ({ label: label(dim, r.key), value: r.n, display: `${num(r.n)} · ${pct(r.n, total)}` }));
  const desc = parts.map((p) => `${p.label}: ${p.display}`).join('; ');
  const body = !rows.length
    ? h('p', { class: 'empty' }, t.report.noData)
    : dim === 'devices' && rows.length <= 6
      ? drawn('chart-svg', (o) => Share.share(parts, { ...o, form: 'donut', title, desc }))
      : drawn('chart-svg', (o) => Rank.rank(parts, { ...o, title, desc }));
  return h('section', { class: 'card breakdown' }, h('h3', {}, title), body);
}

/** The report of a site or of a link: the same shape; a link has no pages and its today is live. */
export async function reportPage(kind: 'sites' | 'links', id: string, period: string): Promise<HTMLElement> {
  const mine = ++reports;
  releaseCharts();
  const R = t.report;
  const p = (PERIODS as string[]).includes(period) ? period : 'today';
  const [subject, { report: r }] = await Promise.all([
    kind === 'sites' ? call<{ site: Site }>('GET', `/v1/sites/${id}`).then(({ site }) => site.host) : call<{ link: Link }>('GET', `/v1/links/${id}`).then(({ link }) => link.short_url ?? link.code),
    call<{ report: Report }>('GET', `/v1/${kind}/${id}/report?period=${p}&breakdowns=1`),
  ]);
  // A newer report started while this one loaded: the router drops this one, so it draws no charts.
  if (mine !== reports) return h('div');
  const totals = r.totals;
  const span = R.utc(r.period === 'today' ? r.to : `${r.from} — ${r.to}`);
  const b = r.breakdowns;
  const dims: Dim[] = [...(kind === 'sites' ? (['pages'] as Dim[]) : []), 'sources', 'countries', 'devices', 'browsers', 'os'];
  const w = kind === 'links' ? R.link : R.site;
  const why = R.unavailable[r.unavailable ?? 'cloudflare'];
  const asOf = kind === 'links' ? (r.as_of ? R.linkAsOf(when(r.as_of)) : R.linkUnavailable(why)) : r.as_of ? R.siteAsOf(when(r.as_of)) : R.siteNoHours;
  // Each tile's sparkline is the same figure per point of the series; an hour has no visitors.
  const daily = r.period !== 'today';
  const trend = {
    visitors: daily ? r.series.map((p) => p.visitors ?? null) : undefined,
    views: r.series.map((p) => p.views),
    perVisitor: daily ? r.series.map((p) => (p.visitors ? p.views / p.visitors : null)) : undefined,
    bots: r.series.map((p) => (p.bots + p.views ? p.bots / (p.bots + p.views) : null)),
  };
  return h(
    'div',
    { class: 'stack stack--md' },
    h('p', {}, h('a', { href: `#/${kind}/${id}` }, `← ${subject}`)),
    h(
      'div',
      { class: 'page-head' },
      h('h2', {}, R.title(subject)),
      h('div', { class: 'btn-chip-group', role: 'group' }, ...PERIODS.map((k) => h('a', { class: 'btn btn-chip btn-chip--sm', href: `#/${kind}/${id}/report?p=${k}`, 'aria-pressed': String(k === r.period) }, R.periods[k]))),
    ),
    h('p', { class: 'muted text-sm' }, `${span}. ${asOf}`),
    r.incomplete ? h('div', { class: 'banner banner--warning' }, R.incomplete) : null,
    h(
      'div',
      { class: 'stats-grid' },
      tile(R.visitors, num(totals.visitors), trend.visitors, R.visitorsHint),
      tile(w.views, num(totals.views), trend.views),
      tile(R.perVisitorShort, totals.visitors ? (totals.views / totals.visitors).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—', trend.perVisitor, R.perVisitor(w.views)),
      tile(R.botShare, pct(totals.bots, totals.bots + totals.views), trend.bots, R.botHits(num(totals.bots))),
    ),
    chart(r, w),
    b ? h('div', { class: 'breakdowns' }, ...dims.map((d) => breakdown(d, b[d], totals.views)), breakdown('bots', b.bots, totals.bots)) : h('div', { class: 'card' }, h('p', {}, why)),
  );
}
