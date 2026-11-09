// Pages of stages 5b–5c (docs/spec.md §10): short links — the link hosts (one per site, ADR 0024), the list with
// 7-day clicks, the link editor (a screen, ADR 0043), and a link's page with its URL, QR code and
// delete. Every action is a /v1 call.
import { ApiError, call, text, type Account, type LinkHost, type Me } from './api';
import type { Site } from './sites';
import { action, badge, cell, confirmAction, notice, pageHead, table, type Live, type Tone } from './accounts';
import { openDrawer } from './dialog';
import { codeBlock, h, hostName, iconButton } from './dom';
import { errorText, num, t, when } from './i18n';
import { BOT_CATEGORIES, type BotCategory } from '../edge/bots';
import { guardLeave, release } from './leave';
import { paged } from './pager';
import { dropdown, zoneHost } from './pick';
import { ruleSteps } from './rule-steps';

export interface Rule {
  countries?: string[];
  devices?: ('mobile' | 'desktop')[];
  bots?: BotCategory[];
  url: string;
}
export interface Link {
  id: string;
  account_id: string;
  link_host_id: string;
  code: string;
  short_url: string | null;
  url: string;
  rules: Rule[];
  state: string;
  config: 'pending' | 'synced';
  clicks_7d?: number;
  created_at: string;
}

const HOST_TONE: Record<string, Tone> = { active: 'success', conflict: 'danger' };
const usable = (a: Account) => a.state === 'ready' || a.state === 'no_connection';

/** A link host for a site — a random 3-character name under its address — or one the user names
 *  (ADR 0024). clx makes it a custom domain of its worker: the user creates no DNS record. */
function hostDrawer(kind: 'site' | 'named', accounts: Account[], sites: Site[], done: () => void): void {
  const c = t.links;
  openDrawer(kind === 'site' ? c.hostForSite : c.hostNamed, (close) => {
    const site = dropdown(
      sites.map((s) => ({ value: s.id, label: s.host })),
      { id: 'link-host-site' },
    );
    const account = dropdown(
      accounts.map((a) => ({ value: a.id, label: a.name ?? a.cf_account_id })),
      { id: 'link-host-account' },
    );
    const input = h('input', { class: 'input', id: 'link-host', placeholder: 'k7q.example.com', autocomplete: 'off', spellcheck: 'false' });
    const zones = zoneHost(input, () => account.value());
    return h(
      'div',
      { class: 'stack stack--md' },
      kind === 'site'
        ? h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'link-host-site' }, c.site), site.el, h('p', { class: 'field-hint' }, c.siteHint))
        : h('div', { class: 'stack stack--sm' }, h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'link-host-account' }, t.sites.colAccount), account.el), h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'link-host' }, c.linkHost), zones.el)),
      h('p', { class: 'muted text-sm' }, c.hostHint),
      h(
        'div',
        { class: 'actions' },
        action(c.addHost, 'btn--primary', async (key) => {
          if (kind === 'named' && !input.value.trim()) throw new ApiError(400, 'invalid_request', c.needHost);
          await call('POST', '/v1/link-hosts', kind === 'site' ? { site_id: site.value() } : { account_id: account.value(), host: input.value.trim() }, key);
          close();
          done();
        }),
      ),
    );
  });
}

function hostsCard(hosts: LinkHost[], accounts: Account[], sites: Site[], redraw: () => void): HTMLElement {
  const c = t.links;
  const name = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? (a.name ?? a.cf_account_id) : '—';
  };
  const forSite = h('button', { type: 'button', class: 'btn btn--primary btn--sm' }, c.hostForSite);
  // A paused account or site (§18) takes no new link host: the API answers 409 paused.
  const open = accounts.filter((a) => !a.paused_at);
  forSite.addEventListener('click', () => hostDrawer('site', open, sites, redraw));
  const named = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, c.hostNamed);
  named.addEventListener('click', () => hostDrawer('named', open, sites, redraw));
  return h(
    'section',
    { class: 'stack stack--sm' },
    h('h3', { class: 'h4' }, c.hosts),
    hosts.length
      ? table(
          [[c.linkHost], [t.sites.colAccount, 'medium'], [t.sites.colState], ['']],
          hosts.map((lh) =>
            h(
              'tr',
              {},
              cell(h('span', {}, hostName(lh.host), lh.error?.code ? h('span', { class: 'action-status' }, ` ${errorText(lh.error.code, lh.error.code)}`) : null)),
              cell(name(lh.account_id), 'medium'),
              cell(badge((c.hostState as Record<string, string>)[lh.state] ?? lh.state, HOST_TONE[lh.state])),
              cell(
                confirmAction(c.removeHost, { title: c.removeHost, body: c.removeHostAsk, confirmLabel: c.removeConfirm }, async (key) => {
                  await call('DELETE', `/v1/link-hosts/${lh.id}`, undefined, key);
                  redraw();
                }, 'btn--ghost btn--sm'),
              ),
            ),
          ),
        )
      : h('p', { class: 'muted' }, c.noHosts),
    h('div', { class: 'actions' }, sites.length && open.length ? forSite : null, open.length ? named : null),
  );
}

/** Who a rule takes: anyone, any bot, bots of one category — or, for a rule the API wrote, the
 *  categories it has, kept as they are (ADR 0041). */
function whoPicker(c: typeof t.links, bots: BotCategory[] | undefined, onChange: () => void): { el: HTMLElement; value: () => BotCategory[] | undefined } {
  const names = t.report.names.bots as Record<string, string>;
  const set = bots ? [...new Set(bots)] : [];
  const custom = set.length > 1 && set.length < BOT_CATEGORIES.length;
  const picked = !set.length ? '' : set.length === BOT_CATEGORIES.length ? 'any' : custom ? 'custom' : set[0]!;
  const who = dropdown(
    [
      { value: '', label: c.anyone },
      { value: 'any', label: c.anyBot },
      ...BOT_CATEGORIES.map((b) => ({ value: b, label: c.bot(names[b] ?? b) })),
      ...(custom ? [{ value: 'custom', label: c.bot(set.map((b) => names[b] ?? b).join(', ')) }] : []),
    ],
    { label: c.who, value: picked, onChange },
  );
  return {
    el: who.el,
    value: () => {
      const v = who.value();
      return !v ? undefined : v === 'any' ? [...BOT_CATEGORIES] : v === 'custom' ? set : [v as BotCategory];
    },
  };
}

const BOTH: Rule['devices'] = ['mobile', 'desktop'];

/** The rules editor: one row per rule, the first match wins (§6). `onChange` hears what no `input`
 *  event carries: a picked option, a rule added, removed or moved. */
function rulesEditor(initial: Rule[], onChange: () => void): { el: HTMLElement; value: () => Rule[] } {
  const c = t.links;
  const list = h('div', { class: 'stack stack--sm rule-list' });
  const rows: { countries: HTMLInputElement; device: () => string; bots: () => BotCategory[] | undefined; url: HTMLInputElement; el: HTMLElement }[] = [];
  const add = (r?: Rule) => {
    const countries = h('input', { class: 'input', placeholder: 'DE, AT', value: r?.countries?.join(', ') ?? '', autocomplete: 'off', spellcheck: 'false', 'aria-label': c.countries });
    // Both devices, as the API may have written them, are kept as they are: shown as "any device"
    // and sent without, a rule with no other condition would no longer save (400).
    const both = !!r?.devices && BOTH!.every((d) => r.devices!.includes(d));
    const device = dropdown(
      [
        { value: '', label: c.anyDevice },
        { value: 'mobile', label: c.mobile },
        { value: 'desktop', label: c.desktop },
        ...(both ? [{ value: 'both', label: c.bothDevices }] : []),
      ],
      { label: c.device, value: both ? 'both' : r?.devices?.length === 1 ? r.devices[0]! : '', onChange },
    );
    const who = whoPicker(c, r?.bots, onChange);
    const url = h('input', { class: 'input rule-row__url', placeholder: 'https://…', value: r?.url ?? '', autocomplete: 'off', spellcheck: 'false', 'aria-label': c.target });
    const remove = iconButton('delete', c.removeRule);
    // The first match wins and a rule without bots takes bots too: a new rule for bots must be
    // movable above the ones already there.
    const up = iconButton('chevron-up', c.moveUp);
    const row = { countries, device: device.value, bots: who.value, url, el: h('div', { class: 'rule-row' }, countries, device.el, who.el, h('span', { class: 'actions rule-row__acts' }, up, remove), url) };
    remove.addEventListener('click', () => {
      rows.splice(rows.indexOf(row), 1);
      row.el.remove();
      onChange();
    });
    up.addEventListener('click', () => {
      const i = rows.indexOf(row);
      if (i < 1) return;
      rows.splice(i - 1, 0, ...rows.splice(i, 1));
      rows[i]!.el.before(row.el);
      onChange();
    });
    rows.push(row);
    list.append(row.el);
  };
  initial.forEach(add);
  const more = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, c.addRule);
  more.addEventListener('click', () => {
    add();
    onChange();
  });
  return {
    el: h('div', { class: 'stack stack--sm' }, h('div', { class: 'field-label' }, c.rulesLabel), list, h('div', {}, more)),
    value: () =>
      rows.map((r) => {
        const countries = [...new Set(r.countries.value.toUpperCase().split(/[\s,]+/u).filter(Boolean))];
        const bots = r.bots();
        const device = r.device();
        const devices = device === 'both' ? BOTH : device ? [device as 'mobile' | 'desktop'] : undefined;
        return { ...(countries.length ? { countries } : {}), ...(devices ? { devices } : {}), ...(bots ? { bots } : {}), url: r.url.value.trim() };
      }),
  };
}

/** A rule's conditions in words, as the editor names them: "DE, AT · phone · bot: Search engines". */
function conditions(r: Rule): string {
  const c = t.links;
  const names = t.report.names.bots as Record<string, string>;
  const device = !r.devices ? null : BOTH!.every((d) => r.devices!.includes(d)) ? c.bothDevices : r.devices[0] === 'mobile' ? c.mobile : c.desktop;
  const bots = !r.bots ? null : BOT_CATEGORIES.every((b) => r.bots!.includes(b)) ? c.anyBot : c.bot(r.bots.map((b) => names[b] ?? b).join(', '));
  return [r.countries?.join(', '), device, bots].filter(Boolean).join(' · ');
}

/** What the link does, in order, from the draft Save sends (301-ui's editor summary: the result,
 *  not the settings): each rule and where it leads, marked when it has no condition yet or a rule
 *  above takes all of it (ui/rule-steps.ts, the API's own check), then everyone else. */
function summary(): { el: HTMLElement; update: (rules: Rule[], url: string) => void } {
  const c = t.links;
  const list = h('ol', { class: 'rule-steps' });
  const to = (url: string) => h('span', { class: 'rule-steps__url' }, url || c.noUrl);
  return {
    el: h('section', { class: 'card stack stack--sm link-editor__summary', 'aria-live': 'polite' }, h('h3', { class: 'h4' }, c.summary), list),
    update: (rules, url) => {
      const steps = ruleSteps(rules);
      list.replaceChildren(
        ...rules.map((r, i) => {
          const s = steps[i]!;
          const mark = s.empty ? c.stepEmpty : s.by !== undefined ? c.stepDead(s.by + 1) : null;
          return h('li', mark ? { class: 'rule-steps__dead' } : {}, h('span', {}, conditions(r) || '—'), ' → ', to(r.url), mark ? h('span', { class: 'rule-steps__mark' }, mark) : null);
        }),
        h('li', {}, h('span', {}, rules.length ? c.otherwise : c.everyone), ' → ', to(url)),
      );
    },
  };
}

/** Hosts a link can go on: working ones (the API says link_host_not_ready otherwise), and not of a
 *  paused account (409 paused, §18). */
const liveHosts = (hosts: LinkHost[], accounts: Account[]) => hosts.filter((lh) => lh.state === 'active' && !accounts.find((a) => a.id === lh.account_id)?.paused_at);

/**
 * The link editor, a screen of its own (ADR 0043, 301-ui's Editor Screen): a new link at
 * #/links/new, a link's address and rules at #/links/<id>/edit (the code stays — it is printed in
 * QR). The summary sits beside the form where there is room. Leaving with unsaved edits asks first
 * (ui/leave.ts); Save leads to the link's page.
 */
export async function linkEditorPage(me: Me, id: string | null, path: string, live: Live, go: (hash: string) => void): Promise<HTMLElement> {
  const c = t.links;
  const back = (href: string, text: string) => h('p', {}, h('a', { href }, text));
  let link: Link | null = null;
  let hosts: LinkHost[] = [];
  if (id) {
    link = (await call<{ link: Link }>('GET', `/v1/links/${id}`)).link;
    if (link.state === 'deleted') return h('div', { class: 'stack stack--md' }, back(`#/links/${id}`, c.back), pageHead(c.editTitle), notice(c.deleted, 'idle'));
  } else {
    const [{ accounts }, { link_hosts }] = await Promise.all([call<{ accounts: Account[] }>('GET', '/v1/accounts'), call<{ link_hosts: LinkHost[] }>('GET', '/v1/link-hosts')]);
    hosts = liveHosts(link_hosts, accounts);
    // A bookmark of #/links/new opens it with nothing to put a link on.
    if (!hosts.length) return h('div', { class: 'stack stack--md' }, back('#/links', c.back), pageHead(t.titles.newLink), h('div', { class: 'card empty-state' }, h('p', {}, accounts.some(usable) ? c.needHostFirst : c.noAccount)));
  }
  const host = link ? null : dropdown(hosts.map((lh) => ({ value: lh.id, label: lh.host })), { id: 'link-account' });
  const code = h('input', { class: 'input', id: 'link-code', placeholder: c.codePlaceholder, autocomplete: 'off', spellcheck: 'false' });
  const url = h('input', { class: 'input', id: 'link-url', required: '', placeholder: 'https://example.com/landing', value: link?.url ?? '', autocomplete: 'off', spellcheck: 'false' });
  const shown = summary();
  const rules = rulesEditor(link?.rules ?? [], () => shown.update(rules.value(), url.value.trim()));
  // What Save sends; the summary and the unsaved-edits check read the same.
  const draft = () => ({ ...(host ? { link_host_id: host.value(), ...(code.value.trim() ? { code: code.value.trim() } : {}) } : {}), url: url.value.trim(), rules: rules.value() });
  const form = h(
    'div',
    { class: 'stack stack--md link-editor__form' },
    host ? h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'link-account' }, c.linkHost), host.el) : null,
    host ? h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'link-code' }, c.code), code, h('p', { class: 'field-hint' }, c.codeHint)) : null,
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'link-url' }, c.url), url),
    rules.el,
  );
  form.addEventListener('input', () => shown.update(rules.value(), url.value.trim()));
  shown.update(rules.value(), url.value.trim());
  const saved = JSON.stringify(draft());
  // Only for the page the router will show: an editor whose loading outlived its route would
  // guard the page shown instead with a draft no one sees.
  if (live()) guardLeave(path, () => JSON.stringify(draft()) !== saved);
  const away = link ? `#/links/${link.id}` : '#/links';
  const save = action(link ? c.save : c.create, 'btn--primary', async (key) => {
    const d = draft();
    if (!d.url) throw new ApiError(400, 'invalid_request', c.needUrl);
    // What is typed while the request runs would not be what was saved: the form waits.
    form.inert = true;
    let done: Link;
    try {
      done = link ? (await call<{ link: Link }>('PATCH', `/v1/links/${link.id}`, d, key)).link : (await call<{ link: Link }>('POST', '/v1/links', d, key)).link;
    } finally {
      form.inert = false;
    }
    // Left meanwhile (the leaving was confirmed): the guard and the address are another page's now.
    if (!live()) return;
    release();
    go(`#/links/${done.id}`);
  });
  return h(
    'div',
    { class: 'stack stack--md' },
    back(away, link ? `← ${link.short_url ?? link.code}` : c.back),
    pageHead(link ? c.editTitle : t.titles.newLink),
    h(
      'div',
      { class: 'link-editor' },
      h(
        'div',
        { class: 'link-editor__grid' },
        form,
        shown.el,
        h('div', { class: 'stack stack--sm link-editor__save' }, h('div', { class: 'actions' }, save, h('a', { class: 'btn btn--ghost', href: away }, t.common.cancel)), link ? null : h('p', { class: 'muted text-sm' }, c.planLimit(t.common.planName(me.plan), me.limits.links))),
      ),
    ),
  );
}

export async function linksPage(redraw: () => void): Promise<HTMLElement> {
  const c = t.links;
  const [{ links }, { accounts: all }, { link_hosts: hosts }, { sites: allSites }] = await Promise.all([
    call<{ links: Link[] }>('GET', '/v1/links'),
    call<{ accounts: Account[] }>('GET', '/v1/accounts'),
    call<{ link_hosts: LinkHost[] }>('GET', '/v1/link-hosts'),
    call<{ sites: Site[] }>('GET', '/v1/sites'),
  ]);
  const accounts = all.filter(usable);
  // A link host is made under a site's own host: an external site (§5) has none in a zone.
  const sites = allSites.filter((s) => s.state !== 'deleted' && s.kind === 'zone' && !s.paused_at && accounts.some((a) => a.id === s.account_id && !a.paused_at));
  const live = liveHosts(hosts, all);
  const add = h('a', { class: 'btn btn--primary', href: '#/links/new' }, c.add);
  const empty = !accounts.length ? c.noAccount : !live.length ? c.needHostFirst : c.empty;
  return h(
    'div',
    { class: 'stack stack--md' },
    pageHead(t.titles.links, live.length ? add : null),
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
    accounts.length ? hostsCard(hosts, accounts, sites, redraw) : null,
  );
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
  const edit = h('a', { class: 'btn btn--ghost', href: `#/links/${l.id}/edit` }, c.edit);
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
