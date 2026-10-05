// The page's entry: sign-in, the signed-in page, the theme.
import { get, login, logout, refresh, SignedOut, type Me } from './api';
import { h } from './dom';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const loginBox = $('login');
const app = $('app');
const who = $('who');
const out = $('logout');
let me: Me | null = null;
let seq = 0; // a newer route wins: an older answer that arrives late is dropped

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

async function route(): Promise<void> {
  const mine = ++seq;
  try {
    me ??= await get<Me>('/auth/me');
    loginBox.hidden = true;
    out.hidden = false;
    who.textContent = me.user.email;
    // Sites, links and reports come with v2 (docs/spec.md §14, stages 2–5).
    app.replaceChildren(h('div', { class: 'card' }, h('p', {}, 'Здесь появятся ваши сайты и ссылки — clx v2 в разработке.')));
    document.title = 'clx';
    app.hidden = false;
  } catch (e) {
    if (mine !== seq) return;
    if (e instanceof SignedOut) return showLogin();
    app.replaceChildren(h('div', { class: 'card' }, h('p', {}, 'Не удалось загрузить данные. Обновите страницу.')));
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
