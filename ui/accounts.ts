// Pages of stage 4e-1 (docs/spec.md §10): connected Cloudflare accounts, connecting one, an
// account's status with its actions, and API keys. Every action is a /v1 call (§15).
import { ApiError, call, SignedOut, type Account, type Key, type Me } from './api';
import { askConfirm, openDrawer, showSecret } from './dialog';
import { copyButton, h } from './dom';
import { errorText, label, num, t, warningText, when } from './i18n';

/** Whether the page that drew this is still the one on screen (a newer route bumps it). */
export type Live = () => boolean;
export type Tone = 'success' | 'warning' | 'danger' | 'neutral';

const CF_TOKENS = 'https://dash.cloudflare.com/?to=/:account/api-tokens';
const accountTokens = (cfId: string) => `https://dash.cloudflare.com/${cfId}/api-tokens`;

const STATE_TONE: Record<string, Tone> = { bootstrap_lost: 'danger', connected: 'warning', ready: 'success', permission_error: 'danger', revoked: 'danger', resource_drift: 'danger', no_connection: 'warning' };
const ADVICE_TONE: Record<string, Tone> = { ok: 'success', upgrade_soon: 'warning', over: 'danger' };

export const badge = (text: string, tone: Tone = 'neutral') => h('span', { class: `badge badge--${tone}` }, text);
const stateBadge = (s: string) => badge(label.accountState(s), STATE_TONE[s]);
const adviceBadge = (level: string) => badge(label.adviceLevel(level), ADVICE_TONE[level]);
export const notice = (text: string, tone: 'error' | 'success' | 'loading' | 'idle' = 'error') => h('div', { class: 'auth-status', 'data-type': tone, role: 'status' }, text);
export function failure(e: unknown): string {
  if (e instanceof ApiError) return errorText(e.code, e.message);
  // The session ended mid-action: the router finds that out again and shows the sign-in form.
  if (e instanceof SignedOut) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return t.common.sessionEnded;
  }
  return t.common.network;
}
/** A value the reader copies into another site, with its own copy button. */
function copyable(text: string): HTMLElement {
  return h('span', { class: 'copyable' }, h('code', {}, text), copyButton(text, t.common.copy));
}
export const rows = (pairs: [string, Node | string][]) => h('dl', { class: 'kv' }, ...pairs.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
/** A table in its scrolling frame; a column with a priority hides on a narrow table (app.css). */
export function table(head: [string, ('low' | 'medium')?][], body: HTMLElement[]): HTMLElement {
  const th = head.map(([text, p]) => h('th', p ? { 'data-priority': p } : {}, text));
  return h('div', { class: 'card table-scroll' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, ...th)), h('tbody', {}, ...body)));
}
export const cell = (content: Node | string | null, priority?: 'low' | 'medium') => h('td', priority ? { 'data-priority': priority } : {}, content);
export const pageHead = (title: string, ...right: (Node | null)[]) => h('div', { class: 'page-head' }, h('h2', {}, title), ...right);

/**
 * The Idempotency-Key of one user action: kept while its call has no final answer — the network
 * failed or the answer was lost, the same call is still running (`operation_in_progress`), or a
 * `429`/`5xx` the server does not keep (src/v1/idempotency.ts) — so clicking again repeats the
 * same request; dropped once the server has answered for good, so the next click is a new request.
 */
function once(): { key: () => string; answered: (e?: unknown) => void } {
  let key: string | null = null;
  return {
    key: () => (key ??= crypto.randomUUID()),
    answered: (e) => {
      const pending = e !== undefined && (!(e instanceof ApiError) || e.code === 'operation_in_progress' || e.status === 429 || e.status >= 500);
      if (!pending) key = null;
    },
  };
}

/** A button that runs `work`, shows its error next to it and stays disabled while it runs. */
export function action(text: string, cls: string, work: (key: string) => Promise<void>): HTMLElement {
  const out = h('span', { class: 'action-status', role: 'status' });
  const button = h('button', { type: 'button', class: `btn ${cls}` }, text);
  const idem = once();
  button.addEventListener('click', async () => {
    button.disabled = true;
    out.textContent = '';
    try {
      await work(idem.key());
      idem.answered();
    } catch (e) {
      idem.answered(e);
      out.textContent = failure(e);
    } finally {
      button.disabled = false;
    }
  });
  return h('span', { class: 'action' }, button, out);
}

/** A destructive action: asks in a dialog first; Cancel does nothing. */
export function confirmAction(text: string, ask: { title: string; body: string; confirmLabel: string }, work: (key: string) => Promise<void>, cls = 'btn--danger'): HTMLElement {
  return action(text, cls, async (key) => {
    if (await askConfirm({ ...ask, danger: true })) await work(key);
  });
}

// ---- the list ----

export async function accountsPage(me: Me): Promise<HTMLElement> {
  const { accounts } = await call<{ accounts: Account[] }>('GET', '/v1/accounts');
  const room = me.use.cf_accounts < me.limits.cfAccounts;
  const head = pageHead(t.accounts.title, room ? h('a', { class: 'btn btn--primary', href: '#/connect' }, t.accounts.connect) : h('span', { class: 'muted' }, t.accounts.atLimit(me.use.cf_accounts, me.limits.cfAccounts)));
  if (!accounts.length) return h('div', {}, head, h('div', { class: 'card empty-state' }, h('p', {}, t.accounts.empty), h('p', {}, h('a', { href: '#/connect' }, t.accounts.emptyLink))));
  return h(
    'div',
    {},
    head,
    table(
      [[t.accounts.colName], [t.accounts.colState], [t.account.advice, 'medium'], [t.accounts.colPush, 'low']],
      accounts.map((a) =>
        h(
          'tr',
          {},
          cell(h('a', { href: `#/accounts/${a.id}` }, a.name ?? a.cf_account_id)),
          cell(stateBadge(a.state)),
          cell(a.advice ? adviceBadge(a.advice.level) : '—', 'medium'),
          cell(a.push ? when(a.push.at) : t.accounts.noPush, 'low'),
        ),
      ),
    ),
  );
}

// ---- connecting ----

export function connectPage(go: (hash: string) => void): HTMLElement {
  const c = t.connect;
  const account = h('input', { class: 'input', id: 'cf-account', required: '', pattern: '[0-9a-f]{32}', placeholder: c.accountIdPlaceholder, autocomplete: 'off', spellcheck: 'false' });
  const token = h('input', { class: 'input masked', id: 'cf-bootstrap', required: '', type: 'text', autocomplete: 'off', spellcheck: 'false', 'data-1p-ignore': '', 'data-lpignore': 'true' });
  const status = notice('', 'idle');
  const submit = h('button', { type: 'submit', class: 'btn btn--primary' }, c.submit);
  const form = h(
    'form',
    { class: 'auth-form' },
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'cf-account' }, c.accountId), account, h('p', { class: 'field-hint' }, c.accountIdHint)),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'cf-bootstrap' }, c.token), token),
    status,
    h('div', { class: 'auth-actions' }, submit),
  );
  const idem = once();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    status.dataset.type = 'loading';
    status.textContent = c.checking;
    try {
      const { account: a } = await call<{ account: Account }>('POST', '/v1/accounts', { cf_account_id: account.value.trim().toLowerCase(), bootstrap_token: token.value.trim() }, idem.key());
      idem.answered();
      token.value = '';
      go(`#/accounts/${a.id}`);
    } catch (err) {
      idem.answered(err);
      status.dataset.type = 'error';
      status.textContent = failure(err);
      submit.disabled = false;
    }
  });
  const [open1, openLink, open2] = c.open;
  const [name1, name2] = c.name;
  return h(
    'div',
    { class: 'narrow' },
    h('p', {}, h('a', { href: '#/' }, t.account.back)),
    h('h2', {}, c.title),
    // Step by step, one value per copy button — what goes into Cloudflare's search box and only that
    // (catchall.in's lesson: a whole "A:Read, B:Edit" line pasted into the search finds nothing).
    h(
      'ol',
      { class: 'steps' },
      h('li', {}, open1, h('a', { href: CF_TOKENS, target: '_blank', rel: 'noopener' }, openLink ?? ''), open2),
      h('li', {}, name1, copyable('clx bootstrap'), name2),
      h('li', {}, c.policy, h('ul', { class: 'perms' }, h('li', {}, copyable('Account API Tokens'), c.tokensEdit), h('li', {}, copyable('Account Settings'), c.settingsRead))),
      h('li', {}, c.expiry),
      h('li', {}, c.create),
    ),
    h('div', { class: 'card' }, form),
  );
}

// ---- one account ----

function adviceCard(a: Account): HTMLElement {
  const adv = a.advice;
  const title = (extra?: Node) => h('h3', { class: 'h4' }, `${t.account.advice} `, extra ?? null);
  if (!adv) return h('section', { class: 'card' }, title(), h('p', { class: 'muted' }, t.account.advicePending));
  const mb = (n: number) => (n < 1024 * 1024 ? t.account.underMb : t.account.mb(Math.round(n / 1024 / 1024)));
  return h(
    'section',
    { class: 'card stack stack--sm' },
    title(adviceBadge(adv.level)),
    table(
      [[t.account.colMetric], [t.account.colPeak], [t.account.colLimit, 'low'], [t.account.colForecast, 'medium'], ['']],
      Object.entries(adv.metrics).map(([k, m]) =>
        h(
          'tr',
          {},
          cell(label.metric(k)),
          cell(k === 'size' ? mb(m.busiest.value) : `${num(m.busiest.value)}${m.busiest.day ? ` (${m.busiest.day})` : ''}`),
          cell(k === 'size' ? mb(m.limit) : num(m.limit), 'low'),
          cell(m.forecast ? t.account.forecastAt(m.forecast) : '—', 'medium'),
          cell(adviceBadge(m.level)),
        ),
      ),
    ),
    adv.unavailable?.length ? h('p', { class: 'muted' }, adv.unavailable.includes('analytics') ? t.account.noAnalytics : t.account.noSize) : null,
    adv.suggest === 'shorter_hourly_retention' ? h('p', {}, t.account.shorterRetention) : null,
    h('p', { class: 'muted text-sm' }, t.account.counted(when(adv.at))),
  );
}

function banner(a: Account): HTMLElement | null {
  const adv = a.advice;
  if (!adv || (adv.level !== 'upgrade_soon' && adv.level !== 'over') || !adv.metric) return null;
  const m = adv.metrics[adv.metric]!;
  const what = label.metric(adv.metric);
  const text = adv.level === 'over' ? t.account.over(what) : t.account.soon(what, num(m.busiest.value), num(m.limit), m.forecast);
  return h('div', { class: `banner banner--${adv.level === 'over' ? 'danger' : 'warning'}`, role: 'alert' }, text);
}

function operationCard(a: Account): HTMLElement | null {
  const op = a.operation;
  if (!op) return null;
  const running = op.state === 'running';
  const step = op.step.startsWith('failed') ? t.account.stopped : label.step(op.step);
  const head = h('strong', {}, `${label.operation(op.kind)}: `);
  const updated = h('p', { class: 'muted text-sm' }, t.account.updated(when(op.updated_at)));
  // The worker is up once uploaded; its self-check only confirms that (docs/spec.md §4), so the
  // reader is told not to wait for it. Not for an update: a missing self-check rolls it back.
  if (running && op.kind === 'install' && op.step === 'selfcheck' && a.state === 'ready') {
    const [w1, wLink, w2] = t.account.waitSelfcheck;
    return h('section', { class: 'card card--compact' }, head, t.account.uploaded, h('p', {}, w1, h('a', { href: '#/sites' }, wLink ?? ''), w2), updated);
  }
  return h(
    'section',
    { class: 'card card--compact' },
    head,
    running ? t.account.running(step) : op.state === 'failed' ? t.account.failed(step) : t.account.done,
    op.error ? h('p', { class: 'muted' }, errorText(op.error.code, op.error.message ?? '')) : null,
    updated,
  );
}

export async function accountPage(id: string, live: Live, redraw: () => void): Promise<HTMLElement> {
  const { account: a } = await call<{ account: Account }>('GET', `/v1/accounts/${id}`);
  // While an operation runs the page asks again — every few seconds, every 30 s while it only waits
  // for the worker's self-check (up to 15 minutes) — and redraws only when the account changed, so
  // what the reader is typing (a new bootstrap token) is not wiped.
  const seen = JSON.stringify(a);
  const poll = (ms: number) =>
    setTimeout(async () => {
      if (!live()) return;
      const next = await call<{ account: Account }>('GET', `/v1/accounts/${id}`).catch(() => null);
      if (!live()) return;
      if (next && JSON.stringify(next.account) !== seen) redraw();
      else poll(ms);
    }, ms);
  if (a.operation?.state === 'running' || a.state === 'installing' || a.state === 'pending') poll(a.operation?.step === 'selfcheck' ? 30_000 : 3000);

  const c = t.account;
  const warnings = a.error?.warnings ?? [];
  const errorCode = a.error?.code;
  const disconnectOut = h('div', {});
  const renew = h('input', { class: 'input masked', type: 'text', autocomplete: 'off', spellcheck: 'false', 'data-1p-ignore': '', 'data-lpignore': 'true', placeholder: c.renewPlaceholder, 'aria-label': c.renewPlaceholder });
  const [r1, r2, rLink, r3] = c.revoke;
  return h(
    'div',
    { class: 'stack stack--md' },
    h('p', {}, h('a', { href: '#/' }, c.back)),
    pageHead(a.name ?? a.cf_account_id, stateBadge(a.state)),
    banner(a),
    errorCode ? notice(errorText(errorCode, errorCode)) : null,
    warnings.length ? h('ul', { class: 'warnings' }, ...warnings.map((w) => h('li', {}, warningText(w)))) : null,
    operationCard(a),
    h(
      'section',
      { class: 'card' },
      h('h3', { class: 'h4' }, c.worker),
      rows([
        ['Account ID', a.cf_account_id],
        [c.version, a.edge ? `${a.edge.bundle.slice(0, 12)} — ${a.edge.up_to_date ? c.upToDate : c.newer}` : c.notInstalled],
        [c.schema, a.edge?.schema != null ? String(a.edge.schema) : '—'],
        [c.installed, when(a.edge?.installed_at)],
        [c.token, a.token ? c.tokenUntil(a.token.name, when(a.token.expires_at)) : '—'],
      ]),
    ),
    h(
      'section',
      { class: 'card' },
      h('h3', { class: 'h4' }, c.link),
      a.push
        ? rows([
            [c.lastPush, when(a.push.at)],
            [c.queue, num(a.push.queue)],
            [c.workerError, a.push.error ?? c.none],
            [c.dropped, Object.keys(a.push.dropped).length ? Object.entries(a.push.dropped).map(([k, n]) => `${label.drop(k)}: ${num(n)}`).join(', ') : c.nothing],
          ])
        : h('p', { class: 'muted' }, c.noPush),
    ),
    adviceCard(a),
    h(
      'section',
      { class: 'card stack stack--sm' },
      h('h3', { class: 'h4' }, c.actions),
      h(
        'div',
        { class: 'actions' },
        action(c.reinstall, 'btn--ghost', async (key) => {
          await call('POST', `/v1/accounts/${a.id}/install`, undefined, key);
          redraw();
        }),
      ),
      h(
        'div',
        { class: 'actions' },
        renew,
        action(c.renew, 'btn--ghost', async (key) => {
          if (!renew.value.trim()) throw new ApiError(400, 'invalid_request', c.renewEmpty);
          await call('POST', `/v1/accounts/${a.id}/token`, { bootstrap_token: renew.value.trim() }, key);
          renew.value = '';
          redraw();
        }),
      ),
      h(
        'div',
        { class: 'actions' },
        confirmAction(c.disconnect, { title: c.disconnect, body: c.disconnectAsk, confirmLabel: c.disconnectConfirm }, async (key) => {
          const r = await call<{ revoke_token: string | null; left: string[] }>('DELETE', `/v1/accounts/${a.id}`, undefined, key);
          disconnectOut.replaceChildren(
            notice(r.left.length ? c.disconnectedLeft(r.left) : c.disconnected, r.left.length ? 'error' : 'success'),
            ...(r.revoke_token ? [h('p', {}, r1, h('code', {}, r.revoke_token), r2, h('a', { href: accountTokens(a.cf_account_id), target: '_blank', rel: 'noopener' }, rLink ?? ''), r3)] : []),
            h('p', {}, h('a', { href: '#/' }, c.back)),
          );
        }),
      ),
      disconnectOut,
    ),
  );
}

// ---- API keys ----

/** The drawer of a new key: scopes, accounts, IPs; the key itself is shown once in a dialog. */
function newKeyDrawer(accounts: Account[], redraw: (message?: string) => void): void {
  const k = t.keys;
  openDrawer(k.new, (close) => {
    const scopeBoxes = Object.keys(t.scope).map((s) => {
      const box = h('input', { type: 'checkbox', value: s });
      return { s, el: h('label', { class: 'check' }, box, ` ${label.scope(s)}`), box };
    });
    const accountBoxes = accounts.map((a) => {
      const box = h('input', { type: 'checkbox', value: a.cf_account_id });
      return { el: h('label', { class: 'check' }, box, ` ${a.name ?? a.cf_account_id}`), box };
    });
    const ips = h('input', { class: 'input', id: 'key-ips', placeholder: k.ipsPlaceholder, autocomplete: 'off' });
    return h(
      'div',
      { class: 'stack stack--md' },
      h('fieldset', { class: 'field' }, h('legend', { class: 'field-label' }, k.scopes), ...scopeBoxes.map((s) => s.el)),
      accounts.length ? h('fieldset', { class: 'field' }, h('legend', { class: 'field-label' }, k.onlyAccounts), ...accountBoxes.map((a) => a.el)) : null,
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'key-ips' }, k.onlyIps), ips),
      h(
        'div',
        { class: 'actions' },
        action(k.issue, 'btn--primary', async (key) => {
          const scopes = scopeBoxes.filter((s) => s.box.checked).map((s) => s.s);
          if (!scopes.length) throw new ApiError(400, 'invalid_request', k.needScope);
          const allow = accountBoxes.filter((a) => a.box.checked).map((a) => a.box.value);
          const ipList = ips.value.split(/[\s,]+/u).filter(Boolean);
          const issued = await call<Key & { key: string }>('POST', '/v1/keys', { scopes, ...(allow.length ? { allow_accounts: allow } : {}), ...(ipList.length ? { allow_ips: ipList } : {}) }, key).catch((e: unknown) => {
            // Issued, but the answer was lost: the key is active and will never be shown — the list
            // shows it, so it can be revoked.
            if (e instanceof ApiError && e.code === 'key_already_issued') {
              close();
              redraw(failure(e));
            }
            throw e;
          });
          close();
          redraw();
          showSecret(k.issued, issued.key, k.issuedNote);
        }),
      ),
    );
  });
}

export async function keysPage(me: Me, redraw: (message?: string) => void): Promise<HTMLElement> {
  const k = t.keys;
  const [{ keys }, { accounts }] = await Promise.all([call<{ keys: Key[] }>('GET', '/v1/keys'), call<{ accounts: Account[] }>('GET', '/v1/accounts')]);
  const add = h('button', { type: 'button', class: 'btn btn--primary' }, k.new);
  add.addEventListener('click', () => newKeyDrawer(accounts, redraw));
  const [i1, iLink, i2] = k.intro;
  const accountName = (id: string) => accounts.find((a) => a.cf_account_id === id)?.name ?? id;
  return h(
    'div',
    { class: 'stack stack--md' },
    pageHead(t.titles.keys, me.use.api_keys < me.limits.apiKeys ? add : null),
    h('p', { class: 'muted' }, i1, h('a', { href: '/agents' }, iLink ?? ''), `${i2} ${me.plan === 'api' ? k.api(me.limits.apiKeys) : k.free}`),
    keys.length
      ? table(
          [[k.colKey], [k.colScopes], [k.colAccounts, 'medium'], [k.colIps, 'low'], [k.colCreated, 'low'], [k.colUsed, 'medium'], ['']],
          keys.map((key) =>
            h(
              'tr',
              {},
              cell(h('code', {}, `${key.prefix}…`)),
              cell(key.scopes.map(label.scope).join(', ')),
              cell(key.allow_accounts?.map(accountName).join(', ') ?? k.all, 'medium'),
              cell(key.allow_ips?.join(', ') ?? k.any, 'low'),
              cell(when(key.created_at), 'low'),
              cell(key.last_used ?? '—', 'medium'),
              cell(
                confirmAction(
                  k.revoke,
                  { title: k.revoke, body: k.revokeAsk(key.prefix), confirmLabel: k.revoke },
                  async (idem) => {
                    await call('DELETE', `/v1/keys/${key.id}`, undefined, idem);
                    redraw();
                  },
                  'btn--ghost btn--sm',
                ),
              ),
            ),
          ),
        )
      : h('div', { class: 'card empty-state' }, h('p', {}, k.empty)),
  );
}
