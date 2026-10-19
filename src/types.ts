import type { Mailer } from './mail';

export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  /** Requests per API key (§15): 120 a minute, per location. */
  API_LIMIT: RateLimit;
  /** Breakdown reports per user (§7): 30 a minute, per location. */
  REPORT_LIMIT: RateLimit;
  /** Worker secrets (scripts/secrets.mjs): the access-token key and the token keyring. */
  JWT_SECRET: string;
  MASTER_KEYS: string;
  /** Where clx-edge workers report (`https://clx.cx/hook`), a var in wrangler.jsonc. */
  HOOK_URL: string;
  /** Cloudflare Email Sending (§9); absent where it is not set up — nothing is sent then. */
  EMAIL?: Mailer;
  /** Turnstile (§9): the widget's site key (a var) and its secret (a Worker secret). */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  /** Sign-up and reset requests per IP (§9): a first line against floods, per location. */
  SIGNUP_LIMIT: RateLimit;
  /** Messages per Telegram user (§17): 30 a minute, per location — no write per message. */
  TG_LIMIT: RateLimit;
  /** The Telegram bot (§17): its token, the webhook's secret header and the key of the mailed
   *  codes' HMAC — Worker secrets set by scripts/tg-setup.mjs; without them the bot is off. */
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_CODE_KEY?: string;
  /** The support group's chat id (§17), a var in wrangler.jsonc: /support lands there, its admins
   *  answer by reply and run the operator commands. Without it /support is off. */
  TELEGRAM_SUPPORT_CHAT?: string;
  /** Workers Static Assets (public/): the pages with a markdown copy are served through the Worker (§16). */
  ASSETS: Fetcher;
}

/** Who makes a /v1 call: a page session (all scopes), an API key, or the Telegram bot for a linked
 *  user (§17: the routes of `BOT_ROUTES` only). */
export interface Principal {
  /** `u:<user id>`, `k:<key id>` or `t:<user id>` — the idempotency and log identity. */
  id: string;
  userId: number;
  plan: string;
  via: 'session' | 'key' | 'telegram';
  scopes: Set<string>;
  /** Cloudflare account ids the key may touch, or null for any. */
  allowAccounts: Set<string> | null;
}
