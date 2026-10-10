// The words of clx's e-mails, one object per language with the same shape: a text missing in one
// language fails `tsc`. The language is the user's (`users.locale`, ADR 0015); the links lead to the
// app of that language.
import type { Metric } from './advice';
import { appOrigin } from './mail';
import type { Env } from './types';

export type Locale = 'en' | 'ru';
export const LOCALES: readonly Locale[] = ['en', 'ru'];
export const localeOf = (v: unknown): Locale => (v === 'ru' ? 'ru' : 'en');

/** The app of a language: `/app` in English, `/ru/app` in Russian; `hash` is the page (`#/reset`). */
export const appUrl = (env: Env, locale: Locale, hash = '') => `${appOrigin(env)}${locale === 'en' ? '' : `/${locale}`}/app${hash}`;

interface Mail {
  subject: string;
  text: string;
}
/** The advice e-mail's facts: the account, the metric with its peak and limit, the forecast. */
export interface AdviceFacts {
  name: string;
  over: boolean;
  metric: Metric | null;
  value: number;
  limit: number;
  forecast: string | null;
  /** Only the database grows: shorter hourly retention would help, not a paid plan. */
  suggest: boolean;
  link: string;
}

export interface MailText {
  confirm(link: string): Mail;
  known(signIn: string, reset: string): Mail;
  reset(link: string): Mail;
  renew(name: string, until: number, link: string): Mail;
  silence(name: string, link: string): Mail;
  revoked(name: string, link: string): Mail;
  advice(f: AdviceFacts): Mail;
}

const date = (locale: Locale, at: number) => new Date(at).toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
const num = (locale: Locale, n: number) => n.toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US');

const EN_METRIC: Record<Metric, string> = { requests: 'worker requests a day', writes: 'D1 writes a day', reads: 'D1 reads a day', size: 'the size of the clx-edge database' };
const RU_METRIC: Record<Metric, string> = { requests: 'запросы к воркерам за сутки', writes: 'записи D1 за сутки', reads: 'чтения D1 за сутки', size: 'размер базы clx-edge' };

const en: MailText = {
  confirm: (link) => ({
    subject: 'clx: confirm your address',
    text: `Hello,\n\nTo confirm your address for clx, open this link (it works for 24 hours):\n${link}\n\nIf you did not sign up for clx, just delete this e-mail.\n`,
  }),
  known: (signIn, reset) => ({
    subject: 'clx: you already have an account',
    text: `Hello,\n\nSomeone (perhaps you) tried to sign up for clx with this address, but you already have an account.\nSign in: ${signIn}\nForgot the password: ${reset}\n\nIf it was not you, there is nothing to do.\n`,
  }),
  reset: (link) => ({
    subject: 'clx: password reset',
    text: `Hello,\n\nTo set a new password for clx, open this link (it works for an hour):\n${link}\n\nThe reset ends every open session. If you did not ask for it, just delete this e-mail — the password stays as it is.\n`,
  }),
  renew: (name, until, link) => ({
    subject: `clx: renew the connection of "${name}"`,
    text: `Hello,\n\nThe token clx works with in the Cloudflare account "${name}" is valid until ${date('en', until)}. After that clx cannot update the worker, add sites and links or read report breakdowns.\nTo renew it, create a new bootstrap token and paste it on the account's page: ${link}\n`,
  }),
  silence: (name, link) => ({
    subject: `clx: no word from the worker in "${name}"`,
    text: `Hello,\n\nThe clx-edge worker in the Cloudflare account "${name}" has sent no totals for more than a day. The counter and the links most likely work, but the totals on clx.cx are not updated.\nCommon causes: the worker or its database was deleted in Cloudflare, the token was revoked, its cron does not fire.\n\nThe account's state: ${link}\n`,
  }),
  revoked: (name, link) => ({
    subject: `clx: the token for "${name}" no longer works`,
    text: `Hello,\n\nCloudflare no longer accepts the token clx worked with in the account "${name}": it was revoked or it expired. The counter and the links in the account keep working, but clx cannot update the worker, add sites and links or read report breakdowns.\nTo restore the connection, create a new bootstrap token and paste it on the account's page: ${link}\n`,
  }),
  advice: (f) => {
    const what = f.metric ? `${EN_METRIC[f.metric]}: ${num('en', f.value)} of ${num('en', f.limit)}${f.forecast ? `, the limit around ${f.forecast}` : ''}` : '';
    const help = f.suggest ? 'Only the database grows: keeping the hourly details for fewer days would help.\n' : f.over ? 'Moving this account to Workers Paid ($5 a month) lifts the limit.\n' : 'It is worth moving it to Workers Paid ($5 a month) in good time.\n';
    return f.over
      ? {
          subject: `clx: "${f.name}" hit a Cloudflare limit`,
          text: `Hello,\n\nThe Cloudflare account "${f.name}" hit a limit of the free Workers plan — ${what}.\nOver the limit Cloudflare refuses to run workers: the counter and the links may not answer until the end of the day (UTC).\n${help}\nDetails: ${f.link}\n`,
        }
      : {
          subject: `clx: "${f.name}" will soon hit a Cloudflare limit`,
          text: `Hello,\n\nThe Cloudflare account "${f.name}" will soon hit a limit of the free Workers plan — ${what}.\n${help}\nDetails: ${f.link}\n`,
        };
  },
};

const ru: MailText = {
  confirm: (link) => ({
    subject: 'clx: подтвердите адрес',
    text: `Здравствуйте!\n\nЧтобы подтвердить адрес для clx, откройте ссылку (действует 24 часа):\n${link}\n\nЕсли вы не регистрировались на clx, просто удалите это письмо.\n`,
  }),
  known: (signIn, reset) => ({
    subject: 'clx: у вас уже есть аккаунт',
    text: `Здравствуйте!\n\nКто-то (возможно, вы) пытался зарегистрироваться на clx с этим адресом, но аккаунт у вас уже есть.\nВойти: ${signIn}\nЗабыли пароль: ${reset}\n\nЕсли это были не вы, ничего делать не нужно.\n`,
  }),
  reset: (link) => ({
    subject: 'clx: сброс пароля',
    text: `Здравствуйте!\n\nЧтобы задать новый пароль для clx, откройте ссылку (действует час):\n${link}\n\nПосле сброса все открытые сессии закончатся. Если вы не просили сброс, просто удалите это письмо — пароль не изменится.\n`,
  }),
  renew: (name, until, link) => ({
    subject: `clx: продлите подключение «${name}»`,
    text: `Здравствуйте!\n\nТокен, которым clx работает в аккаунте Cloudflare «${name}», действует до ${date('ru', until)}. После этого clx не сможет обновлять воркер, добавлять сайты и ссылки и читать разбивки отчётов.\nЧтобы продлить, создайте новый bootstrap-токен и вставьте его на странице аккаунта: ${link}\n`,
  }),
  silence: (name, link) => ({
    subject: `clx: нет связи с воркером в «${name}»`,
    text: `Здравствуйте!\n\nВоркер clx-edge в аккаунте Cloudflare «${name}» не присылал итоги больше суток. Счётчик и ссылки, скорее всего, работают, но итоги на clx.cx не обновляются.\nЧастые причины: воркер или его база удалены в Cloudflare, отозван токен, не срабатывает его крон.\n\nСостояние аккаунта: ${link}\n`,
  }),
  revoked: (name, link) => ({
    subject: `clx: токен для «${name}» больше не работает`,
    text: `Здравствуйте!\n\nCloudflare больше не принимает токен, которым clx работал в аккаунте «${name}»: его отозвали или он истёк. Счётчик и ссылки в аккаунте продолжают работать, но clx не может обновлять воркер, добавлять сайты и ссылки и читать разбивки отчётов.\nЧтобы вернуть связь, создайте новый bootstrap-токен и вставьте его на странице аккаунта: ${link}\n`,
  }),
  advice: (f) => {
    const what = f.metric ? `${RU_METRIC[f.metric]}: ${num('ru', f.value)} из ${num('ru', f.limit)}${f.forecast ? `, к пределу — около ${f.forecast}` : ''}` : '';
    const help = f.suggest ? 'Дело в размере базы: помогло бы хранить почасовые детали короче.\n' : f.over ? 'Переход этого аккаунта на Workers Paid ($5 в месяц) снимает лимит.\n' : 'Стоит заранее перевести его на Workers Paid ($5 в месяц).\n';
    return f.over
      ? {
          subject: `clx: «${f.name}» упёрся в лимит Cloudflare`,
          text: `Здравствуйте!\n\nАккаунт Cloudflare «${f.name}» упёрся в лимит бесплатного тарифа Workers — ${what}.\nСверх лимита Cloudflare отказывает в работе воркерам: счётчик и ссылки могут не отвечать до конца суток (UTC).\n${help}\nПодробности: ${f.link}\n`,
        }
      : {
          subject: `clx: «${f.name}» скоро упрётся в лимит Cloudflare`,
          text: `Здравствуйте!\n\nАккаунт Cloudflare «${f.name}» скоро упрётся в лимит бесплатного тарифа Workers — ${what}.\n${help}\nПодробности: ${f.link}\n`,
        };
  },
};

export const MAIL: Record<Locale, MailText> = { en, ru };

/** The user's address and language, for a notice about their own account. */
export const recipient = (env: Env, userId: number) => env.DB.prepare('SELECT email, locale FROM users WHERE id = ?').bind(userId).first<{ email: string; locale: Locale }>();
