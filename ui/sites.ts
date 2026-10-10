// Pages of stage 4e-2 (docs/spec.md §10): sites — the list, adding one by its host, and a site's
// page with its snippet, excluded paths, route state, rotate and delete. Every action is a /v1 call.
import { ApiError, call, type Account, type Me } from './api';
import { action, confirmAction, notice, when, type Live } from './accounts';
import { h } from './dom';
import { dropdown, zoneHost } from './pick';
import { errorText } from './text';

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

const SITE_STATE: Record<string, [string, string]> = {
  route_pending: ['маршрут создаётся', 'neutral'],
  active: ['работает', 'success'],
  route_conflict: ['путь занят другим воркером', 'danger'],
  deleted: ['удалён', 'neutral'],
};
const badge = ([text, tone]: [string, string]) => h('span', { class: `badge badge--${tone}` }, text);
const siteBadge = (s: Site) => badge(SITE_STATE[s.state] ?? [s.state, 'neutral']);
const paths = (text: string) => [...new Set(text.split(/[\s,]+/u).filter(Boolean))];

/** The sites block of the home page. */
export async function sitesBlock(): Promise<HTMLElement> {
  const [{ sites }, { accounts }] = await Promise.all([call<{ sites: Site[] }>('GET', '/v1/sites'), call<{ accounts: Account[] }>('GET', '/v1/accounts')]);
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';
  return h(
    'div',
    {},
    h('div', { class: 'page-head' }, h('h2', {}, 'Сайты'), accounts.length ? h('a', { class: 'btn btn--primary', href: '#/sites/new' }, 'Добавить сайт') : null),
    sites.length
      ? h(
          'div',
          { class: 'stack stack--md' },
          ...sites.map((s) =>
            h(
              'a',
              { class: 'card card--compact account-row', href: `#/sites/${s.id}` },
              h('strong', {}, s.host),
              siteBadge(s),
              s.config === 'pending' ? badge(['настройки в пути', 'neutral']) : null,
              h('span', { class: 'muted' }, name(s.account_id)),
            ),
          ),
        )
      : h('div', { class: 'card empty-state' }, h('p', {}, accounts.length ? 'Сайтов пока нет. Добавьте сайт с вашего аккаунта Cloudflare — clx выдаст для него сниппет счётчика.' : 'Сначала подключите аккаунт Cloudflare — сайты добавляются на его зоны.')),
  );
}

// ---- adding ----

export async function newSitePage(me: Me, go: (hash: string) => void): Promise<HTMLElement> {
  const { accounts } = await call<{ accounts: Account[] }>('GET', '/v1/accounts');
  const usable = accounts.filter((a) => a.state === 'ready' || a.state === 'no_connection');
  if (!usable.length) return h('div', { class: 'narrow' }, h('h2', {}, 'Добавить сайт'), h('div', { class: 'card' }, h('p', {}, 'Нет аккаунта с установленным воркером. '), h('p', {}, h('a', { href: '#/' }, '← К аккаунтам'))));
  const account = dropdown(
    usable.map((a) => ({ value: a.id, label: a.name ?? a.cf_account_id })),
    { id: 'site-account', onChange: () => zones.refresh() },
  );
  const host = h('input', { class: 'input', id: 'site-host', required: '', placeholder: 'начните вводить домен', autocomplete: 'off', spellcheck: 'false' });
  const zones = zoneHost(host, account.value);
  const excluded = h('input', { class: 'input', id: 'site-excluded', placeholder: '/admin, /preview', autocomplete: 'off', spellcheck: 'false' });
  return h(
    'div',
    { class: 'narrow stack stack--md' },
    h('p', {}, h('a', { href: '#/' }, '← Назад')),
    h('h2', {}, 'Добавить сайт'),
    h(
      'div',
      { class: 'card stack stack--sm' },
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'site-account' }, 'Аккаунт Cloudflare'), account.el),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'site-host' }, 'Хост сайта'), zones.el, h('p', { class: 'field-hint' }, 'Выберите домен из зон этого аккаунта; поддомен (blog.example.com) допишите. clx поставит маршрут только на путь счётчика, страницы сайта он не трогает.')),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'site-excluded' }, 'Не считать пути (необязательно)'), excluded, h('p', { class: 'field-hint' }, 'Начала путей через запятую, до 50.')),
      h(
        'div',
        { class: 'actions' },
        action('Добавить', 'btn--primary', async (key) => {
          if (!host.value.trim()) throw new ApiError(400, 'invalid_request', 'Укажите хост.');
          const r = await call<{ site: Site }>('POST', '/v1/sites', { account_id: account.value(), host: host.value.trim(), excluded_paths: paths(excluded.value) }, key);
          go(`#/sites/${r.site.id}`);
        }),
      ),
    ),
    h('p', { class: 'muted text-sm' }, `Тариф ${me.plan}: до ${me.limits.sites} сайтов.`),
  );
}

// ---- one site ----

function snippetCard(s: Site): HTMLElement {
  if (!s.snippet) return h('section', { class: 'card' }, h('h3', { class: 'h4' }, 'Сниппет'), h('p', { class: 'muted' }, 'Появится, когда маршрут будет создан.'));
  const block = (title: string, hint: string, code: string) => {
    const copy = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, 'Скопировать');
    copy.addEventListener('click', () => void navigator.clipboard?.writeText(code).then(() => (copy.textContent = 'Скопировано')));
    return h('div', { class: 'stack stack--sm secret-card' }, h('strong', {}, title), h('p', { class: 'muted text-sm' }, hint), h('code', { class: 'secret' }, code), copy);
  };
  return h(
    'section',
    { class: 'card stack stack--md' },
    h('h3', { class: 'h4' }, 'Сниппет'),
    h('p', {}, 'Вставьте один из двух вариантов в шаблон всех страниц сайта — при сборке. Адрес счётчика — на вашем домене, ничего внешнего на странице нет. Сниппет не меняется, пока вы не смените путь.'),
    block('Встроенный скрипт', 'Без отдельного запроса за файлом.', s.snippet.inline),
    block('Подключаемый файл', 'Если на сайте CSP без inline-скриптов.', s.snippet.script_tag),
  );
}

export async function sitePage(id: string, live: Live, redraw: (message?: string) => void): Promise<HTMLElement> {
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
  const excluded = h('input', { class: 'input', value: s.excluded_paths.join(', '), autocomplete: 'off', spellcheck: 'false' });
  const deleted = s.state === 'deleted';
  return h(
    'div',
    { class: 'stack stack--md' },
    h('p', {}, h('a', { href: '#/' }, '← Сайты')),
    h('div', { class: 'page-head' }, h('h2', {}, s.host), siteBadge(s), deleted ? null : h('a', { class: 'btn btn--ghost', href: `#/sites/${s.id}/report` }, 'Отчёт')),
    s.error?.code ? notice(errorText(s.error.code, s.error.code)) : null,
    s.config === 'pending' && !deleted ? notice('Настройки сайта едут в воркер — обычно меньше минуты.', 'loading') : null,
    deleted ? notice('Сайт удалён: маршрут снят, итоги хранятся, пока аккаунт подключён.', 'idle') : snippetCard(s),
    deleted
      ? null
      : h(
          'section',
          { class: 'card stack stack--sm' },
          h('h3', { class: 'h4' }, 'Настройки'),
          h('p', { class: 'muted text-sm' }, `Путь счётчика: ${s.path}. Добавлен ${when(s.created_at)}.`),
          s.retiring.length ? h('p', { class: 'muted text-sm' }, `Старые пути ещё считаются: ${s.retiring.map((r) => `${r.path} до ${when(r.until)}`).join(', ')}.`) : null,
          h('div', { class: 'field-label' }, 'Не считать пути (начала путей через запятую)'),
          h(
            'div',
            { class: 'actions' },
            excluded,
            action('Сохранить', 'btn--ghost', async (key) => {
              await call('PATCH', `/v1/sites/${s.id}`, { excluded_paths: paths(excluded.value) }, key);
              redraw();
            }),
          ),
          // Rotation needs a working route (the API answers site_not_active otherwise).
          s.state === 'active' ? h('p', { class: 'muted text-sm' }, 'Сменить путь — если старый попал в список блокировки или его нужно спрятать: появится новый путь и новый сниппет, старый будет считаться ещё 30 дней.') : null,
          h(
            'div',
            { class: 'actions' },
            s.state === 'active'
              ? confirmAction('Сменить путь', 'Да, выдать новый путь и сниппет', async (key) => {
                  await call('POST', `/v1/sites/${s.id}/rotate`, undefined, key);
                  redraw();
                })
              : null,
            confirmAction('Удалить сайт', 'Да, снять маршрут', async (key) => {
              await call('DELETE', `/v1/sites/${s.id}`, undefined, key);
              redraw();
            }),
          ),
        ),
  );
}

