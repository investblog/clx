export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  /** Worker secret (scripts/secrets.mjs): the access-token key. */
  JWT_SECRET: string;
}
