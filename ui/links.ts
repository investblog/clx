// Pages of stages 5b–5c (docs/spec.md §10): short links — the link host of each account, the list with
// 7-day clicks, adding and editing a link (drawers), and a link's page with its URL, QR code and
// delete. Every action is a /v1 call.
import { ApiError, call, text, type Account, type LinkHost, type Me } from './api';
import { action, badge, cell, confirmAction, notice, pageHead, table, type Live, type Tone } from './accounts';
import { openDrawer } from './dialog';
import { codeBlock, h } from './dom';
import { errorText, num, t, when } from './i18n';
import { paged } from './pager';
import { dropdown, zoneHost } from './pick';

export interface Rule {
  countries?: string[];
  devices?: ('mobile' | 'desktop')[];
  url: string;
}
export interface Link {
  id: string;
  account_id: string;
  code: string;
  short_url: string | null;
  url: string;
  rules: Rule[];
  state: string;
  config: 'pending' | 'synced';
  clicks_7d?: number;
  created_at: string;
}

const HOST_TONE: Record<string, Tone> = { active: 'success', route_conflict: 'danger' };
const usable = (a: Account) => a.state === 'ready' || a.state === 'no_connection';

/** The accounts a link can live in, each with its link host (read one by one: only GET one has it). */
async function accountsWithHosts(): Promise<Account[]> {
  const { accounts } = await call<{ accounts: Account[] }>('GET', '/v1/accounts');
  return Promise.all(accounts.filter(usable).map(async (a) => (await call<{ account: Account }>('GET', `/v1/accounts/${a.id}`)).account));
}

/** Set or replace an account's link host: the DNS record is the user's to make (§13 item 2). */
function hostDrawer(a: Account, done: () => void): void {
  const c = t.links;
  openDrawer(c.hostTitle(a.name ?? a.cf_account_id), (close) => {
    const input = h('input', { class: 'input', id: 'link-host', placeholder: 'go.example.com', autocomplete: 'off', spellcheck: 'false', value: a.link_host?.host ?? '' });
    const zones = zoneHost(input, () => a.id);
    const save = async (key: string) => {
      if (!input.value.trim()) throw new ApiError(400, 'invalid_request', c.needHost);
      await call('PUT', `/v1/accounts/${a.id}/link-host`, { host: input.value.trim() }, key);
      close();
      done();
    };
    return h(
      'div',
      { class: 'stack stack--md' },
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'link-host' }, c.linkHost), zones.el),
      h('p', { class: 'muted text-sm' }, c.hostHint),
      a.link_host ? h('p', { class: 'muted text-sm' }, c.hostMove) : null,
      h(
        'div',
        { class: 'actions' },
        // Replacing a host breaks QR codes printed with the old one: asked first.
        a.link_host ? confirmAction(c.changeHost, { title: c.changeHost, body: c.hostMove, confirmLabel: c.changeHost }, save, 'btn--primary') : action(c.setHost, 'btn--primary', save),
      ),
    );
  });
}

function hostsCard(accounts: Account[], redraw: () => void): HTMLElement {
  const c = t.links;
  return h(
    'section',
    { class: 'stack stack--sm' },
    h('h3', { class: 'h4' }, c.hosts),
    table(
      [[t.sites.colAccount], [c.linkHost], [t.sites.colState, 'medium'], ['']],
      accounts.map((a) => {
        const lh = a.link_host as LinkHost | null | undefined;
        const set = h('button', { type: 'button', class: `btn btn--sm ${lh ? 'btn--ghost' : 'btn--primary'}` }, lh ? c.changeHost : c.setHost);
        set.addEventListener('click', () => hostDrawer(a, redraw));
        return h(
          'tr',
          {},
          cell(a.name ?? a.cf_account_id),
          cell(lh ? h('span', {}, lh.host, lh.error?.code ? h('span', { class: 'action-status' }, ` ${errorText(lh.error.code, lh.error.code)}`) : null) : h('span', { class: 'muted' }, c.noHost)),
          cell(lh ? badge((c.hostState as Record<string, string>)[lh.state] ?? lh.state, HOST_TONE[lh.state]) : '—', 'medium'),
          cell(set),
        );
      }),
    ),
  );
}

/** The rules editor: one row per rule, the first match wins (§6). */
function rulesEditor(initial: Rule[]): { el: HTMLElement; value: () => Rule[] } {
  const c = t.links;
  const list = h('div', { class: 'stack stack--sm' });
  const rows: { countries: HTMLInputElement; device: () => string; url: HTMLInputElement; el: HTMLElement }[] = [];
  const add = (r?: Rule) => {
    const countries = h('input', { class: 'input', placeholder: 'DE, AT', value: r?.countries?.join(', ') ?? '', autocomplete: 'off', spellcheck: 'false', 'aria-label': c.countries });
    const device = dropdown(
      [
        { value: '', label: c.anyDevice },
        { value: 'mobile', label: c.mobile },
        { value: 'desktop', label: c.desktop },
      ],
      { label: c.device, value: r?.devices?.length === 1 ? r.devices[0]! : '' },
    );
    const url = h('input', { class: 'input', placeholder: 'https://…', value: r?.url ?? '', autocomplete: 'off', spellcheck: 'false', 'aria-label': c.target });
    const remove = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, c.removeRule);
    const row = { countries, device: device.value, url, el: h('div', { class: 'rule-row' }, countries, device.el, url, remove) };
    remove.addEventListener('click', () => {
      rows.splice(rows.indexOf(row), 1);
      row.el.remove();
    });
    rows.push(row);
    list.append(row.el);
  };
  initial.forEach(add);
  const more = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, c.addRule);
  more.addEventListener('click', () => add());
  return {
    el: h('div', { class: 'stack stack--sm' }, h('div', { class: 'field-label' }, c.rulesLabel), list, h('div', {}, more)),
    value: () =>
      rows.map((r) => {
        const countries = [...new Set(r.countries.value.toUpperCase().split(/[\s,]+/u).filter(Boolean))];
        return { ...(countries.length ? { countries } : {}), ...(r.device() ? { devices: [r.device() as 'mobile' | 'desktop'] } : {}), url: r.url.value.trim() };
      }),
  };
}

function newLinkDrawer(me: Me, accounts: Account[], go: (hash: string) => void): void {
  const c = t.links;
  openDrawer(c.add, (close) => {
    const account = dropdown(accounts.map((a) => ({ value: a.id, label: `${a.link_host!.host} — ${a.name ?? a.cf_account_id}` })), { id: 'link-account' });
    const code = h('input', { class: 'input', id: 'link-code', placeholder: c.codePlaceholder, autocomplete: 'off', spellcheck: 'false' });
    const url = h('input', { class: 'input', id: 'link-url', required: '', placeholder: 'https://example.com/landing', autocomplete: 'off', spellcheck: 'false' });
    const rules = rulesEditor([]);
    return h(
      'div',
      { class: 'stack stack--md' },
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'link-account' }, c.linkHost), account.el),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'link-code' }, c.code), code, h('p', { class: 'field-hint' }, c.codeHint)),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'link-url' }, c.url), url),
      rules.el,
      h(
        'div',
        { class: 'actions' },
        action(c.create, 'btn--primary', async (key) => {
          if (!url.value.trim()) throw new ApiError(400, 'invalid_request', c.needUrl);
          const r = await call<{ link: Link }>('POST', '/v1/links', { account_id: account.value(), url: url.value.trim(), rules: rules.value(), ...(code.value.trim() ? { code: code.value.trim() } : {}) }, key);
          close();
          go(`#/links/${r.link.id}`);
        }),
      ),
      h('p', { class: 'muted text-sm' }, c.planLimit(me.plan, me.limits.links)),
    );
  });
}

export async function linksPage(me: Me, go: (hash: string) => void, redraw: () => void): Promise<HTMLElement> {
  const c = t.links;
  const [{ links }, accounts] = await Promise.all([call<{ links: Link[] }>('GET', '/v1/links'), accountsWithHosts()]);
  const withHost = accounts.filter((a) => a.link_host);
  const add = h('button', { type: 'button', class: 'btn btn--primary' }, c.add);
  add.addEventListener('click', () => newLinkDrawer(me, withHost, go));
  const empty = !accounts.length ? c.noAccount : !withHost.length ? c.needHostFirst : c.empty;
  return h(
    'div',
    { class: 'stack stack--md' },
    pageHead(t.titles.links, withHost.length ? add : null),
    links.length
      ? paged(
          links.map((l) =>
            h(
              'tr',
              {},
              cell(h('a', { href: `#/links/${l.id}` }, l.short_url ?? l.code)),
              cell(h('span', { class: 'truncate' }, l.url), 'medium'),
              cell(num(l.clicks_7d ?? 0)),
              cell(h('span', {}, l.rules.length ? badge(c.rules(l.rules.length)) : null, l.config === 'pending' ? badge(c.configPending) : null), 'low'),
            ),
          ),
          (rows) => table([[c.colLink], [c.colTarget, 'medium'], [c.colClicks], ['', 'low']], rows),
        )
      : h('div', { class: 'card empty-state' }, h('p', {}, empty)),
    accounts.length ? hostsCard(accounts, redraw) : null,
  );
}

/** Editing what can change: where the link leads and its rules; the code stays (it is printed in QR). */
function editLinkDrawer(l: Link, redraw: () => void): void {
  const c = t.links;
  openDrawer(c.editTitle, (close) => {
    const url = h('input', { class: 'input', id: 'link-url', value: l.url, autocomplete: 'off', spellcheck: 'false' });
    const rules = rulesEditor(l.rules);
    return h(
      'div',
      { class: 'stack stack--md' },
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'link-url' }, c.url), url),
      rules.el,
      h(
        'div',
        { class: 'actions' },
        action(c.save, 'btn--primary', async (key) => {
          await call('PATCH', `/v1/links/${l.id}`, { url: url.value.trim(), rules: rules.value() }, key);
          close();
          redraw();
        }),
      ),
    );
  });
}

/** The QR code: the SVG clx.cx builds, shown and saved as a data: URL (the CSP allows data: images). */
function qrCard(l: Link, svg: string): HTMLElement {
  const c = t.links;
  const src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  return h(
    'section',
    { class: 'card stack stack--sm qr-card' },
    h('h3', { class: 'h4' }, c.qr),
    h('img', { class: 'qr', src, alt: c.qrAlt(l.short_url ?? l.code), width: '200', height: '200' }),
    h('p', { class: 'muted text-sm' }, c.qrHint),
    h('div', { class: 'actions' }, h('a', { class: 'btn btn--ghost btn--sm', href: src, download: `${l.code}.svg` }, c.qrDownload)),
  );
}

export async function linkPage(id: string, live: Live, redraw: (message?: string) => void): Promise<HTMLElement> {
  const c = t.links;
  const { link: l } = await call<{ link: Link }>('GET', `/v1/links/${id}`);
  const svg = l.state === 'deleted' || !l.short_url ? null : await text(`/v1/links/${id}/qr.svg`).catch(() => null);
  if (l.config === 'pending') {
    const poll = () =>
      setTimeout(async () => {
        if (!live()) return;
        const next = await call<{ link: Link }>('GET', `/v1/links/${id}`).catch(() => null);
        if (!live()) return;
        if (next && next.link.config !== 'pending') redraw();
        else poll();
      }, 5000);
    poll();
  }
  const deleted = l.state === 'deleted';
  const edit = h('button', { type: 'button', class: 'btn btn--ghost' }, c.edit);
  edit.addEventListener('click', () => editLinkDrawer(l, redraw));
  return h(
    'div',
    { class: 'stack stack--md' },
    h('p', {}, h('a', { href: '#/links' }, c.back)),
    pageHead(l.short_url ?? l.code, deleted ? badge(c.deletedBadge) : edit, h('a', { class: 'btn btn--ghost', href: `#/links/${l.id}/report` }, c.report)),
    l.config === 'pending' && !deleted ? notice(c.moving, 'loading') : null,
    deleted
      ? notice(c.deleted, 'idle')
      : h(
          'section',
          { class: 'card stack stack--sm' },
          codeBlock(l.short_url ?? '', c.copy),
          h('p', { class: 'muted text-sm' }, c.created(when(l.created_at))),
          h('div', { class: 'field-label' }, c.url),
          h('p', { class: 'truncate' }, l.url),
          l.rules.length ? h('p', { class: 'muted text-sm' }, c.rules(l.rules.length)) : null,
          h(
            'div',
            { class: 'actions' },
            confirmAction(c.remove, { title: c.remove, body: c.removeAsk, confirmLabel: c.removeConfirm }, async (key) => {
              await call('DELETE', `/v1/links/${l.id}`, undefined, key);
              redraw();
            }),
          ),
        ),
    svg ? qrCard(l, svg) : null,
  );
}
