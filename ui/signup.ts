// Pages a signed-out visitor opens (docs/spec.md §9): sign-in, sign-up, the confirmation link, the
// password reset (asking for the e-mail, and setting a new password from its link). They call /auth,
// not /v1; sign-up and reset carry a Turnstile token. In the address's language (ADR 0015); sign-up
// hands it to the account.
import { login } from './api';
import { h, s } from './dom';
import { appPath, LOCALES, locale, dictOf, sitePath, t } from './i18n';

interface Config {
  turnstile_site_key: string | null;
  password_min: number;
}
declare global {
  interface Window {
    turnstile?: { render(el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void; language?: string }): string; reset(id: string): void };
  }
}

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
const errorOf = (e: string | undefined) => (e && (t.auth.errors as Record<string, string>)[e]) || (e === 'network' ? t.common.network : t.auth.failed);
const statusBox = () => h('div', { class: 'auth-status', 'data-type': 'idle', role: 'status', 'aria-live': 'polite' });

let config: Promise<Config> | null = null;
const configOf = () => (config ??= fetch('/auth/config').then((r) => r.json() as Promise<Config>));

/** The Turnstile widget in `box`; `token()` is the current answer, or '' until there is one. */
async function turnstile(box: HTMLElement): Promise<{ token: () => string; reset: () => void }> {
  const { turnstile_site_key: sitekey } = await configOf();
  let value = '';
  if (!sitekey) return { token: () => '', reset: () => undefined };
  if (!window.turnstile)
    await new Promise<void>((resolve, reject) => {
      const el = document.createElement('script');
      el.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error('turnstile'));
      document.head.append(el);
    }).catch(() => undefined);
  const id = window.turnstile?.render(box, { sitekey, language: locale, callback: (v) => (value = v), 'expired-callback': () => (value = ''), 'error-callback': () => (value = '') });
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

/** Under every signed-out page: its sisters, the legal pages, and the app in the other language — at the same page. */
function footer(): HTMLElement {
  const other = LOCALES.filter((l) => l !== locale).map((l) => h('a', { href: `${appPath(l)}${location.hash}`, hreflang: l, lang: l }, dictOf(l).name));
  const links: [string, string][] = [
    ['#/', t.auth.signIn],
    ['#/signup', t.auth.signUp],
    ['#/reset', t.auth.forgot],
    [sitePath('/privacy'), t.auth.privacy],
    [sitePath('/terms'), t.auth.terms],
    [sitePath('/abuse'), t.auth.abuse],
  ];
  return h('p', { class: 'muted text-sm' }, ...links.flatMap(([href, text], i) => [i ? ' · ' : '', h('a', { href }, text)]), ...other.flatMap((a) => [' · ', a]));
}

/** Without Turnstile set up the server refuses sign-up and reset (`not_configured`): say so at once. */
const closed = (title: string) => card(title, h('p', {}, t.auth.closed(title)), footer());

/** The sign-in form; `done` runs once the session is there. */
export function loginPage(done: () => void, message = ''): HTMLElement {
  const email = h('input', { class: 'input', id: 'email', name: 'email', type: 'email', autocomplete: 'email', required: '' });
  const password = h('input', { class: 'input', id: 'password', name: 'password', type: 'password', autocomplete: 'current-password', required: '' });
  const toggle = h('button', { type: 'button', class: 'password-toggle', 'aria-label': t.login.show }, s('svg', { class: 'icon', 'aria-hidden': 'true' }, s('use', { href: '/icons.svg#i-mono-eye' })));
  toggle.addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-label', show ? t.login.hide : t.login.show);
  });
  const status = statusBox();
  if (message) say(status, 'error', message);
  const button = h('button', { type: 'submit', class: 'btn btn--primary' }, t.login.submit);
  const form = h(
    'form',
    { class: 'auth-form' },
    field(t.login.email, email),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'password' }, t.login.password), h('div', { class: 'password-field' }, password, toggle)),
    status,
    h('div', { class: 'auth-actions' }, button),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    say(status, 'loading', t.login.busy);
    const error = await login(email.value, password.value).catch(() => t.common.network);
    button.disabled = false;
    if (error) return say(status, 'error', error);
    password.value = '';
    say(status, 'idle', '');
    done();
  });
  queueMicrotask(() => email.focus());
  return card(t.titles.signIn, form, footer());
}

export async function signupPage(): Promise<HTMLElement> {
  const { password_min: min, turnstile_site_key: sitekey } = await configOf();
  if (!sitekey) return closed(t.titles.signUp);
  const email = h('input', { class: 'input', id: 'su-email', type: 'email', autocomplete: 'email', required: '' });
  const password = h('input', { class: 'input', id: 'su-password', type: 'password', autocomplete: 'new-password', required: '', minlength: String(min) });
  const box = h('div', { class: 'turnstile' });
  const status = statusBox();
  const button = h('button', { type: 'submit', class: 'btn btn--primary' }, t.auth.signUpSubmit);
  const [before, terms, and, privacy, after] = t.auth.signUpConsent;
  const form = h(
    'form',
    { class: 'auth-form' },
    field(t.login.email, email),
    field(t.login.password, password, t.auth.passwordHint(min)),
    box,
    status,
    h('div', { class: 'auth-actions' }, button),
    h('p', { class: 'muted text-sm' }, before, h('a', { href: sitePath('/terms') }, terms ?? ''), and, h('a', { href: sitePath('/privacy') }, privacy ?? ''), after),
  );
  const widget = await turnstile(box);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!widget.token()) return say(status, 'error', t.auth.waitHuman);
    button.disabled = true;
    say(status, 'loading', t.auth.sending);
    const r = await post('/auth/signup', { email: email.value, password: password.value, turnstile: widget.token(), locale });
    button.disabled = false;
    widget.reset();
    if (!r.ok) return say(status, 'error', errorOf(r.error));
    form.replaceWith(h('div', { class: 'stack stack--sm' }, h('p', {}, t.auth.signedUp(email.value.trim())), h('p', { class: 'muted text-sm' }, t.auth.signedUpNext)));
  });
  return card(t.titles.signUp, form, footer());
}

export async function confirmPage(token: string): Promise<HTMLElement> {
  const r = await post('/auth/confirm', { token });
  return card(t.titles.confirm, h('p', {}, r.ok ? t.auth.confirmed : errorOf(r.error)), h('p', {}, h('a', { class: 'btn btn--primary', href: '#/' }, r.ok ? t.auth.toApp : t.auth.toHome)), footer());
}

/** Without a token: ask for the e-mail. With one (the e-mail's link): set a new password. */
export async function resetPage(token: string | null): Promise<HTMLElement> {
  const { password_min: min } = await configOf();
  const status = statusBox();
  if (token) {
    const password = h('input', { class: 'input', id: 'rs-password', type: 'password', autocomplete: 'new-password', required: '', minlength: String(min) });
    const button = h('button', { type: 'submit', class: 'btn btn--primary' }, t.auth.savePassword);
    const form = h('form', { class: 'auth-form' }, field(t.auth.newPassword, password, t.auth.newPasswordHint(min)), status, h('div', { class: 'auth-actions' }, button));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      button.disabled = true;
      const r = await post('/auth/reset/confirm', { token, password: password.value });
      button.disabled = false;
      if (!r.ok) return say(status, 'error', errorOf(r.error));
      form.replaceWith(h('p', {}, t.auth.passwordSaved));
    });
    return card(t.titles.newPassword, form, footer());
  }
  if (!(await configOf()).turnstile_site_key) return closed(t.titles.reset);
  const email = h('input', { class: 'input', id: 'rs-email', type: 'email', autocomplete: 'email', required: '' });
  const box = h('div', { class: 'turnstile' });
  const button = h('button', { type: 'submit', class: 'btn btn--primary' }, t.auth.sendLink);
  const form = h('form', { class: 'auth-form' }, field(t.login.email, email), box, status, h('div', { class: 'auth-actions' }, button));
  const widget = await turnstile(box);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!widget.token()) return say(status, 'error', t.auth.waitHuman);
    button.disabled = true;
    const r = await post('/auth/reset', { email: email.value, turnstile: widget.token() });
    button.disabled = false;
    widget.reset();
    if (!r.ok) return say(status, 'error', errorOf(r.error));
    form.replaceWith(h('p', {}, t.auth.linkSent));
  });
  return card(t.titles.reset, form, footer());
}
