// The app's language (ADR 0015): the address's (`<html lang>` of /app or /ru/app) until the person
// signs in, then their account's (`/v1/me` → `user.locale`). `t` is the dictionary of the language in
// use; pages read it while they draw, so a change of language takes effect on the next drawing.
import { en } from './en';
import { ru, type Dict } from './ru';

export type Locale = 'en' | 'ru';
export const LOCALES: readonly Locale[] = ['en', 'ru'];
const DICTS: Record<Locale, Dict> = { en, ru };

const asLocale = (v: unknown): Locale => (v === 'ru' ? 'ru' : 'en');
/** The language of the address this page was opened at. */
export const pageLocale: Locale = asLocale(document.documentElement.lang);
export let locale: Locale = pageLocale;
export let t: Dict = DICTS[locale];

export function setLocale(next: unknown): void {
  locale = asLocale(next);
  t = DICTS[locale];
  document.documentElement.lang = locale;
}

export const dictOf = (l: Locale): Dict => DICTS[l];

/** The app of a language: `/app`, `/ru/app`. */
export const appPath = (l: Locale) => (l === 'en' ? '/app' : `/${l}/app`);
/** A page of the site in the language in use: `/privacy`, `/ru/privacy`. */
export const sitePath = (slug: string) => (locale === 'en' ? slug : `/${locale}${slug}`);

const tag = () => (locale === 'ru' ? 'ru-RU' : 'en-GB');
export const when = (iso: string | null | undefined) => (iso ? `${new Date(iso).toLocaleString(tag(), { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' })} UTC` : '—');
export const num = (n: number) => n.toLocaleString(tag());

/** A label of one of the dictionary's code maps, or the code itself when it has none. */
const pick = (map: Record<string, string>, code: string) => map[code] ?? code;
export const errorText = (code: string | undefined, fallback: string) => (code && (t.errors as Record<string, string>)[code]) || fallback;
export function warningText(w: string): string {
  const [code, arg] = w.split(':');
  if (code === 'old_token_not_deleted') return t.oldTokenNotDeleted(arg ?? '');
  return pick(t.warnings, code ?? w);
}
export const label = {
  accountState: (s: string) => pick(t.accountState, s),
  step: (s: string) => pick(t.step, s),
  operation: (s: string) => pick(t.operation, s),
  adviceLevel: (s: string) => pick(t.adviceLevel, s),
  metric: (s: string) => pick(t.metric, s),
  drop: (s: string) => pick(t.drop, s),
  scope: (s: string) => pick(t.scope, s),
};
