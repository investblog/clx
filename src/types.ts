export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  /** Requests per API key (§15): 120 a minute, per location. */
  API_LIMIT: RateLimit;
  /** Worker secrets (scripts/secrets.mjs): the access-token key and the token keyring. */
  JWT_SECRET: string;
  MASTER_KEYS: string;
  /** Where clx-edge workers report (`https://clx.cx/hook`), a var in wrangler.jsonc. */
  HOOK_URL: string;
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
