// Pages of stage 6b (docs/spec.md §9) a signed-out visitor opens: sign-up, the confirmation link,
// the password reset (asking for the e-mail, and setting a new password from its link). They call
// /auth, not /v1; sign-up and reset carry a Turnstile token.
import { h } from './dom';

interface Config {
  turnstile_site_key: string | null;
  password_min: number;
}
declare global {
  interface Window {
    turnstile?: { render(el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void; language?: string }): string; reset(id: string): void };
  }
}

const ERRORS: Record<string, string> = {
  invalid_email: 'Проверьте адрес почты.',
  weak_password: 'Пароль короче нужного.',
  turnstile_failed: 'Проверка «я не робот» не прошла — попробуйте ещё раз.',
  invalid_token: 'Ссылка недействительна: она устарела или уже использована. Запросите новую.',
  rate_limit_exceeded: 'Слишком много попыток — подождите минуту.',
  not_configured: 'Регистрация пока не открыта.',
  invalid_request: 'Что-то не так с запросом — обновите страницу.',
};

async function post(path: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: res.ok, error: json.error };
  } catch {
    return { ok: false, error: 'network' };
  }
}
const say = (status: HTMLElement, type: 'error' | 'success' | 'loading' | 'idle', text: string) => {
  status.dataset.type = type;
  status.textContent = text;
};
const errorOf = (e: string | undefined) => (e && ERRORS[e]) || (e === 'network' ? 'Сеть недоступна. Попробуйте ещё раз.' : 'Не получилось. Попробуйте ещё раз.');

let config: Promise<Config> | null = null;
const configOf = () => (config ??= fetch('/auth/config').then((r) => r.json() as Promise<Config>));

/** The Turnstile widget in `box`; `token()` is the current answer, or '' until there is one. */
async function turnstile(box: HTMLElement): Promise<{ token: () => string; reset: () => void }> {
  const { turnstile_site_key: sitekey } = await configOf();
  let value = '';
  if (!sitekey) return { token: () => '', reset: () => undefined };
  if (!window.turnstile)
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('turnstile'));
      document.head.append(s);
    }).catch(() => undefined);
  const id = window.turnstile?.render(box, { sitekey, language: 'ru', callback: (t) => (value = t), 'expired-callback': () => (value = ''), 'error-callback': () => (value = '') });
  return {
    token: () => value,
    reset: () => {
      value = '';
      if (id) window.turnstile?.reset(id);
    },
  };
}

const card = (title: string, ...children: (Node | null)[]) => h('section', { class: 'auth-card login' }, h('h1', { class: 'h3' }, title), ...children);
const field = (label: string, input: HTMLInputElement, hint?: string) => h('div', { class: 'field' }, h('label', { class: 'field-label', for: input.id }, label), input, hint ? h('p', { class: 'field-hint' }, hint) : null);
const footer = () =>
  h('p', { class: 'muted text-sm' }, h('a', { href: '#/' }, 'Вход'), ' · ', h('a', { href: '#/signup' }, 'Регистрация'), ' · ', h('a', { href: '#/reset' }, 'Забыли пароль?'), ' · ', h('a', { href: '/privacy' }, 'Конфиденциальность'), ' · ', h('a', { href: '/terms' }, 'Условия'));

/** Without Turnstile set up the server refuses sign-up and reset (`not_configured`): say so at once. */
const closed = (title: string, what: string) => card(title, h('p', {}, `${what} пока не работает: сервис ещё настраивается. Загляните позже.`), footer());

export async function signupPage(): Promise<HTMLElement> {
  const { password_min: min, turnstile_site_key: sitekey } = await configOf();
  if (!sitekey) return closed('Регистрация', 'Регистрация');
  const email = h('input', { class: 'input', id: 'su-email', type: 'email', autocomplete: 'email', required: '' });
  const password = h('input', { class: 'input', id: 'su-password', type: 'password', autocomplete: 'new-password', required: '', minlength: String(min) });
  const box = h('div', { class: 'turnstile' });
  const status = h('div', { class: 'auth-status', 'data-type': 'idle', role: 'status', 'aria-live': 'polite' });
  const button = h('button', { type: 'submit', class: 'btn btn--primary' }, 'Зарегистрироваться');
  const form = h(
    'form',
    { class: 'auth-form' },
    field('Email', email),
    field('Пароль', password, `Не короче ${min} символов.`),
    box,
    status,
    h('div', { class: 'auth-actions' }, button),
    h('p', { class: 'muted text-sm' }, 'Регистрируясь, вы принимаете ', h('a', { href: '/terms' }, 'условия'), ' и ', h('a', { href: '/privacy' }, 'политику конфиденциальности'), '.'),
  );
  const widget = await turnstile(box);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!widget.token()) return say(status, 'error', 'Дождитесь проверки «я не робот».');
    button.disabled = true;
    say(status, 'loading', 'Отправляем…');
    const r = await post('/auth/signup', { email: email.value, password: password.value, turnstile: widget.token() });
    button.disabled = false;
    widget.reset();
    if (!r.ok) return say(status, 'error', errorOf(r.error));
    form.replaceWith(h('div', { class: 'stack stack--sm' }, h('p', {}, `Готово. Если адрес ${email.value.trim()} может получить письмо, в нём ссылка для подтверждения — она действует сутки.`), h('p', { class: 'muted text-sm' }, 'Войти можно уже сейчас; подключить аккаунт Cloudflare — после подтверждения адреса.')));
  });
  return card('Регистрация', form, footer());
}

export async function confirmPage(token: string): Promise<HTMLElement> {
  const r = await post('/auth/confirm', { token });
  return card('Подтверждение адреса', h('p', {}, r.ok ? 'Адрес подтверждён. Теперь можно подключить аккаунт Cloudflare.' : errorOf(r.error)), h('p', {}, h('a', { class: 'btn btn--primary', href: '#/' }, r.ok ? 'Перейти в clx' : 'На главную')), footer());
}

/** Without a token: ask for the e-mail. With one (the e-mail's link): set a new password. */
export async function resetPage(token: string | null): Promise<HTMLElement> {
  const { password_min: min } = await configOf();
  const status = h('div', { class: 'auth-status', 'data-type': 'idle', role: 'status', 'aria-live': 'polite' });
  if (token) {
    const password = h('input', { class: 'input', id: 'rs-password', type: 'password', autocomplete: 'new-password', required: '', minlength: String(min) });
    const button = h('button', { type: 'submit', class: 'btn btn--primary' }, 'Сохранить пароль');
    const form = h('form', { class: 'auth-form' }, field('Новый пароль', password, `Не короче ${min} символов. После сохранения все открытые сессии закончатся.`), status, h('div', { class: 'auth-actions' }, button));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      button.disabled = true;
      const r = await post('/auth/reset/confirm', { token, password: password.value });
      button.disabled = false;
      if (!r.ok) return say(status, 'error', errorOf(r.error));
      form.replaceWith(h('p', {}, 'Пароль сохранён. Войдите с новым паролем.'));
    });
    return card('Новый пароль', form, footer());
  }
  if (!(await configOf()).turnstile_site_key) return closed('Сброс пароля', 'Сброс пароля');
  const email = h('input', { class: 'input', id: 'rs-email', type: 'email', autocomplete: 'email', required: '' });
  const box = h('div', { class: 'turnstile' });
  const button = h('button', { type: 'submit', class: 'btn btn--primary' }, 'Прислать ссылку');
  const form = h('form', { class: 'auth-form' }, field('Email', email), box, status, h('div', { class: 'auth-actions' }, button));
  const widget = await turnstile(box);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!widget.token()) return say(status, 'error', 'Дождитесь проверки «я не робот».');
    button.disabled = true;
    const r = await post('/auth/reset', { email: email.value, turnstile: widget.token() });
    button.disabled = false;
    widget.reset();
    if (!r.ok) return say(status, 'error', errorOf(r.error));
    form.replaceWith(h('p', {}, 'Если для этого адреса есть аккаунт, на него ушло письмо со ссылкой — она действует час.'));
  });
  return card('Сброс пароля', form, footer());
}
