// The home page's sign-in card (ADR 0026): sign-in, sign-up and the password reset request as three
// forms of one card, shown by the address's fragment (#login, #register, #recover) — catchall.in's way.
// Printed at build time from the app's dictionaries (ui/i18n), so the forms say what the app says;
// what the script needs later (error texts, the messages after sending) travels in data-t, since the
// CSP allows no inline script. site/auth-client.ts runs it. The e-mails' links (confirmation, a new
// password) still open the app (/app#/confirm, /app#/reset?t=).
import { en } from '../ui/i18n/en.ts';
import { ru } from '../ui/i18n/ru.ts';
import { escapeHtml } from './layout.ts';
import type { Locale } from './pages.ts';
import { appPathFor, pathFor } from './urls.ts';

const DICTS = { en, ru };
/** The server's minimum (src/auth/signup.ts PASSWORD_MIN; test/site.test.ts holds them equal). */
export const PASSWORD_MIN = 10;

/** The texts the script fills in after build time; `{n}` and `{email}` are replaced there. */
function scriptTexts(locale: Locale): Record<string, unknown> {
  const t = DICTS[locale];
  return {
    errors: t.auth.errors,
    failed: t.auth.failed,
    network: t.common.network,
    invalid: t.login.invalid,
    tooMany: t.login.tooMany('{n}' as unknown as number),
    busy: t.login.busy,
    sending: t.auth.sending,
    waitHuman: t.auth.waitHuman,
    closed: { register: t.auth.closed(t.titles.signUp), recover: t.auth.closed(t.titles.reset) },
    signedUp: t.auth.signedUp('{email}'),
    signedUpNext: t.auth.signedUpNext,
    linkSent: t.auth.linkSent,
    show: t.login.show,
    hide: t.login.hide,
  };
}

const field = (id: string, label: string, input: string, hint = '') =>
  `<div class="field"><label class="field-label" for="${id}">${escapeHtml(label)}</label>${input}${hint ? `<p class="field-hint">${escapeHtml(hint)}</p>` : ''}</div>`;
const email = (id: string) => `<input class="input" id="${id}" name="email" type="email" autocomplete="email" required>`;
const status = '<div class="auth-status" data-type="idle" role="status" aria-live="polite" data-msg></div>';
const submit = (text: string) => `<div class="auth-actions"><button type="submit" class="btn btn--primary">${escapeHtml(text)}</button></div>`;

/** The card, hidden until the fragment names one of its forms. */
export function authCard(locale: Locale): string {
  const t = DICTS[locale];
  const [before, terms, and, privacy, after] = t.auth.signUpConsent;
  const consent = `${escapeHtml(before)}<a href="${pathFor('/terms', locale)}">${escapeHtml(terms ?? '')}</a>${escapeHtml(and ?? '')}<a href="${pathFor('/privacy', locale)}">${escapeHtml(privacy ?? '')}</a>${escapeHtml(after ?? '')}`;
  const eye = '<svg class="icon" aria-hidden="true"><use href="/icons.svg#i-mono-eye"></use></svg>';
  // method="post": a submit before the script has bound the form must not put the password in the address.
  return `<section class="card auth-card auth" data-auth data-app="${appPathFor(locale)}" data-t="${escapeHtml(JSON.stringify(scriptTexts(locale)))}" hidden>
  <div class="auth__tabs"><a href="#login" data-tab="login">${escapeHtml(t.auth.signIn)}</a><a href="#register" data-tab="register">${escapeHtml(t.auth.signUp)}</a></div>
  <form class="auth-form" method="post" data-auth-form="login" hidden>
    ${field('in-email', t.login.email, email('in-email'))}
    <div class="field"><label class="field-label" for="in-password">${escapeHtml(t.login.password)}</label><div class="password-field"><input class="input" id="in-password" name="password" type="password" autocomplete="current-password" required><button type="button" class="password-toggle" aria-label="${escapeHtml(t.login.show)}" data-toggle>${eye}</button></div></div>
    ${status}
    ${submit(t.login.submit)}
    <p class="muted text-sm"><a href="#recover">${escapeHtml(t.auth.forgot)}</a></p>
  </form>
  <form class="auth-form" method="post" data-auth-form="register" hidden>
    ${field('up-email', t.login.email, email('up-email'))}
    ${field('up-password', t.login.password, `<input class="input" id="up-password" name="password" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN}" required>`,t.auth.passwordHint(PASSWORD_MIN))}
    <div class="turnstile" data-turnstile></div>
    ${status}
    ${submit(t.auth.signUpSubmit)}
    <p class="muted text-sm">${consent}</p>
  </form>
  <form class="auth-form" method="post" data-auth-form="recover" hidden>
    <h2 class="h4">${escapeHtml(t.titles.reset)}</h2>
    ${field('rc-email', t.login.email, email('rc-email'))}
    <div class="turnstile" data-turnstile></div>
    ${status}
    ${submit(t.auth.sendLink)}
    <p class="muted text-sm"><a href="#login">${escapeHtml(t.auth.signIn)}</a></p>
  </form>
</section>`;
}
