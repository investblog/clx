// Pages of stage 4e-1 (docs/spec.md §10): connected Cloudflare accounts, connecting one, an
// account's status with its actions, and API keys. Every action is a /v1 call (§15).
import { ApiError, call, SignedOut, type Account, type Key, type Me } from './api';
import { codeBlock, copyButton, h } from './dom';
import { ACCOUNT_STATE, ADVICE_LEVEL, DROP, errorText, METRIC, OPERATION, SCOPE, STEP, warningText } from './text';

/** Whether the page that drew this is still the one on screen (a newer route bumps it). */
export type Live = () => boolean;

const CF_TOKENS = 'https://dash.cloudflare.com/?to=/:account/api-tokens';
const accountTokens = (cfId: string) => `https://dash.cloudflare.com/${cfId}/api-tokens`;

export const when = (iso: string | null | undefined) => (iso ? `${new Date(iso).toLocaleString('ru-RU', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' })} UTC` : '—');
export const num = (n: number) => n.toLocaleString('ru-RU');
const badge = ([text, tone]: [string, string]) => h('span', { class: `badge badge--${tone}` }, text);
const stateBadge = (s: string) => badge(ACCOUNT_STATE[s] ?? [s, 'neutral']);
export const notice = (text: string, tone: 'error' | 'success' | 'loading' | 'idle' = 'error') => h('div', { class: 'auth-status', 'data-type': tone, role: 'status' }, text);
export function failure(e: unknown): string {
  if (e instanceof ApiError) return errorText(e.code, e.message);
  // The session ended mid-action: the router finds that out again and shows the sign-in form.
  if (e instanceof SignedOut) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return 'Сессия закончилась — войдите снова.';
  }
  return 'Сеть недоступна. Попробуйте ещё раз.';
}
/** A value the reader copies into another site, with its own copy button. */
function copyable(text: string): HTMLElement {
  return h('span', { class: 'copyable' }, h('code', {}, text), copyButton(text));
}
const rows = (pairs: [string, Node | string][]) => h('dl', { class: 'kv' }, ...pairs.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));

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
export function action(label: string, cls: string, work: (key: string) => Promise<void>): HTMLElement {
  const out = h('span', { class: 'action-status' });
  const button = h('button', { type: 'button', class: `btn ${cls}` }, label);
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

// ---- the list ----

export async function accountsPage(me: Me): Promise<HTMLElement> {
  const { accounts } = await call<{ accounts: Account[] }>('GET', '/v1/accounts');
  const room = me.use.cf_accounts < me.limits.cfAccounts;
  const head = h(
    'div',
    { class: 'page-head' },
    h('h2', {}, 'Аккаунты Cloudflare'),
    room ? h('a', { class: 'btn btn--primary', href: '#/connect' }, 'Подключить аккаунт') : h('span', { class: 'muted' }, `Подключено ${me.use.cf_accounts} из ${me.limits.cfAccounts} — предел тарифа`),
  );
  if (!accounts.length)
    return h(
      'div',
      {},
      head,
      h('div', { class: 'card empty-state' }, h('p', {}, 'clx ставит в ваш аккаунт Cloudflare свой воркер и базу: счётчик и ссылки работают на ваших доменах и в ваших квотах, на clx.cx — только итоги.'), h('p', {}, h('a', { href: '#/connect' }, 'Подключить первый аккаунт →'))),
    );
  const list = h(
    'div',
    { class: 'stack stack--md' },
    ...accounts.map((a) =>
      h(
        'a',
        { class: 'card card--compact account-row', href: `#/accounts/${a.id}` },
        h('strong', {}, a.name ?? a.cf_account_id),
        stateBadge(a.state),
        a.advice && a.advice.level !== 'ok' ? badge(ADVICE_LEVEL[a.advice.level] ?? [a.advice.level, 'neutral']) : null,
        h('span', { class: 'muted' }, a.push ? `отправка ${when(a.push.at)}` : 'отправок ещё не было'),
      ),
    ),
  );
  return h('div', {}, head, list, h('p', {}, h('a', { href: '#/keys' }, 'Ключи API →')));
}

// ---- connecting ----

export function connectPage(go: (hash: string) => void): HTMLElement {
  const account = h('input', { class: 'input', id: 'cf-account', required: '', pattern: '[0-9a-f]{32}', placeholder: '32 символа: 0–9, a–f', autocomplete: 'off', spellcheck: 'false' });
  const token = h('input', { class: 'input masked', id: 'cf-bootstrap', required: '', type: 'text', autocomplete: 'off', spellcheck: 'false', 'data-1p-ignore': '', 'data-lpignore': 'true' });
  const status = notice('', 'idle');
  const submit = h('button', { type: 'submit', class: 'btn btn--primary' }, 'Подключить и установить');
  const form = h(
    'form',
    { class: 'auth-form' },
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'cf-account' }, 'Account ID'), account, h('p', { class: 'field-hint' }, 'На главной странице аккаунта в Cloudflare, справа внизу.')),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'cf-bootstrap' }, 'Bootstrap-токен'), token),
    status,
    h('div', { class: 'auth-actions' }, submit),
  );
  const idem = once();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    status.dataset.type = 'loading';
    status.textContent = 'Проверяем токен…';
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
  return h(
    'div',
    { class: 'narrow' },
    h('h2', {}, 'Подключить аккаунт Cloudflare'),
    // Step by step, one value per copy button — what goes into Cloudflare's search box and only that
    // (catchall.in's lesson: a whole "A:Read, B:Edit" line pasted into the search finds nothing).
    h(
      'ol',
      { class: 'steps' },
      h('li', {}, 'Откройте в Cloudflare ', h('a', { href: CF_TOKENS, target: '_blank', rel: 'noopener' }, 'Manage account → Account API Tokens'), ' (нужна роль Super Administrator), нажмите Create Token, затем Start from scratch.'),
      h('li', {}, 'Имя токена — любое, например ', copyable('clx bootstrap'), '.'),
      h(
        'li',
        {},
        'Политика с областью Entire Account. Права ищите по одному имени и выбирайте уровень:',
        h('ul', { class: 'perms' }, h('li', {}, copyable('Account API Tokens'), ' — уровень Edit: по нему clx выпустит свой рабочий токен'), h('li', {}, copyable('Account Settings'), ' — уровень Read')),
      ),
      h('li', {}, 'Срок (Expiration) — завтрашний день: токен нужен на несколько минут, clx удалит его сам.'),
      h('li', {}, 'Review token → Create Token. Скопируйте токен и вставьте ниже.'),
    ),
    h('div', { class: 'card' }, form),
  );
}

// ---- one account ----

function adviceCard(a: Account): HTMLElement | null {
  const adv = a.advice;
  if (!adv) return h('section', { class: 'card' }, h('h3', { class: 'h4' }, 'Совет по тарифу Cloudflare'), h('p', { class: 'muted' }, 'Считается раз в сутки по аналитике аккаунта — появится в течение суток.'));
  const table = h(
    'table',
    { class: 'table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Метрика'), h('th', {}, 'Пик за 7 дней'), h('th', {}, 'Лимит Free'), h('th', {}, 'Прогноз'), h('th', {}, ''))),
    h(
      'tbody',
      {},
      ...Object.entries(adv.metrics).map(([k, m]) => {
        const mb = (n: number) => (n < 1024 * 1024 ? 'меньше 1 МБ' : `${Math.round(n / 1024 / 1024)} МБ`);
        const value = k === 'size' ? mb(m.busiest.value) : `${num(m.busiest.value)}${m.busiest.day ? ` (${m.busiest.day})` : ''}`;
        return h('tr', {}, h('td', {}, METRIC[k] ?? k), h('td', {}, value), h('td', {}, k === 'size' ? mb(m.limit) : num(m.limit)), h('td', {}, m.forecast ? `лимит около ${m.forecast}` : '—'), h('td', {}, badge(ADVICE_LEVEL[m.level] ?? [m.level, 'neutral'])));
      }),
    ),
  );
  return h(
    'section',
    { class: 'card' },
    h('h3', { class: 'h4' }, 'Совет по тарифу Cloudflare ', badge(ADVICE_LEVEL[adv.level] ?? [adv.level, 'neutral'])),
    h('div', { class: 'table-scroll' }, table),
    adv.unavailable?.length ? h('p', { class: 'muted' }, adv.unavailable.includes('analytics') ? 'Аналитика аккаунта недоступна токену — запросы, записи и чтения не оценены.' : 'Размер базы прочитать не удалось.') : null,
    adv.suggest === 'shorter_hourly_retention' ? h('p', {}, 'Растёт только база — помогает хранить почасовые данные меньше дней, без перехода на платный тариф.') : null,
    h('p', { class: 'muted text-sm' }, `Посчитано ${when(adv.at)} по последним 7 полным суткам; лимиты общие для всех воркеров аккаунта.`),
  );
}

function banner(a: Account): HTMLElement | null {
  const adv = a.advice;
  if (!adv || (adv.level !== 'upgrade_soon' && adv.level !== 'over') || !adv.metric) return null;
  const m = adv.metrics[adv.metric]!;
  const what = METRIC[adv.metric] ?? adv.metric;
  const text =
    adv.level === 'over'
      ? `${what}: лимит Free исчерпан. Пока аккаунт на Free, часть счёта и ссылок может не работать — переведите его на Workers Paid ($5 в месяц).`
      : `${what}: пик ${num(m.busiest.value)} из ${num(m.limit)}${m.forecast ? `, лимит — около ${m.forecast}` : ''}. Скоро понадобится Workers Paid.`;
  return h('div', { class: `banner banner--${adv.level === 'over' ? 'danger' : 'warning'}`, role: 'alert' }, text);
}

function operationCard(a: Account): HTMLElement | null {
  const op = a.operation;
  if (!op) return null;
  const running = op.state === 'running';
  const step = op.step.startsWith('failed') ? 'остановлено' : (STEP[op.step] ?? op.step);
  // The worker is up once uploaded; its self-check only confirms that (docs/spec.md §4), so the
  // reader is told not to wait for it. Not for an update: a missing self-check rolls it back.
  if (running && op.kind === 'install' && op.step === 'selfcheck' && a.state === 'ready')
    return h(
      'section',
      { class: 'card card--compact' },
      h('strong', {}, `${OPERATION[op.kind] ?? op.kind}: `),
      'воркер загружен и работает.',
      h('p', {}, 'Ждём его первого отклика — обычно несколько минут, до 15. Ждать не нужно: ', h('a', { href: '#/sites/new' }, 'добавляйте сайты'), ' и ссылки уже сейчас.'),
      h('p', { class: 'muted text-sm' }, `обновлено ${when(op.updated_at)}`),
    );
  return h(
    'section',
    { class: 'card card--compact' },
    h('strong', {}, `${OPERATION[op.kind] ?? op.kind}: `),
    running ? `идёт — ${step}…` : op.state === 'failed' ? `не удалось (${step})` : 'завершено',
    op.error ? h('p', { class: 'muted' }, errorText(op.error.code, op.error.message ?? '')) : null,
    h('p', { class: 'muted text-sm' }, `обновлено ${when(op.updated_at)}`),
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

  const warnings = a.error?.warnings ?? [];
  const errorCode = a.error?.code;
  const disconnectOut = h('div', {});
  const renew = h('input', { class: 'input masked', type: 'text', autocomplete: 'off', spellcheck: 'false', 'data-1p-ignore': '', 'data-lpignore': 'true', placeholder: 'новый bootstrap-токен' });
  return h(
    'div',
    { class: 'stack stack--md' },
    h('p', {}, h('a', { href: '#/' }, '← Аккаунты')),
    h('div', { class: 'page-head' }, h('h2', {}, a.name ?? a.cf_account_id), stateBadge(a.state)),
    banner(a),
    errorCode ? notice(errorText(errorCode, errorCode)) : null,
    warnings.length ? h('ul', { class: 'warnings' }, ...warnings.map((w) => h('li', {}, warningText(w)))) : null,
    operationCard(a),
    h(
      'section',
      { class: 'card' },
      h('h3', { class: 'h4' }, 'Воркер clx-edge'),
      rows([
        ['Account ID', a.cf_account_id],
        ['Версия', a.edge ? `${a.edge.bundle.slice(0, 12)}${a.edge.up_to_date ? ' — актуальная' : ' — есть новее'}` : 'не установлен'],
        ['Схема базы', a.edge?.schema != null ? String(a.edge.schema) : '—'],
        ['Установлен', when(a.edge?.installed_at)],
        ['Рабочий токен', a.token ? `${a.token.name}, до ${when(a.token.expires_at)}` : '—'],
      ]),
    ),
    h(
      'section',
      { class: 'card' },
      h('h3', { class: 'h4' }, 'Связь с воркером'),
      a.push
        ? rows([
            ['Последняя отправка', when(a.push.at)],
            ['Очередь', num(a.push.queue)],
            ['Ошибка воркера', a.push.error ?? 'нет'],
            ['Отброшено', Object.keys(a.push.dropped).length ? Object.entries(a.push.dropped).map(([k, n]) => `${DROP[k] ?? k}: ${num(n)}`).join(', ') : 'ничего'],
          ])
        : h('p', { class: 'muted' }, 'Воркер ещё ничего не отправлял — первая отправка приходит в начале следующего часа (в :05).'),
    ),
    adviceCard(a),
    h(
      'section',
      { class: 'card stack stack--sm' },
      h('h3', { class: 'h4' }, 'Действия'),
      h(
        'div',
        { class: 'actions' },
        action('Переустановить воркер', 'btn--ghost', async (key) => {
          await call('POST', `/v1/accounts/${a.id}/install`, undefined, key);
          redraw();
        }),
      ),
      h(
        'div',
        { class: 'actions' },
        renew,
        action('Обновить токен', 'btn--ghost', async (key) => {
          if (!renew.value.trim()) throw new ApiError(400, 'invalid_request', 'Вставьте новый bootstrap-токен.');
          await call('POST', `/v1/accounts/${a.id}/token`, { bootstrap_token: renew.value.trim() }, key);
          renew.value = '';
          redraw();
        }),
      ),
      h(
        'div',
        { class: 'actions' },
        confirmAction('Отключить clx от аккаунта', 'Отключить: удалить маршруты, воркер и базу clx', async (key) => {
          const r = await call<{ revoke_token: string | null; left: string[] }>('DELETE', `/v1/accounts/${a.id}`, undefined, key);
          disconnectOut.replaceChildren(
            notice(r.left.length ? `Отключено, но не всё удалилось: ${r.left.join(', ')} — удалите вручную в Cloudflare.` : 'Отключено: маршруты, воркер и база удалены. Итоги на clx.cx хранятся ещё 30 дней.', r.left.length ? 'error' : 'success'),
            ...(r.revoke_token ? [h('p', {}, 'Рабочий токен ', h('code', {}, r.revoke_token), ' сам себя удалить не может — ', h('a', { href: accountTokens(a.cf_account_id), target: '_blank', rel: 'noopener' }, 'отзовите его в Cloudflare'), '.')] : []),
            h('p', {}, h('a', { href: '#/' }, '← К аккаунтам')),
          );
        }),
      ),
      disconnectOut,
    ),
  );
}

/** A destructive action asks once more in the page itself (no browser dialogs). */
export function confirmAction(label: string, confirmLabel: string, work: (key: string) => Promise<void>): HTMLElement {
  const box = h('span', { class: 'action' });
  const first = h('button', { type: 'button', class: 'btn btn--danger' }, label);
  first.addEventListener('click', () => {
    const cancel = h('button', { type: 'button', class: 'btn btn--ghost' }, 'Отмена');
    cancel.addEventListener('click', () => box.replaceChildren(first));
    box.replaceChildren(action(confirmLabel, 'btn--danger', work), cancel);
  });
  box.append(first);
  return box;
}

// ---- API keys ----

export async function keysPage(me: Me, redraw: (message?: string) => void): Promise<HTMLElement> {
  const [{ keys }, { accounts }] = await Promise.all([call<{ keys: Key[] }>('GET', '/v1/keys'), call<{ accounts: Account[] }>('GET', '/v1/accounts')]);
  const shown = h('div', {});
  const scopeBoxes = Object.entries(SCOPE).map(([k, label]) => {
    const box = h('input', { type: 'checkbox', value: k });
    return { k, el: h('label', { class: 'check' }, box, ` ${label}`), box };
  });
  const accountBoxes = accounts.map((a) => {
    const box = h('input', { type: 'checkbox', value: a.cf_account_id });
    return { el: h('label', { class: 'check' }, box, ` ${a.name ?? a.cf_account_id}`), box };
  });
  const ips = h('input', { class: 'input', placeholder: 'например 203.0.113.7, 2001:db8::1', autocomplete: 'off' });
  const row = (k: Key) =>
    h(
      'tr',
      {},
      h('td', {}, h('code', {}, `${k.prefix}…`)),
      h('td', {}, k.scopes.map((s) => SCOPE[s] ?? s).join(', ')),
      h('td', {}, k.allow_accounts?.map((id) => accounts.find((a) => a.cf_account_id === id)?.name ?? id).join(', ') ?? 'все'),
      h('td', {}, k.allow_ips?.join(', ') ?? 'любые'),
      h('td', {}, when(k.created_at)),
      h('td', {}, k.last_used ?? '—'),
      h(
        'td',
        {},
        confirmAction('Отозвать', 'Да, отозвать', async (key) => {
          await call('DELETE', `/v1/keys/${k.id}`, undefined, key);
          redraw();
        }),
      ),
    );
  const tbody = h('tbody', {}, ...keys.map(row));
  const tableCard = h(
    'div',
    { class: 'card table-scroll' },
    h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Ключ'), h('th', {}, 'Права'), h('th', {}, 'Аккаунты'), h('th', {}, 'IP'), h('th', {}, 'Выпущен'), h('th', {}, 'Использован'), h('th', {}, ''))), tbody),
  );
  let list: HTMLElement = keys.length ? tableCard : h('div', { class: 'card empty-state' }, h('p', {}, 'Ключей пока нет.'));
  return h(
    'div',
    { class: 'stack stack--md' },
    h('h2', {}, 'Ключи API'),
    h(
      'p',
      { class: 'muted' },
      `Ключ — для агентов, генераторов сайтов и консоли (`,
      h('a', { href: '/agents' }, 'инструкция для агентов'),
      `). Показывается один раз; на clx.cx хранится только его хеш. ${me.plan === 'api' ? `До ${me.limits.apiKeys} ключей.` : 'На тарифе free — один ключ и те же пределы, что в кабинете; больше аккаунтов, сайтов и ключей даёт тариф api — по запросу.'}`,
    ),
    list,
    h(
      'section',
      { class: 'card stack stack--sm' },
      h('h3', { class: 'h4' }, 'Новый ключ'),
      h('div', {}, h('div', { class: 'field-label' }, 'Права (минимум нужных — генератору сайтов хватит «сайты» и «отчёты»)'), ...scopeBoxes.map((s) => s.el)),
      accounts.length ? h('div', {}, h('div', { class: 'field-label' }, 'Только эти аккаунты Cloudflare (ничего не отмечено — все)'), ...accountBoxes.map((a) => a.el)) : null,
      h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Только с этих IP (через запятую; пусто — с любых)'), ips),
      h(
        'div',
        { class: 'actions' },
        action('Выпустить ключ', 'btn--primary', async (key) => {
          const scopes = scopeBoxes.filter((s) => s.box.checked).map((s) => s.k);
          if (!scopes.length) throw new ApiError(400, 'invalid_request', 'Отметьте хотя бы одно право.');
          const allow = accountBoxes.filter((a) => a.box.checked).map((a) => a.box.value);
          const ipList = ips.value.split(/[\s,]+/u).filter(Boolean);
          const issued = await call<Key & { key: string }>('POST', '/v1/keys', { scopes, ...(allow.length ? { allow_accounts: allow } : {}), ...(ipList.length ? { allow_ips: ipList } : {}) }, key).catch((e: unknown) => {
            // Issued, but the answer was lost: the key is active and will never be shown — list it
            // so it can be revoked.
            if (e instanceof ApiError && e.code === 'key_already_issued') redraw(failure(e));
            throw e;
          });
          shown.replaceChildren(h('div', { class: 'card stack stack--sm secret-card' }, h('strong', {}, 'Ключ выпущен — сохраните его сейчас, больше он не покажется:'), codeBlock(issued.key, 'Скопировать ключ')));
          // The new key joins the list (without its secret), so it can be revoked from here.
          tbody.append(row(issued));
          if (list !== tableCard) {
            list.replaceWith(tableCard);
            list = tableCard;
          }
        }),
      ),
      shown,
    ),
  );
}
