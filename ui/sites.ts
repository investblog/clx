// Pages of stage 4e-2 (docs/spec.md §10): sites — the list, adding one by its host (a drawer), and a
// site's page with its snippet, excluded paths, route state, rotate and delete. Every action is a
// /v1 call.
import { ApiError, call, type Account, type Me } from './api';
import { action, badge, cell, confirmAction, notice, pageHead, table, type Live, type Tone } from './accounts';
import { openDrawer } from './dialog';
import { codeBlock, h } from './dom';
import { errorText, t, when } from './i18n';
import { paged } from './pager';
import { dropdown, zoneHost } from './pick';

export interface Site {
  id: string;
  account_id: string;
  host: string;
  state: string;
  path: string;
  snippet: { inline: string; script_tag: string } | null;
  excluded_paths: string[];
  config: 'pending' | 'synced';
  retiring: { path: string; until: string }[];
  error: { code?: string; [k: string]: unknown } | null;
  created_at: string;
}

const SITE_TONE: Record<string, Tone> = { active: 'success', route_conflict: 'danger' };
const siteBadge = (s: Site) => badge((t.sites.state as Record<string, string>)[s.state] ?? s.state, SITE_TONE[s.state]);
const paths = (text: string) => [...new Set(text.split(/[\s,]+/u).filter(Boolean))];
const usable = (a: Account) => a.state === 'ready' || a.state === 'no_connection';

/** Adding a site: the account, the host from its zones, the paths not to count. */
function newSiteDrawer(me: Me, accounts: Account[], go: (hash: string) => void): void {
  const c = t.sites;
  openDrawer(c.add, (close) => {
    const account = dropdown(
      accounts.map((a) => ({ value: a.id, label: a.name ?? a.cf_account_id })),
      { id: 'site-account', onChange: () => zones.refresh() },
    );
    const host = h('input', { class: 'input', id: 'site-host', required: '', placeholder: c.hostPlaceholder, autocomplete: 'off', spellcheck: 'false' });
    const zones = zoneHost(host, account.value);
    const excluded = h('input', { class: 'input', id: 'site-excluded', placeholder: '/admin, /preview', autocomplete: 'off', spellcheck: 'false' });
    return h(
      'div',
      { class: 'stack stack--md' },
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'site-account' }, c.account), account.el),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'site-host' }, c.host), zones.el, h('p', { class: 'field-hint' }, c.hostHint)),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'site-excluded' }, c.excluded), excluded, h('p', { class: 'field-hint' }, c.excludedHint)),
      h(
        'div',
        { class: 'actions' },
        action(c.add, 'btn--primary', async (key) => {
          if (!host.value.trim()) throw new ApiError(400, 'invalid_request', c.needHost);
          const r = await call<{ site: Site }>('POST', '/v1/sites', { account_id: account.value(), host: host.value.trim(), excluded_paths: paths(excluded.value) }, key);
          close();
          go(`#/sites/${r.site.id}`);
        }),
      ),
      h('p', { class: 'muted text-sm' }, c.planLimit(me.plan, me.limits.sites)),
    );
  });
}

export async function sitesPage(me: Me, go: (hash: string) => void): Promise<HTMLElement> {
  const c = t.sites;
  const [{ sites }, { accounts }] = await Promise.all([call<{ sites: Site[] }>('GET', '/v1/sites'), call<{ accounts: Account[] }>('GET', '/v1/accounts')]);
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
          sites.map((s) =>
            h(
              'tr',
              {},
              cell(h('a', { href: `#/sites/${s.id}` }, s.host)),
              cell(h('span', {}, siteBadge(s), s.config === 'pending' ? ' ' : '', s.config === 'pending' ? badge(c.configPending) : null)),
              cell(name(s.account_id), 'low'),
            ),
          ),
          (rows) => table([[c.colHost], [c.colState], [c.colAccount, 'low']], rows),
        )
      : h('div', { class: 'card empty-state' }, h('p', {}, empty)),
  );
}

// ---- one site ----

function snippetCard(s: Site): HTMLElement {
  const c = t.sites;
  if (!s.snippet) return h('section', { class: 'card' }, h('h3', { class: 'h4' }, c.snippet), h('p', { class: 'muted' }, c.snippetLater));
  const block = (title: string, hint: string, code: string) => h('div', { class: 'stack stack--sm secret-card' }, h('strong', {}, title), h('p', { class: 'muted text-sm' }, hint), codeBlock(code, c.copySnippet));
  return h('section', { class: 'card stack stack--md' }, h('h3', { class: 'h4' }, c.snippet), h('p', {}, c.snippetHow), block(c.inline, c.inlineHint, s.snippet.inline), block(c.file, c.fileHint, s.snippet.script_tag));
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
          s.excluded_paths.length ? h('p', { class: 'muted text-sm' }, `${c.excludedNow}: ${s.excluded_paths.join(', ')}`) : null,
          s.retiring.length ? h('p', { class: 'muted text-sm' }, c.retiring(s.retiring.map((r) => c.until(r.path, when(r.until))).join(', '))) : null,
          // Rotation needs a working route (the API answers site_not_active otherwise).
          s.state === 'active' ? h('p', { class: 'muted text-sm' }, c.rotateHint) : null,
          h(
            'div',
            { class: 'actions' },
            s.state === 'active'
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
