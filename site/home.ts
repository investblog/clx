// The home page (docs/spec.md §16): the hero, an example report, how it works, why clx, the two tools,
// the API, the plans in short, a few questions. The example report is drawn here, at build time, by
// the same library as the app's report (ADR 0016), so the page carries plain SVG and no script; it is
// drawn once per theme and the stylesheet shows the one of the current theme.
import Rank from 'affiliate-charts/charts-rank.js';
import Series from 'affiliate-charts/charts-series.js';
import Share from 'affiliate-charts/charts-share.js';
import Spark from 'affiliate-charts/charts-spark.js';
import { LOCALES, REPO, type Locale } from './pages.ts';
import { STRINGS } from './i18n.ts';
import { escapeHtml } from './layout.ts';
import { appPathFor, pathFor } from './urls.ts';

const BRAND = '#4D48ED'; // --violet-700, as in the app (ui/report.ts)
const THEMES = ['dark', 'light'] as const;
/** The series' left gutter (% of its width) keeps the axis labels off the columns; a static page
 *  cannot measure its width, so the series is drawn for a wide card (~1000 px) and a phone (~330 px)
 *  and the stylesheet shows one. */
const SIZES = [['wide', 6], ['narrow', 16]] as const;

/** Fourteen days of a made-up site: a weekly rhythm, a slow rise, a spike — the same every build. */
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

/** A chart in both themes; the stylesheet shows the one of the page's theme (`.themed`). */
const themed = (cls: string, draw: (theme: 'light' | 'dark') => string) => THEMES.map((t) => `<div class="${cls} themed--${t}">${draw(t)}</div>`).join('');

function demo(locale: Locale): string {
  const s = STRINGS[locale].home.demo;
  const nf = new Intl.NumberFormat(LOCALES[locale].htmlLang);
  const num = (v: number) => nf.format(v);
  const days = demoDays();
  const sum = (k: 'views' | 'visitors' | 'bots') => days.reduce((a, d) => a + d[k], 0);
  // The fourteen days end yesterday (UTC) of the build, so "last 14 days" stays true.
  const today = new Date();
  const date = (i: number) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 14 + i));
    return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const o = (theme: 'light' | 'dark') => ({ brand: BRAND, theme, classPrefix: 'cx', format: num });
  const views = sum('views');
  const visitors = sum('visitors');
  const bots = sum('bots');
  const tiles: { label: string; value: string; trend: number[] }[] = [
    { label: s.tiles[0], value: num(visitors), trend: days.map((d) => d.visitors) },
    { label: s.tiles[1], value: num(views), trend: days.map((d) => d.views) },
    { label: s.tiles[2], value: (views / visitors).toLocaleString(LOCALES[locale].htmlLang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), trend: days.map((d) => d.views / d.visitors) },
    { label: s.tiles[3], value: `${Math.round((bots / (bots + views)) * 100)}%`, trend: days.map((d) => d.bots / (d.bots + d.views)) },
  ];
  const points = days.map((d, i) => ({ x: date(i), values: [d.views, d.visitors], display: [num(d.views), num(d.visitors)] }));
  const sources = [4120, 3310, 1290, 760, 540].map((n, i) => ({ label: s.sources[i]!, value: n, display: `${num(n)} · ${Math.round((n / views) * 100)}%` }));
  const devices = [12840, 8930].map((n, i) => ({ label: s.devices[i]!, value: n, display: num(n) }));
  return `<figure class="demo" aria-hidden="true">
  <div class="demo__bar"><span class="demo__dots"><i></i><i></i><i></i></span><span class="demo__site">example.com</span><span class="demo__period">${escapeHtml(s.period)}</span></div>
  <div class="demo__tiles">${tiles.map((t) => themed('demo__tile', (theme) => Spark.tile(t, o(theme)))).join('')}</div>
  <div class="demo__series">${SIZES.map(([size, gutter]) => `<div class="demo__size--${size}">${themed('demo__chart', (theme) => Series.series(points, { ...o(theme), names: [s.views, s.visitors], form: 'columns', second: 'tint', gutter }))}</div>`).join('')}</div>
  <div class="demo__row">
    <div class="demo__panel"><p class="demo__h">${escapeHtml(s.sourcesTitle)}</p>${themed('demo__chart', (theme) => Rank.rank(sources, o(theme)))}</div>
    <div class="demo__panel"><p class="demo__h">${escapeHtml(s.devicesTitle)}</p>${themed('demo__chart', (theme) => Share.share(devices, { ...o(theme), form: 'donut' }))}</div>
  </div>
</figure>
<p class="demo__note">${escapeHtml(s.note)}</p>`;
}

export function home(locale: Locale): { title: string; description: string; body: string } {
  const s = STRINGS[locale].home;
  const app = appPathFor(locale);
  const start = `<a class="btn btn--primary btn--lg" href="${app}#/signup">${escapeHtml(s.start)}</a>`;
  const card = (h: string, p: string) => `<div class="card feature"><h3>${escapeHtml(h)}</h3><p>${escapeHtml(p)}</p></div>`;
  const body = `<section class="hero hero--home">
  <h1>${escapeHtml(s.h1)}</h1>
  <p class="lead">${escapeHtml(s.lead)}</p>
  <p class="actions">${start}<a class="btn btn--ghost btn--lg" href="${REPO}" rel="noopener">${escapeHtml(s.source)}</a></p>
  <p class="hero__note">${escapeHtml(s.note)}</p>
</section>
<section class="home-demo">
${demo(locale)}
</section>
<section class="home-section">
  <h2>${escapeHtml(s.how.h2)}</h2>
  <ol class="home-steps">${s.how.steps.map(([h, p]) => `<li><h3>${escapeHtml(h)}</h3><p>${escapeHtml(p)}</p></li>`).join('')}</ol>
</section>
<section class="home-section">
  <h2>${escapeHtml(s.tools.h2)}</h2>
  <div class="tools">${s.tools.items.map((t) => `<div class="card tool"><h3>${escapeHtml(t.h)}</h3><p>${escapeHtml(t.p)}</p><ul class="ticks">${t.points.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul></div>`).join('')}</div>
</section>
<section class="home-section">
  <h2>${escapeHtml(s.why.h2)}</h2>
  <div class="features">${s.why.items.map(([h, p]) => card(h, p)).join('')}</div>
</section>
<section class="home-section home-api">
  <div>
    <h2>${escapeHtml(s.api.h2)}</h2>
    <p>${escapeHtml(s.api.p)}</p>
    <p class="actions"><a class="btn btn--ghost" href="${pathFor('/agents', 'en')}" hreflang="en">${escapeHtml(s.api.agents)}</a><a class="btn btn--ghost" href="${pathFor('/api', 'en')}" hreflang="en">${escapeHtml(s.api.reference)}</a></p>
  </div>
  <pre class="code"><code>curl https://clx.cx/v1/sites \\
  -H "Authorization: Bearer clx_…" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{"account_id":"…","host":"example.com"}'

# → 202 { "site": { "snippet": { "inline": "&lt;script&gt;…", "script_tag": "…" }, … } }</code></pre>
</section>
<section class="home-section">
  <h2>${escapeHtml(s.plans.h2)}</h2>
  <div class="plans">${s.plans.items.map((p) => `<div class="card plan"><h3>${escapeHtml(p.name)}</h3><p class="plan__price">${escapeHtml(p.price)}</p><ul class="ticks">${p.points.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul></div>`).join('')}</div>
  <p class="muted">${escapeHtml(s.plans.note)}</p>
</section>
<section class="home-section">
  <h2>${escapeHtml(s.faq.h2)}</h2>
  <div class="faq">${s.faq.items.map(([q, a]) => `<details><summary>${escapeHtml(q)}</summary><p>${escapeHtml(a)}</p></details>`).join('')}</div>
</section>
<section class="home-final">
  <h2>${escapeHtml(s.final)}</h2>
  <p class="actions">${start}</p>
</section>`;
  return { title: s.title, description: s.description, body };
}
