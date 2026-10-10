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
  /** Workers Static Assets (public/): the pages with a markdown copy are served through the Worker (§16). */
  ASSETS: Fetcher;
}

/** Who makes a /v1 call: a page session (all scopes) or an API key. */
export interface Principal {
  /** `u:<user id>` or `k:<key id>` — the idempotency and log identity. */
  id: string;
  userId: number;
  plan: string;
  via: 'session' | 'key';
  scopes: Set<string>;
  /** Cloudflare account ids the key may touch, or null for any. */
  allowAccounts: Set<string> | null;
}
