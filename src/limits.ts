// clx limits — the one place to change them (docs/spec.md §8).

export type Plan = 'free' | 'api';

export const LIMITS: Record<Plan, { cfAccounts: number; sites: number; links: number; rulesPerLink: number; apiKeys: number }> = {
  free: { cfAccounts: 1, sites: 10, links: 200, rulesPerLink: 10, apiKeys: 0 },
  api: { cfAccounts: 50, sites: 500, links: 10_000, rulesPerLink: 10, apiKeys: 5 },
};

export const planOf = (plan: string): Plan => (plan === 'api' ? 'api' : 'free');

/** Writes of totals a Cloudflare account may cost clx.cx in a UTC day (§8): beyond it only final
 *  days are taken. */
export const writeBudget = (plan: Plan, sites: number, links = 0) => 3000 + (plan === 'api' ? 110 * sites + 3 * links : 0);

/** Workers Free, per Cloudflare account and UTC day (§8) — what the upgrade advice measures against. */
export const CF_FREE = { requests: 100_000, writes: 100_000, reads: 5_000_000, size: 500 * 1024 * 1024 } as const;

/** Connected `free` accounts the service takes before the waiting list (§8). */
export const FREE_ACCOUNTS_CAP = 500;

/** API key scopes (§15). */
export const SCOPES = ['accounts', 'sites', 'links', 'reports'] as const;
export type Scope = (typeof SCOPES)[number];
