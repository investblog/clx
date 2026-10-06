// Pages of stage 5b (docs/spec.md §10): short links — the link host of each account, the list with
// 7-day clicks, adding a link, and a link's page with its URL, rules and delete. Every action is a
// /v1 call.
import { ApiError, call, type Account, type LinkHost, type Me } from './api';
import { action, confirmAction, notice, num, when, type Live } from './accounts';
import { h } from './dom';
import { errorText } from './text';

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

const HOST_STATE: Record<string, [string, string]> = {
  route_pending: ['маршрут создаётся', 'neutral'],
  active: ['работает', 'success'],
  route_conflict: ['хост занят другим воркером', 'danger'],
};
const badge = ([text, tone]: [string, string]) => h('span', { class: `badge badge--${tone}` }, text);
const usable = (a: Account) => a.state === 'ready' || a.state === 'no_connection';

/** The accounts a link can live in, each with its link host (read one by one: only GET one has it). */
async function accountsWithHosts(): Promise<Account[]> {
  const { accounts } = await call<{ accounts: Account[] }>('GET', '/v1/accounts');
  return Promise.all(accounts.filter(usable).map(async (a) => (await call<{ account: Account }>('GET', `/v1/accounts/${a.id}`)).account));
}

/** Set or replace an account's link host: the DNS record is the user's to make (§13 item 2). */
function hostForm(a: Account, done: () => void): HTMLElement {
  const input = h('input', { class: 'input', placeholder: 'go.example.com', autocomplete: 'off', spellcheck: 'false', value: a.link_host?.host ?? '' });
  return h(
    'div',
    { class: 'stack stack--sm' },
    h('p', { class: 'muted text-sm' }, 'Хост ссылок — отдельный поддомен или домен в зоне этого аккаунта: весь он отдаётся воркеру, сайта на нём быть не должно. Создайте в Cloudflare DNS запись AAAA этого хоста со значением 100:: и включённым проксированием (оранжевое облако) — clx её не создаёт.'),
    h(
      'div',
      { class: 'actions' },
      input,
      action(a.link_host ? 'Сменить хост' : 'Задать хост', a.link_host ? 'btn--ghost' : 'btn--primary', async (key) => {
        if (!input.value.trim()) throw new ApiError(400, 'invalid_request', 'Укажите хост.');
        await call('PUT', `/v1/accounts/${a.id}/link-host`, { host: input.value.trim() }, key);
        done();
      }),
    ),
    a.link_host ? h('p', { class: 'muted text-sm' }, 'При смене хоста ссылки переедут на новый с теми же кодами; напечатанные QR-коды со старым хостом перестанут работать.') : null,
  );
}

function hostLine(a: Account, redraw: () => void): HTMLElement {
  const lh = a.link_host as LinkHost | null | undefined;
  const form = hostForm(a, redraw);
  form.hidden = !!lh;
  const toggle = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, 'Сменить');
  toggle.addEventListener('click', () => (form.hidden = !form.hidden));
  return h(
    'div',
    { class: 'card card--compact stack stack--sm' },
    h('div', { class: 'account-row' }, h('strong', {}, a.name ?? a.cf_account_id), lh ? h('span', {}, lh.host) : h('span', { class: 'muted' }, 'хост ссылок не задан'), lh ? badge(HOST_STATE[lh.state] ?? [lh.state, 'neutral']) : null, lh ? toggle : null),
    lh?.error?.code ? notice(errorText(lh.error.code, lh.error.code)) : null,
    form,
  );
}

/** The links block of the home page. */
export async function linksBlock(redraw: () => void): Promise<HTMLElement> {
  const [{ links }, accounts] = await Promise.all([call<{ links: Link[] }>('GET', '/v1/links'), accountsWithHosts()]);
  const withHost = accounts.some((a) => a.link_host);
  return h(
    'div',
    {},
    h('div', { class: 'page-head' }, h('h2', {}, 'Ссылки'), withHost ? h('a', { class: 'btn btn--primary', href: '#/links/new' }, 'Новая ссылка') : null),
    accounts.length ? h('div', { class: 'stack stack--sm' }, ...accounts.map((a) => hostLine(a, redraw))) : null,
    links.length
      ? h(
          'div',
          { class: 'stack stack--md' },
          ...links.map((l) =>
            h(
              'a',
              { class: 'card card--compact account-row', href: `#/links/${l.id}` },
              h('strong', {}, l.short_url ?? l.code),
              h('span', { class: 'muted truncate' }, `→ ${l.url}`),
              l.rules.length ? badge([`правил: ${l.rules.length}`, 'neutral']) : null,
              l.config === 'pending' ? badge(['настройки в пути', 'neutral']) : null,
              h('span', { class: 'muted' }, `за 7 дней: ${num(l.clicks_7d ?? 0)}`),
            ),
          ),
        )
      : h('div', { class: 'card empty-state' }, h('p', {}, accounts.length ? (withHost ? 'Ссылок пока нет.' : 'Задайте хост ссылок аккаунта — короткие ссылки живут на вашем домене.') : 'Короткие ссылки появятся, когда будет аккаунт Cloudflare с установленным воркером.')),
  );
}

/** The rules editor: one row per rule, the first match wins (§6). */
function rulesEditor(initial: Rule[]): { el: HTMLElement; value: () => Rule[] } {
  const list = h('div', { class: 'stack stack--sm' });
  const rows: { countries: HTMLInputElement; device: HTMLSelectElement; url: HTMLInputElement; el: HTMLElement }[] = [];
  const add = (r?: Rule) => {
    const countries = h('input', { class: 'input', placeholder: 'DE, AT', value: r?.countries?.join(', ') ?? '', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Страны' });
    const device = h('select', { class: 'select', 'aria-label': 'Устройство' }, h('option', { value: '' }, 'любое устройство'), h('option', { value: 'mobile' }, 'телефон'), h('option', { value: 'desktop' }, 'компьютер'));
    device.value = r?.devices?.length === 1 ? r.devices[0]! : '';
    const url = h('input', { class: 'input', placeholder: 'https://…', value: r?.url ?? '', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Куда' });
    const remove = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, 'Убрать');
    const row = { countries, device, url, el: h('div', { class: 'rule-row' }, countries, device, url, remove) };
    remove.addEventListener('click', () => {
      rows.splice(rows.indexOf(row), 1);
      row.el.remove();
    });
    rows.push(row);
    list.append(row.el);
  };
  initial.forEach(add);
  const more = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, 'Добавить правило');
  more.addEventListener('click', () => add());
  return {
    el: h('div', { class: 'stack stack--sm' }, h('div', { class: 'field-label' }, 'Правила (необязательно): страны — коды из двух букв через запятую; срабатывает первое подходящее'), list, h('div', {}, more)),
    value: () =>
      rows.map((r) => {
        const countries = [...new Set(r.countries.value.toUpperCase().split(/[\s,]+/u).filter(Boolean))];
        return { ...(countries.length ? { countries } : {}), ...(r.device.value ? { devices: [r.device.value as 'mobile' | 'desktop'] } : {}), url: r.url.value.trim() };
      }),
  };
}

export async function newLinkPage(me: Me, go: (hash: string) => void): Promise<HTMLElement> {
  const accounts = (await accountsWithHosts()).filter((a) => a.link_host);
  if (!accounts.length) return h('div', { class: 'narrow' }, h('h2', {}, 'Новая ссылка'), h('div', { class: 'card' }, h('p', {}, 'Сначала задайте хост ссылок аккаунта на главной.'), h('p', {}, h('a', { href: '#/' }, '← На главную'))));
  const account = h('select', { class: 'select', id: 'link-account' }, ...accounts.map((a) => h('option', { value: a.id }, `${a.link_host!.host} — ${a.name ?? a.cf_account_id}`)));
  const code = h('input', { class: 'input', id: 'link-code', placeholder: 'promo (пусто — случайный)', autocomplete: 'off', spellcheck: 'false' });
  const url = h('input', { class: 'input', id: 'link-url', required: '', placeholder: 'https://example.com/landing', autocomplete: 'off', spellcheck: 'false' });
  const rules = rulesEditor([]);
  return h(
    'div',
    { class: 'narrow stack stack--md' },
    h('p', {}, h('a', { href: '#/' }, '← Назад')),
    h('h2', {}, 'Новая ссылка'),
    h(
      'div',
      { class: 'card stack stack--sm' },
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'link-account' }, 'Хост ссылок'), account),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'link-code' }, 'Код'), code, h('p', { class: 'field-hint' }, '3–32 знака: латиница, цифры, «_» и «-». Код потом не меняется — он напечатан в QR.')),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'link-url' }, 'Куда ведёт'), url),
      rules.el,
      h(
        'div',
        { class: 'actions' },
        action('Создать', 'btn--primary', async (key) => {
          if (!url.value.trim()) throw new ApiError(400, 'invalid_request', 'Укажите, куда ведёт ссылка.');
          const r = await call<{ link: Link }>('POST', '/v1/links', { account_id: account.value, url: url.value.trim(), rules: rules.value(), ...(code.value.trim() ? { code: code.value.trim() } : {}) }, key);
          go(`#/links/${r.link.id}`);
        }),
      ),
    ),
    h('p', { class: 'muted text-sm' }, `Тариф ${me.plan}: до ${me.limits.links} ссылок.`),
  );
}

export async function linkPage(id: string, live: Live, redraw: (message?: string) => void): Promise<HTMLElement> {
  const { link: l } = await call<{ link: Link }>('GET', `/v1/links/${id}`);
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
  const url = h('input', { class: 'input', value: l.url, autocomplete: 'off', spellcheck: 'false' });
  const rules = rulesEditor(l.rules);
  const copy = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, 'Скопировать');
  copy.addEventListener('click', () => void navigator.clipboard?.writeText(l.short_url ?? '').then(() => (copy.textContent = 'Скопировано')));
  return h(
    'div',
    { class: 'stack stack--md' },
    h('p', {}, h('a', { href: '#/' }, '← Ссылки')),
    h('div', { class: 'page-head' }, h('h2', {}, l.short_url ?? l.code), deleted ? badge(['удалена', 'neutral']) : null, h('a', { class: 'btn btn--ghost', href: `#/links/${l.id}/report` }, 'Отчёт')),
    l.config === 'pending' && !deleted ? notice('Ссылка едет в воркер — обычно меньше минуты.', 'loading') : null,
    deleted
      ? notice('Ссылка удалена: код свободен, итоги хранятся, пока аккаунт подключён.', 'idle')
      : h(
          'section',
          { class: 'card stack stack--sm' },
          h('div', { class: 'actions' }, h('code', { class: 'secret' }, l.short_url ?? ''), copy),
          h('p', { class: 'muted text-sm' }, `Создана ${when(l.created_at)}. Переход — сразу на адрес назначения (302); каждый клик считается в базе вашего аккаунта.`),
          h('div', { class: 'field-label' }, 'Куда ведёт'),
          url,
          rules.el,
          h(
            'div',
            { class: 'actions' },
            action('Сохранить', 'btn--primary', async (key) => {
              await call('PATCH', `/v1/links/${l.id}`, { url: url.value.trim(), rules: rules.value() }, key);
              redraw();
            }),
            confirmAction('Удалить ссылку', 'Да, удалить — код перестанет работать', async (key) => {
              await call('DELETE', `/v1/links/${l.id}`, undefined, key);
              redraw();
            }),
          ),
        ),
  );
}
