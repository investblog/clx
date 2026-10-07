// The page's entry: sign-in, the hash router over the pages, the theme.
import { accountPage, accountsPage, action, confirmAction, connectPage, failure, keysPage } from './accounts';
import { call, get, login, logout, refresh, SignedOut, type Me } from './api';
import { h } from './dom';
import { linkPage, linksBlock, newLinkPage } from './links';
import { reportPage } from './report';
import { confirmPage, resetPage, signupPage } from './signup';
import { newSitePage, sitePage, sitesBlock } from './sites';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const loginBox = $('login');
const app = $('app');
const who = $('who');
const out = $('logout');
let me: Me | null = null;
let seq = 0; // a newer route wins: an older answer that arrives late is dropped
let flash = '';

function showLogin(message = ''): void {
  me = null;
  app.hidden = true;
  out.hidden = true;
  who.textContent = '';
  document.title = 'Вход — clx';
  loginBox.hidden = false;
  const status = $('login-status');
  status.dataset.type = message ? 'error' : 'idle';
  status.textContent = message;
  $<HTMLInputElement>('email').focus();
}

/** Until the address is confirmed no Cloudflare account can be connected (§9): say so, offer the e-mail again. */
function unconfirmedBanner(): HTMLElement {
  return h(
    'div',
    { class: 'banner banner--warning stack stack--sm' },
    h('p', {}, `Подтвердите адрес ${me!.user.email}: ссылка в письме, которое clx отправил при регистрации. До этого аккаунт Cloudflare подключить нельзя.`),
    h(
      'div',
      { class: 'actions' },
      action('Прислать письмо ещё раз', 'btn--ghost btn--sm', async () => {
        await call('POST', '/auth/confirm/resend');
        flash = '';
      }),
    ),
  );
}

/** Deleting the account (§9): with the password; the answer names what clx could not remove. */
function accountCard(): HTMLElement {
  // Not type=password: the browser would fill the saved clx.cx password into it on every load,
  // one confirmation away from a delete (the trick of the token fields, ui/accounts.ts).
  const password = h('input', { class: 'input masked', type: 'text', autocomplete: 'off', spellcheck: 'false', 'data-1p-ignore': '', 'data-lpignore': 'true', 'aria-label': 'Пароль для удаления', placeholder: 'пароль' });
  return h(
    'section',
    { class: 'card stack stack--sm' },
    h('h3', { class: 'h4' }, 'Учётная запись'),
    h('p', { class: 'muted text-sm' }, `${me!.user.email}. Удаление отключит все аккаунты Cloudflare (воркер, база и маршруты clx удаляются из них), сотрёт итоги, ключи, сайты и ссылки — сразу и без возврата.`),
    h(
      'div',
      { class: 'actions' },
      password,
      confirmAction('Удалить учётную запись', 'Да, удалить всё', async (key) => {
        const r = await call<{ left: string[]; revoke_tokens: string[] }>('DELETE', '/v1/me', { password: password.value }, key);
        // A failed logout leaves nothing: the user's sessions end with the user, and a new user who
        // gets the same id starts at another session version (src/auth/signup.ts).
        await logout();
        location.hash = '#/';
        const rest = [...r.revoke_tokens.map((t) => `токен ${t}`), ...r.left];
        showLogin(rest.length ? `Учётная запись удалена. Удалите в Cloudflare вручную: ${rest.join(', ')}.` : 'Учётная запись удалена.');
      }),
    ),
  );
}

const go = (hash: string) => {
  if (location.hash === hash) void route();
  else location.hash = hash;
};

/** The page for the address: #/ accounts, sites and links, #/connect, #/accounts/<id>, #/keys,
 *  #/sites/new, #/sites/<id>, #/links/new, #/links/<id>, and the reports …/<id>/report. */
async function page(path: string, mine: number): Promise<[HTMLElement, string]> {
  const live = () => mine === seq;
  const redraw = (message?: string) => {
    flash = message ?? '';
    void route();
  };
  const account = path.match(/^\/accounts\/([\w-]+)$/u);
  if (path === '/connect') return [connectPage(go), 'Подключить аккаунт'];
  if (account) return [await accountPage(account[1]!, live, redraw), 'Аккаунт'];
  if (path === '/keys') return [await keysPage(me!, redraw), 'Ключи API'];
  if (path === '/sites/new') return [await newSitePage(me!, go), 'Добавить сайт'];
  const report = path.match(/^\/(sites|links)\/([\w-]+)\/report(?:\?p=([\w]+))?$/u);
  if (report) return [await reportPage(report[1] as 'sites' | 'links', report[2]!, report[3] ?? 'today'), 'Отчёт'];
  const site = path.match(/^\/sites\/([\w-]+)$/u);
  if (site) return [await sitePage(site[1]!, live, redraw), 'Сайт'];
  if (path === '/links/new') return [await newLinkPage(me!, go), 'Новая ссылка'];
  const link = path.match(/^\/links\/([\w-]+)$/u);
  if (link) return [await linkPage(link[1]!, live, redraw), 'Ссылка'];
  const [accounts, sites, links] = await Promise.all([accountsPage(me!), sitesBlock(), linksBlock(() => redraw())]);
  return [h('div', {}, me!.user.email_confirmed ? null : unconfirmedBanner(), accounts, sites, links, accountCard()), 'Главная'];
}

/** The pages a signed-out visitor opens (§9): sign-up, the confirmation link, the password reset. */
async function publicPage(path: string): Promise<[HTMLElement, string] | null> {
  const token = path.match(/[?&]t=([A-Za-z0-9_-]{43})/u)?.[1] ?? null;
  if (path === '/signup') return [await signupPage(), 'Регистрация'];
  if (path.startsWith('/confirm')) return [await confirmPage(token ?? ''), 'Подтверждение адреса'];
  if (path === '/reset' || path.startsWith('/reset?')) return [await resetPage(token), token ? 'Новый пароль' : 'Сброс пароля'];
  return null;
}

async function route(): Promise<void> {
  const mine = ++seq;
  const open = await publicPage(location.hash.replace(/^#/u, ''));
  if (open) {
    if (mine !== seq) return;
    // Nothing of a signed-in page stays around a public one.
    loginBox.hidden = true;
    out.hidden = true;
    who.textContent = '';
    app.replaceChildren(open[0]);
    document.title = `${open[1]} — clx`;
    app.hidden = false;
    return;
  }
  try {
    // Fresh each time: the plan's use (accounts, keys) changes with what the pages do.
    me = await get<Me>('/v1/me');
    const [el, title] = await page(location.hash.replace(/^#/u, '') || '/', mine);
    if (mine !== seq) return;
    loginBox.hidden = true;
    out.hidden = false;
    who.textContent = me.user.email;
    // A message a page left for its next drawing, shown once above it.
    app.replaceChildren(...(flash ? [h('div', { class: 'auth-status', 'data-type': 'error', role: 'alert' }, flash)] : []), el);
    flash = '';
    document.title = `${title} — clx`;
    app.hidden = false;
  } catch (e) {
    if (mine !== seq) return;
    if (e instanceof SignedOut) return showLogin();
    app.replaceChildren(h('div', { class: 'card' }, h('p', {}, failure(e)), h('p', {}, h('a', { href: '#/' }, '← На главную'))));
    app.hidden = false;
  }
}

$<HTMLFormElement>('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget as HTMLFormElement;
  const button = form.querySelector('button[type="submit"]') as HTMLButtonElement;
  const status = $('login-status');
  button.disabled = true;
  status.dataset.type = 'loading';
  status.textContent = 'Входим…';
  const error = await login($<HTMLInputElement>('email').value, $<HTMLInputElement>('password').value).catch(() => 'Сеть недоступна.');
  button.disabled = false;
  if (error) {
    status.dataset.type = 'error';
    status.textContent = error;
    return;
  }
  $<HTMLInputElement>('password').value = '';
  status.dataset.type = 'idle';
  status.textContent = '';
  void route();
});

$('password-toggle').addEventListener('click', () => {
  const input = $<HTMLInputElement>('password');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('password-toggle').setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
});

out.addEventListener('click', async () => {
  const button = out as HTMLButtonElement;
  button.disabled = true;
  const ok = await logout();
  button.disabled = false;
  if (!ok) {
    // The session lives on: the sign-in form now would only hide it.
    flash = 'Выйти не удалось — сессия не завершена. Проверьте сеть и попробуйте ещё раз.';
    return void route();
  }
  location.hash = '#/';
  showLogin();
});

$('theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('clx-theme', next);
  } catch {
    // private mode: the theme just isn't remembered
  }
});

window.addEventListener('hashchange', () => void route());
// A public page (an e-mail's link) opens signed out too; any other page without a session shows
// the sign-in form — route() finds that out itself.
void refresh().then(() => route());
