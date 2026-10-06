// The site report (stage 4e-3, docs/spec.md §7, §10): totals, the chart and the breakdowns of
// GET /v1/sites/{id}/report. Everything is "as of" the last hour the worker sent (ADR 0004).
import { call } from './api';
import { num, when } from './accounts';
import { h, s } from './dom';
import type { Site } from './sites';

type Top = { key: string; n: number }[];
interface Report {
  period: 'today' | '7d' | '30d';
  from: string;
  to: string;
  as_of: string | null;
  totals: { views: number; bots: number; visitors: number };
  series: { at: string; views: number; bots: number; visitors?: number }[];
  incomplete: boolean;
  breakdowns?: Record<'pages' | 'sources' | 'countries' | 'devices' | 'browsers' | 'os' | 'bots', Top> | null;
  unavailable?: 'not_installed' | 'cloudflare' | 'rate_limited';
}

const PERIODS: [Report['period'], string][] = [
  ['today', 'Сегодня'],
  ['7d', '7 дней'],
  ['30d', '30 дней'],
];
const COUNTRY = (() => {
  try {
    return new Intl.DisplayNames(['ru'], { type: 'region' });
  } catch {
    return null;
  }
})();
const NAMES: Record<string, Record<string, string>> = {
  devices: { mobile: 'Телефон', desktop: 'Компьютер' },
  browsers: { chrome: 'Chrome', safari: 'Safari', firefox: 'Firefox', edge: 'Edge', opera: 'Opera', samsung: 'Samsung Internet', other: 'Другой' },
  os: { windows: 'Windows', android: 'Android', ios: 'iOS', macos: 'macOS', linux: 'Linux', chromeos: 'ChromeOS', other: 'Другая' },
  bots: { search: 'Поисковики', ai_training: 'ИИ-сборщики', monitoring: 'Мониторинг', ad_review: 'Реклама', social_preview: 'Превью соцсетей', headless: 'Автоматические браузеры', other: 'Прочие' },
};
const UNAVAILABLE: Record<string, string> = {
  not_installed: 'Разбивки читаются из базы в вашем аккаунте Cloudflare, а доступа к ней сейчас нет: воркер не установлен или токен отозван.',
  cloudflare: 'Cloudflare не ответил вовремя — разбивки временно недоступны. Обновите страницу через минуту.',
  rate_limited: 'Слишком много запросов разбивок за минуту — подождите немного.',
};

const label = (dim: string, key: string): string => {
  if (key === '(other)') return 'Прочее (сверх лимита детализации)';
  if (dim === 'sources') return key || 'Прямые заходы';
  if (dim === 'pages') return key || '(адрес не передан)';
  if (dim === 'countries') return key ? (COUNTRY?.of(key) ?? key) : 'Неизвестно';
  return NAMES[dim]?.[key] ?? (key || 'Неизвестно');
};
const pct = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)}%` : '—');
const hourLabel = (iso: string) => `${iso.slice(11, 13)}:00`;
const dayLabel = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

function statCard(title: string, value: string, hint?: string): HTMLElement {
  return h('div', { class: 'stat-card' }, h('span', { class: 'stat-card__label' }, title), h('span', { class: 'stat-card__value' }, value), hint ? h('span', { class: 'text-subtle text-sm' }, hint) : null);
}

function chart(r: Report): HTMLElement {
  const hourly = r.period === 'today';
  const n = r.series.length;
  if (!n) return h('div', { class: 'card chart-card' }, h('p', { class: 'muted' }, 'За сегодня ещё нет закрытых часов: первые цифры придут в начале следующего часа.'));
  const max = Math.max(1, ...r.series.map((p) => Math.max(p.views, p.visitors ?? 0)));
  const W = n * 10;
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} 100`, preserveAspectRatio: 'none', role: 'img', 'aria-label': `Просмотры по ${hourly ? 'часам' : 'дням'}` });
  for (const y of [25, 50, 75]) svg.append(s('line', { x1: 0, x2: W, y1: y, y2: y }));
  const at = (i: number) => (hourly ? hourLabel(r.series[i]!.at) : dayLabel(r.series[i]!.at));
  r.series.forEach((p, i) => {
    const hgt = (p.views / max) * 96;
    const tip = `${at(i)}: ${num(p.views)} просмотров${p.visitors !== undefined ? `, ${num(p.visitors)} посетителей` : ''}, ${num(p.bots)} ботов`;
    svg.append(s('rect', { x: i * 10 + 1.5, width: 7, y: 100 - hgt, height: Math.max(hgt, 0) }, s('title', {}, document.createTextNode(tip))));
  });
  if (!hourly) svg.append(s('polyline', { points: r.series.map((p, i) => `${i * 10 + 5},${100 - ((p.visitors ?? 0) / max) * 96}`).join(' ') }));
  const axis = h('div', { class: 'chart-axis' }, h('span', {}, at(0)), n > 2 ? h('span', {}, at(Math.floor((n - 1) / 2))) : null, n > 1 ? h('span', {}, at(n - 1)) : null);
  return h(
    'div',
    { class: 'card chart-card' },
    h('div', { class: 'legend' }, h('span', { class: 'l-views' }, hourly ? 'Просмотры по часам' : 'Просмотры'), hourly ? null : h('span', { class: 'l-visitors' }, 'Посетители'), h('span', { class: 'muted' }, `макс. ${num(max)}`)),
    svg,
    axis,
  );
}

function breakdown(title: string, dim: string, rows: Top, total: number): HTMLElement {
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
  return h('section', { class: 'card breakdown' }, h('h3', {}, title), rows.length ? list : h('p', { class: 'empty' }, 'Нет данных за период'));
}

export async function reportPage(id: string, period: string): Promise<HTMLElement> {
  const p = PERIODS.some(([k]) => k === period) ? period : 'today';
  const [{ site }, { report: r }] = await Promise.all([call<{ site: Site }>('GET', `/v1/sites/${id}`), call<{ report: Report }>('GET', `/v1/sites/${id}/report?period=${p}&breakdowns=1`)]);
  const t = r.totals;
  const span = r.period === 'today' ? `${r.to}, UTC` : `${r.from} — ${r.to}, UTC`;
  const b = r.breakdowns;
  const dims: [keyof NonNullable<Report['breakdowns']>, string][] = [
    ['pages', 'Страницы'],
    ['sources', 'Источники'],
    ['countries', 'Страны'],
    ['devices', 'Устройства'],
    ['browsers', 'Браузеры'],
    ['os', 'Системы'],
  ];
  return h(
    'div',
    { class: 'stack stack--md' },
    h('p', {}, h('a', { href: `#/sites/${site.id}` }, `← ${site.host}`)),
    h(
      'div',
      { class: 'page-head' },
      h('h2', {}, `Отчёт: ${site.host}`),
      h('div', { class: 'btn-chip-group', role: 'group' }, ...PERIODS.map(([k, text]) => h('a', { class: 'btn btn-chip btn-chip--sm', href: `#/sites/${site.id}/report?p=${k}`, 'aria-pressed': String(k === r.period) }, text))),
    ),
    h('p', { class: 'muted text-sm' }, `${span}. ${r.as_of ? `По состоянию на ${when(r.as_of)} — часы приходят с задержкой до часа.` : 'Сегодняшних часов ещё нет.'}`),
    r.incomplete ? h('div', { class: 'banner banner--warning' }, 'Сегодняшние часы неполные: аккаунт превысил дневной бюджет записей на clx.cx. Итоги дня останутся точными.') : null,
    h(
      'div',
      { class: 'stats-grid' },
      statCard('Посетители', num(t.visitors), 'сумма дневных уникальных'),
      statCard('Просмотры', num(t.views)),
      statCard('Просмотров на посетителя', t.visitors ? (t.views / t.visitors).toFixed(1).replace('.', ',') : '—'),
      statCard('Доля ботов', pct(t.bots, t.bots + t.views), `${num(t.bots)} заходов`),
    ),
    chart(r),
    b
      ? h('div', { class: 'breakdowns' }, ...dims.map(([d, title]) => breakdown(title, d, b[d], t.views)), breakdown('Боты', 'bots', b.bots, t.bots))
      : h('div', { class: 'card' }, h('p', {}, UNAVAILABLE[r.unavailable ?? 'cloudflare'])),
  );
}
