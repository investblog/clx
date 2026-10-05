// clx limits — the one place to change them (docs/spec.md §8).

export type Plan = 'free' | 'api';

export const LIMITS: Record<Plan, { cfAccounts: number; sites: number; links: number; rulesPerLink: number; apiKeys: number }> = {
  free: { cfAccounts: 1, sites: 10, links: 200, rulesPerLink: 10, apiKeys: 0 },
  api: { cfAccounts: 50, sites: 500, links: 10_000, rulesPerLink: 10, apiKeys: 5 },
};

export const planOf = (plan: string): Plan => (plan === 'api' ? 'api' : 'free');

/** Connected `free` accounts the service takes before the waiting list (§8). */
export const FREE_ACCOUNTS_CAP = 500;

/** API key scopes (§15). */
export const SCOPES = ['accounts', 'sites', 'links', 'reports'] as const;
export type Scope = (typeof SCOPES)[number];
