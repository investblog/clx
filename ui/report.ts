// The site report (stage 4e-3, docs/spec.md §7, §10): totals, the chart and the breakdowns of
// GET /v1/sites/{id}/report. Everything is "as of" the last hour the worker sent (ADR 0004).
import { call } from './api';
import { h, s } from './dom';
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

function statCard(title: string, value: string, hint?: string): HTMLElement {
  return h('div', { class: 'stat-card' }, h('span', { class: 'stat-card__label' }, title), h('span', { class: 'stat-card__value' }, value), hint ? h('span', { class: 'text-subtle text-sm' }, hint) : null);
}

/** The words of a site's report, or of a link's: a link's view is a click. */
type Words = { views: string; ofViews: string; empty: string };

function chart(r: Report, w: Words): HTMLElement {
  const hourly = r.period === 'today';
  const n = r.series.length;
  if (!n) return h('div', { class: 'card chart-card' }, h('p', { class: 'muted' }, w.empty));
  const max = Math.max(1, ...r.series.map((p) => Math.max(p.views, p.visitors ?? 0)));
  const W = n * 10;
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} 100`, preserveAspectRatio: 'none', role: 'img', 'aria-label': hourly ? t.report.byHour(w.views) : t.report.byDayAria(w.views) });
  for (const y of [25, 50, 75]) svg.append(s('line', { x1: 0, x2: W, y1: y, y2: y }));
  const at = (i: number) => (hourly ? hourLabel(r.series[i]!.at) : dayLabel(r.series[i]!.at));
  r.series.forEach((p, i) => {
    const hgt = (p.views / max) * 96;
    const tip = t.report.tip(at(i), num(p.views), w.ofViews, p.visitors !== undefined ? num(p.visitors) : null, num(p.bots));
    svg.append(s('rect', { x: i * 10 + 1.5, width: 7, y: 100 - hgt, height: Math.max(hgt, 0) }, s('title', {}, document.createTextNode(tip))));
  });
  if (!hourly) svg.append(s('polyline', { points: r.series.map((p, i) => `${i * 10 + 5},${100 - ((p.visitors ?? 0) / max) * 96}`).join(' ') }));
  const axis = h('div', { class: 'chart-axis' }, h('span', {}, at(0)), n > 2 ? h('span', {}, at(Math.floor((n - 1) / 2))) : null, n > 1 ? h('span', {}, at(n - 1)) : null);
  return h(
    'div',
    { class: 'card chart-card' },
    h('div', { class: 'legend' }, h('span', { class: 'l-views' }, hourly ? t.report.byHour(w.views) : w.views), hourly ? null : h('span', { class: 'l-visitors' }, t.report.visitors), h('span', { class: 'muted' }, t.report.max(num(max)))),
    svg,
    axis,
  );
}

function breakdown(dim: Dim, rows: Top, total: number): HTMLElement {
  const top = Math.max(1, ...rows.map((r) => r.n));
  const list = h(
    'ol',
    {},
    ...rows.map((r) => {
      const bar = h('span', { class: 'bar' });
      bar.style.width = `${(r.n / top) * 100}%`; // CSSOM: allowed under the CSP, unlike style=""
      const text = label(dim, r.key);
      return h('li', { title: text }, bar, h('span', { class: 'k' }, text), h('span', { class: 'v' }, `${num(r.n)} · ${pct(r.n, total)}`));
    }),
  );
  return h('section', { class: 'card breakdown' }, h('h3', {}, t.report.dims[dim]), rows.length ? list : h('p', { class: 'empty' }, t.report.noData));
}

/** The report of a site or of a link: the same shape; a link has no pages and its today is live. */
export async function reportPage(kind: 'sites' | 'links', id: string, period: string): Promise<HTMLElement> {
  const R = t.report;
  const p = (PERIODS as string[]).includes(period) ? period : 'today';
  const [subject, { report: r }] = await Promise.all([
    kind === 'sites' ? call<{ site: Site }>('GET', `/v1/sites/${id}`).then(({ site }) => site.host) : call<{ link: Link }>('GET', `/v1/links/${id}`).then(({ link }) => link.short_url ?? link.code),
    call<{ report: Report }>('GET', `/v1/${kind}/${id}/report?period=${p}&breakdowns=1`),
  ]);
  const totals = r.totals;
  const span = R.utc(r.period === 'today' ? r.to : `${r.from} — ${r.to}`);
  const b = r.breakdowns;
  const dims: Dim[] = [...(kind === 'sites' ? (['pages'] as Dim[]) : []), 'sources', 'countries', 'devices', 'browsers', 'os'];
  const w = kind === 'links' ? R.link : R.site;
  const why = R.unavailable[r.unavailable ?? 'cloudflare'];
  const asOf = kind === 'links' ? (r.as_of ? R.linkAsOf(when(r.as_of)) : R.linkUnavailable(why)) : r.as_of ? R.siteAsOf(when(r.as_of)) : R.siteNoHours;
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
      statCard(R.visitors, num(totals.visitors), R.visitorsHint),
      statCard(w.views, num(totals.views)),
      statCard(R.perVisitor(w.views), totals.visitors ? (totals.views / totals.visitors).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—'),
      statCard(R.botShare, pct(totals.bots, totals.bots + totals.views), R.botHits(num(totals.bots))),
    ),
    chart(r, w),
    b ? h('div', { class: 'breakdowns' }, ...dims.map((d) => breakdown(d, b[d], totals.views)), breakdown('bots', b.bots, totals.bots)) : h('div', { class: 'card' }, h('p', {}, why)),
  );
}
