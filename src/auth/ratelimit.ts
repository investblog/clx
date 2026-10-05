// Attempt limits in KV, as in 301.st: a counter per key with a fixed
// window. KV is eventually consistent, so a burst from several edges can slip a few over — the limit
// slows guessing, it is not exact. Unlike 301.st it is on in every environment.
import type { Env } from '../types';

export const LIMITS = {
  loginByIp: { max: 5, windowSec: 300 },
  loginByEmail: { max: 10, windowSec: 900 },
  refreshByIp: { max: 20, windowSec: 60 },
} as const;

/** Counts one attempt; returns seconds to wait when the limit is used up, else null. */
export async function overLimit(env: Env, key: string, limit: { max: number; windowSec: number }, now: number): Promise<number | null> {
  const kvKey = `rl:${key.toLowerCase()}`;
  const t = Math.floor(now / 1000);
  const raw = await env.SESSIONS.get<{ count: number; resetAt: number }>(kvKey, 'json');
  const live = raw && raw.resetAt > t ? raw : { count: 0, resetAt: t + limit.windowSec };
  if (live.count >= limit.max) return Math.max(1, live.resetAt - t);
  await env.SESSIONS.put(kvKey, JSON.stringify({ count: live.count + 1, resetAt: live.resetAt }), { expirationTtl: limit.windowSec + 60 });
  return null;
}
