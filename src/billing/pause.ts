// The plan a user is on, and what of theirs works on it (docs/spec.md §18, ADR 0034). On `free`
// what is beyond free's limits is paused — chosen top down, so what is kept can work: the oldest
// Cloudflare account in service, then the oldest sites and links of that account, and the oldest
// key; external sites are Pro only. A paused site's or link's config row is withdrawn by the next
// sync (src/cf/sites.ts), a paused key is refused (src/v1/auth.ts). Pro clears every pause.
import { LIMITS } from '../limits';

interface Row {
  id: string;
  paused_at: number | null;
}

/** Ids whose pause changes: to pause (not paused yet) and to resume (paused, now kept). */
const changes = (rows: Row[], keep: Set<string>) => ({
  pause: rows.filter((r) => !keep.has(r.id) && r.paused_at === null).map((r) => r.id),
  resume: rows.filter((r) => keep.has(r.id) && r.paused_at !== null).map((r) => r.id),
});

/**
 * The hourly check (§18): users whose stored plan disagrees with their periods, or who are on free
 * with more working than free allows — a downgrade that failed halfway, an object made by a call
 * that began on Pro, a connect that finished after the pause — get `applyPlan` again.
 */
export async function reconcilePlans(env: { DB: D1Database }, now = Date.now()): Promise<number> {
  const f = LIMITS.free;
  const users = (
    await env.DB.prepare(
      `SELECT u.id FROM users u WHERE u.deleting_at IS NULL AND (
         u.replan_at IS NOT NULL
         OR (u.plan = 'api') != (u.plan_comp = 1 OR EXISTS (SELECT 1 FROM pro_periods WHERE user_id = u.id AND end_day IS NULL))
         OR (u.plan = 'free' AND (
           (SELECT count(*) FROM edge_accounts WHERE user_id = u.id AND state != 'pending' AND paused_at IS NULL) > ?1
           OR (SELECT count(*) FROM sites WHERE user_id = u.id AND state != 'deleted' AND paused_at IS NULL) > ?2
           OR EXISTS (SELECT 1 FROM sites WHERE user_id = u.id AND state != 'deleted' AND paused_at IS NULL AND kind = 'external')
           OR (SELECT count(*) FROM links WHERE user_id = u.id AND state != 'deleted' AND paused_at IS NULL) > ?3
           OR (SELECT count(*) FROM api_keys WHERE user_id = u.id AND revoked_at IS NULL AND paused_at IS NULL) > ?4))
         OR (u.plan = 'api' AND (
           EXISTS (SELECT 1 FROM edge_accounts WHERE user_id = u.id AND paused_at IS NOT NULL)
           OR EXISTS (SELECT 1 FROM sites WHERE user_id = u.id AND paused_at IS NOT NULL AND state != 'deleted')
           OR EXISTS (SELECT 1 FROM links WHERE user_id = u.id AND paused_at IS NOT NULL AND state != 'deleted')
           OR EXISTS (SELECT 1 FROM api_keys WHERE user_id = u.id AND revoked_at IS NULL AND paused_at IS NOT NULL))))
       LIMIT 50`,
    )
      .bind(f.cfAccounts, f.sites, f.links, f.apiKeys)
      .all<{ id: number }>()
  ).results;
  for (const u of users)
    await applyPlan(env, u.id, now).then(
      () => env.DB.prepare('UPDATE users SET replan_at = NULL WHERE id = ?').bind(u.id).run(),
      (e: unknown) => console.error('plan', u.id, e instanceof Error ? e.message : e),
    );
  // A grace left behind by a period closed meanwhile (§18): no period, no grace.
  await env.DB.prepare('UPDATE users SET grace_since = NULL WHERE grace_since IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pro_periods WHERE user_id = users.id AND end_day IS NULL)').run();
  return users.length;
}

/**
 * Around a delete or a revoke on free: the next paused object may work now. `markReplan` first —
 * before the delete — so a run that dies after it leaves the user to the hourly check;
 * `resumeNext` after, which clears the mark once the plan is applied.
 */
export async function markReplan(env: { DB: D1Database }, p: { userId: number; plan: string }): Promise<void> {
  if (p.plan !== 'api') await env.DB.prepare('UPDATE users SET replan_at = ? WHERE id = ?').bind(Date.now(), p.userId).run();
}
export async function resumeNext(env: { DB: D1Database }, p: { userId: number; plan: string }): Promise<void> {
  if (p.plan === 'api') return;
  await applyPlan(env, p.userId);
  await env.DB.prepare('UPDATE users SET replan_at = NULL WHERE id = ?').bind(p.userId).run();
}

/**
 * Set the user's plan from their periods and `plan_comp`, then pause or resume to match it. Safe to
 * run again: only rows whose pause changes are written, each account's in one batch with the next
 * config revision, so its worker is synced.
 */
export async function applyPlan(env: { DB: D1Database }, userId: number, now = Date.now()): Promise<'free' | 'api'> {
  const db = env.DB;
  const user = await db
    .prepare('SELECT plan, plan_comp, EXISTS (SELECT 1 FROM pro_periods WHERE user_id = ?1 AND end_day IS NULL) AS open FROM users WHERE id = ?1')
    .bind(userId)
    .first<{ plan: string; plan_comp: number; open: number }>();
  if (!user) return 'free';
  const plan = user.plan_comp || user.open ? 'api' : 'free';
  if (user.plan !== plan) await db.prepare('UPDATE users SET plan = ? WHERE id = ?').bind(plan, userId).run();

  const accounts = (await db.prepare("SELECT id, state, paused_at FROM edge_accounts WHERE user_id = ? AND state != 'pending' ORDER BY created_at, id").bind(userId).all<Row & { state: string }>()).results;
  const free = LIMITS.free;
  const kept = plan === 'api' ? null : (accounts.find((a) => a.state === 'ready' || a.state === 'no_connection') ?? accounts[0])?.id;
  for (const a of accounts) {
    const sites = (await db.prepare("SELECT id, paused_at, kind FROM sites WHERE account_id = ? AND state != 'deleted' ORDER BY created_at, id").bind(a.id).all<Row & { kind: string }>()).results;
    const links = (await db.prepare("SELECT id, paused_at FROM links WHERE account_id = ? AND state != 'deleted' ORDER BY created_at, id").bind(a.id).all<Row>()).results;
    const all = (rows: Row[]) => new Set(rows.map((r) => r.id));
    const first = (rows: Row[], n: number) => new Set(rows.slice(0, n).map((r) => r.id));
    // External sites are Pro only (§5): free keeps zone sites alone.
    const keepSites = plan === 'api' ? all(sites) : a.id === kept ? first(sites.filter((s) => s.kind !== 'external'), free.sites) : new Set<string>();
    const keepLinks = plan === 'api' ? all(links) : a.id === kept ? first(links, free.links) : new Set<string>();
    const accountPaused = plan === 'free' && a.id !== kept;
    const s = changes(sites, keepSites);
    const l = changes(links, keepLinks);
    const accountChanges = accountPaused !== (a.paused_at !== null);
    if (!s.pause.length && !s.resume.length && !l.pause.length && !l.resume.length && !accountChanges) continue;
    const rev = '(SELECT config_revision FROM edge_accounts WHERE id = ?3)';
    await db.batch([
      db.prepare('UPDATE edge_accounts SET config_revision = config_revision + 1, paused_at = ? WHERE id = ?').bind(accountPaused ? (a.paused_at ?? now) : null, a.id),
      db.prepare(`UPDATE sites SET paused_at = ?1, revision = ${rev} WHERE id IN (SELECT value FROM json_each(?2))`).bind(now, JSON.stringify(s.pause), a.id),
      db.prepare('UPDATE sites SET paused_at = NULL, revision = (SELECT config_revision FROM edge_accounts WHERE id = ?2) WHERE id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(s.resume), a.id),
      db.prepare(`UPDATE links SET paused_at = ?1, revision = ${rev} WHERE id IN (SELECT value FROM json_each(?2))`).bind(now, JSON.stringify(l.pause), a.id),
      db.prepare('UPDATE links SET paused_at = NULL, revision = (SELECT config_revision FROM edge_accounts WHERE id = ?2) WHERE id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(l.resume), a.id),
    ]);
  }

  const keys = (await db.prepare('SELECT id, paused_at FROM api_keys WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at, id').bind(userId).all<Row>()).results;
  const k = changes(keys, plan === 'api' ? new Set(keys.map((r) => r.id)) : new Set(keys.slice(0, LIMITS.free.apiKeys).map((r) => r.id)));
  if (k.pause.length || k.resume.length)
    await db.batch([
      db.prepare('UPDATE api_keys SET paused_at = ? WHERE id IN (SELECT value FROM json_each(?))').bind(now, JSON.stringify(k.pause)),
      db.prepare('UPDATE api_keys SET paused_at = NULL WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(k.resume)),
    ]);
  return plan;
}
