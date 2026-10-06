// The page's entry: sign-in, the hash router over the pages, the theme.
import { accountPage, accountsPage, connectPage, failure, keysPage } from './accounts';
import { get, login, logout, refresh, SignedOut, type Me } from './api';
import { h } from './dom';
import { reportPage } from './report';
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

const go = (hash: string) => {
  if (location.hash === hash) void route();
  else location.hash = hash;
};

/** The page for the address: #/ accounts and sites, #/connect, #/accounts/<id>, #/keys, #/sites/new, #/sites/<id>. */
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
  const report = path.match(/^\/sites\/([\w-]+)\/report(?:\?p=([\w]+))?$/u);
  if (report) return [await reportPage(report[1]!, report[2] ?? 'today'), 'Отчёт'];
  const site = path.match(/^\/sites\/([\w-]+)$/u);
  if (site) return [await sitePage(site[1]!, live, redraw), 'Сайт'];
  const [accounts, sites] = await Promise.all([accountsPage(me!), sitesBlock()]);
  return [h('div', {}, accounts, sites), 'clx'];
}

async function route(): Promise<void> {
  const mine = ++seq;
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
  await logout();
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
void refresh().then((ok) => (ok ? route() : showLogin()));
