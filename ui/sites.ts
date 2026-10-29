// Pages of stage 4e-2 (docs/spec.md §10): sites — the list, adding one by its host (a drawer), and a
// site's page with its snippet, excluded paths, route state, rotate and delete. Every action is a
// /v1 call.
import { ApiError, call, type Account, type Me } from './api';
import { action, badge, cell, confirmAction, notice, pageHead, table, type Live, type Tone } from './accounts';
import { openDrawer } from './dialog';
import { codeBlock, h, hostName } from './dom';
import { errorText, num, t, when } from './i18n';
import { paged } from './pager';
import { dropdown, zoneHost } from './pick';
import { releaseSparklines, sparkline } from './report';

export interface Site {
  id: string;
  account_id: string;
  host: string;
  /** external — not on Cloudflare, counted on `collector_host` (§5) */
  kind: 'zone' | 'external';
  collector_host: string | null;
  state: string;
  path: string;
  snippet: { inline: string; script_tag: string } | null;
  excluded_paths: string[];
  config: 'pending' | 'synced';
  retiring: { path: string; until: string }[];
  error: { code?: string; [k: string]: unknown } | null;
  created_at: string;
  /** the list's, with the reports scope: views of the last 7 closed days and whether any was counted */
  views_7d?: number[];
  counted?: boolean;
}

const SITE_TONE: Record<string, Tone> = { active: 'success', route_conflict: 'danger' };
const siteBadge = (s: Site) => badge((t.sites.state as Record<string, string>)[s.state] ?? s.state, SITE_TONE[s.state]);
const paths = (text: string) => [...new Set(text.split(/[\s,]+/u).filter(Boolean))];
const usable = (a: Account) => a.state === 'ready' || a.state === 'no_connection';

/** Adding a site: the account, the host from its zones — or, on Pro, a host off Cloudflare and the
 *  collector host it is counted on (§5) — and the paths not to count. */
function newSiteDrawer(me: Me, accounts: Account[], go: (hash: string) => void): void {
  const c = t.sites;
  openDrawer(c.add, (close) => {
    const account = dropdown(
      accounts.map((a) => ({ value: a.id, label: a.name ?? a.cf_account_id })),
      { id: 'site-account', onChange: () => (zones.refresh(), collectors.refresh(), (collector.value = ''), suggest()) },
    );
    const host = h('input', { class: 'input', id: 'site-host', required: '', placeholder: c.hostPlaceholder, autocomplete: 'off', spellcheck: 'false' });
    const zones = zoneHost(host, account.value);
    const zoneField = h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'site-host' }, c.host), zones.el, h('p', { class: 'field-hint' }, c.hostHint));
    // An external site: its host is in no zone, its collector host is (zoneHost's own check).
    const outside = h('input', { class: 'input', id: 'site-external-host', placeholder: c.externalPlaceholder, autocomplete: 'off', spellcheck: 'false' });
    const collector = h('input', { class: 'input', id: 'site-collector', placeholder: c.hostPlaceholder, autocomplete: 'off', spellcheck: 'false' });
    const collectors = zoneHost(collector, account.value);
    const externalFields = h(
      'div',
      { class: 'stack stack--md', hidden: '' },
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'site-external-host' }, c.externalHost), outside),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'site-collector' }, c.collector), collectors.el, h('p', { class: 'field-hint' }, c.collectorHint)),
    );
    const pro = me.limits.external_sites > 0;
    const external = h('input', { type: 'checkbox', id: 'site-external', ...(pro ? {} : { disabled: '' }) });
    // The collector suggested: the host of an active site of the account, if it has one.
    const suggest = () => {
      if (!external.checked || collector.value) return;
      const id = account.value();
      void call<{ sites: Site[] }>('GET', `/v1/sites?account_id=${encodeURIComponent(id)}`)
        .then((r) => {
          const site = r.sites.find((s) => s.kind === 'zone' && s.state === 'active');
          if (site && account.value() === id && !collector.value) collector.value = site.host;
        })
        .catch(() => undefined);
    };
    external.addEventListener('change', () => {
      zoneField.hidden = external.checked;
      externalFields.hidden = !external.checked;
      suggest();
    });
    const excluded = h('input', { class: 'input', id: 'site-excluded', placeholder: '/admin, /preview', autocomplete: 'off', spellcheck: 'false' });
    return h(
      'div',
      { class: 'stack stack--md' },
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'site-account' }, c.account), account.el),
      h('div', { class: 'field' }, h('label', { class: 'check', for: 'site-external' }, external, ` ${c.external}`), h('p', { class: 'field-hint' }, pro ? c.externalHint : c.externalPro)),
      zoneField,
      externalFields,
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'site-excluded' }, c.excluded), excluded, h('p', { class: 'field-hint' }, c.excludedHint)),
      h(
        'div',
        { class: 'actions' },
        action(c.add, 'btn--primary', async (key) => {
          const name = (external.checked ? outside : host).value.trim();
          if (!name) throw new ApiError(400, 'invalid_request', c.needHost);
          if (external.checked && !collector.value.trim()) throw new ApiError(400, 'invalid_request', c.needCollector);
          const r = await call<{ site: Site }>('POST', '/v1/sites', { account_id: account.value(), host: name, ...(external.checked ? { collector_host: collector.value.trim() } : {}), excluded_paths: paths(excluded.value) }, key);
          close();
          go(`#/sites/${r.site.id}`);
        }),
      ),
      h('p', { class: 'muted text-sm' }, c.planLimit(me.plan, me.limits.sites)),
    );
  });
}

/** Bumped by every sites list as it starts; one that is no longer the latest builds nothing. */
let lists = 0;

export async function sitesPage(me: Me, go: (hash: string) => void): Promise<HTMLElement> {
  const c = t.sites;
  const mine = ++lists;
  releaseSparklines();
  const [{ sites }, { accounts }] = await Promise.all([call<{ sites: Site[] }>('GET', '/v1/sites'), call<{ accounts: Account[] }>('GET', '/v1/accounts')]);
  // A newer list started while this one loaded: the router drops this one, so it draws no sparklines.
  if (mine !== lists) return h('div');
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';
  const ready = accounts.filter(usable);
  const add = h('button', { type: 'button', class: 'btn btn--primary' }, c.add);
  add.addEventListener('click', () => newSiteDrawer(me, ready, go));
  const empty = !accounts.length ? c.noAccount : !ready.length ? c.noReady : c.empty;
  return h(
    'div',
    {},
    pageHead(t.titles.sites, ready.length ? add : null),
    sites.length
      ? paged(
          sites.map((s) => {
            // A site whose counter has counted opens at its report; one still to install, at its snippet.
            const report = `#/sites/${s.id}/report?p=7d`;
            const views = s.views_7d ?? [];
            const total = views.reduce((n, v) => n + v, 0);
            return h(
              'tr',
              {},
              cell(h('a', { href: s.counted ? report : `#/sites/${s.id}` }, hostName(s.host))),
              cell(h('span', {}, siteBadge(s), s.config === 'pending' ? ' ' : '', s.config === 'pending' ? badge(c.configPending) : null)),
              cell(s.counted ? h('a', { class: 'site-trend', href: report }, sparkline(views, c.trendTitle(num(total))), h('span', {}, num(total))) : h('span', { class: 'muted text-sm' }, c.notCounted)),
              cell(name(s.account_id), 'low'),
            );
          }),
          (rows) => table([[c.colHost], [c.colState], [c.colViews], [c.colAccount, 'low']], rows),
        )
      : h('div', { class: 'card empty-state' }, h('p', {}, empty)),
  );
}

// ---- one site ----

function snippetCard(s: Site): HTMLElement {
  const c = t.sites;
  if (!s.snippet) return h('section', { class: 'card' }, h('h3', { class: 'h4' }, c.snippet), h('p', { class: 'muted' }, c.snippetLater));
  const block = (title: string, hint: string, code: string) => h('div', { class: 'stack stack--sm secret-card' }, h('strong', {}, title), h('p', { class: 'muted text-sm' }, hint), codeBlock(code, c.copySnippet));
  const how = s.collector_host ? c.snippetHowExternal(s.collector_host) : c.snippetHow;
  return h('section', { class: 'card stack stack--md' }, h('h3', { class: 'h4' }, c.snippet), h('p', {}, how), block(c.inline, c.inlineHint, s.snippet.inline), block(c.file, c.fileHint, s.snippet.script_tag));
}

/** Editing what can change: the paths not to count. */
function editSiteDrawer(s: Site, redraw: () => void): void {
  const c = t.sites;
  openDrawer(s.host, (close) => {
    const excluded = h('input', { class: 'input', id: 'site-excluded', value: s.excluded_paths.join(', '), autocomplete: 'off', spellcheck: 'false' });
    return h(
      'div',
      { class: 'stack stack--md' },
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'site-excluded' }, c.excludedNow), excluded, h('p', { class: 'field-hint' }, c.excludedHint)),
      h(
        'div',
        { class: 'actions' },
        action(c.save, 'btn--primary', async (key) => {
          await call('PATCH', `/v1/sites/${s.id}`, { excluded_paths: paths(excluded.value) }, key);
          close();
          redraw();
        }),
      ),
    );
  });
}

export async function sitePage(id: string, live: Live, redraw: (message?: string) => void): Promise<HTMLElement> {
  const c = t.sites;
  const { site: s } = await call<{ site: Site }>('GET', `/v1/sites/${id}`);
  // A route still being made or config still on its way: look again in a few seconds, redraw on change.
  if (s.state === 'route_pending' || s.config === 'pending') {
    const seen = JSON.stringify(s);
    const poll = () =>
      setTimeout(async () => {
        if (!live()) return;
        const next = await call<{ site: Site }>('GET', `/v1/sites/${id}`).catch(() => null);
        if (!live()) return;
        if (next && JSON.stringify(next.site) !== seen) redraw();
        else poll();
      }, 5000);
    poll();
  }
  const deleted = s.state === 'deleted';
  const edit = h('button', { type: 'button', class: 'btn btn--ghost' }, c.edit);
  edit.addEventListener('click', () => editSiteDrawer(s, redraw));
  return h(
    'div',
    { class: 'stack stack--md' },
    h('p', {}, h('a', { href: '#/sites' }, c.back)),
    pageHead(s.host, siteBadge(s), deleted ? null : edit, deleted ? null : h('a', { class: 'btn btn--ghost', href: `#/sites/${s.id}/report` }, c.report)),
    s.error?.code ? notice(errorText(s.error.code, s.error.code)) : null,
    s.config === 'pending' && !deleted ? notice(c.configMoving, 'loading') : null,
    deleted ? notice(c.deleted, 'idle') : snippetCard(s),
    deleted
      ? null
      : h(
          'section',
          { class: 'card stack stack--sm' },
          h('h3', { class: 'h4' }, c.settings),
          h('p', { class: 'muted text-sm' }, c.path(s.path, when(s.created_at))),
          s.collector_host ? h('p', { class: 'muted text-sm' }, c.collectorAt(s.collector_host)) : null,
          s.excluded_paths.length ? h('p', { class: 'muted text-sm' }, `${c.excludedNow}: ${s.excluded_paths.join(', ')}`) : null,
          s.retiring.length ? h('p', { class: 'muted text-sm' }, c.retiring(s.retiring.map((r) => c.until(r.path, when(r.until))).join(', '))) : null,
          // Rotation needs a working route (the API answers site_not_active otherwise); an external
          // site keeps its path for life (§5).
          s.state === 'active' && s.kind === 'zone' ? h('p', { class: 'muted text-sm' }, c.rotateHint) : null,
          h(
            'div',
            { class: 'actions' },
            s.state === 'active' && s.kind === 'zone'
              ? confirmAction(
                  c.rotate,
                  { title: c.rotate, body: c.rotateAsk, confirmLabel: c.rotateConfirm },
                  async (key) => {
                    await call('POST', `/v1/sites/${s.id}/rotate`, undefined, key);
                    redraw();
                  },
                  'btn--ghost',
                )
              : null,
            confirmAction(c.remove, { title: c.remove, body: c.removeAsk, confirmLabel: c.removeConfirm }, async (key) => {
              await call('DELETE', `/v1/sites/${s.id}`, undefined, key);
              redraw();
            }),
          ),
        ),
  );
}
