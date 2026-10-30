import { Hono } from 'hono';
import { admin } from './admin';
import { runAdvice } from './advice';
import { auth } from './auth/routes';
import { signup } from './auth/signup';
import { reconcile, RECONCILE_EVERY_MIN } from './billing/invoices';
import { expireStars, tellStarsReviews } from './billing/stars';
import { tellRefunds } from './billing/refunds';
import { sweepAccruals } from './partners/accrue';
import { refVisit } from './partners/codes';
import { tellPayouts } from './partners/wallet';
import { reconcilePlans } from './billing/pause';
import { GRACE_MS, LOW_DAYS, lowBalances, markLowTold, runCharges } from './billing/pro';
import { checkTokens } from './cf/connect';
import { runOperations } from './cf/deploy';
import { runLinkHosts } from './cf/links';
import { runSites } from './cf/sites';
import { hook } from './hook';
import { sendNotice } from './mail';
import { appUrl, MAIL, recipient } from './mail-text';
import { MARKDOWN_PAGES, servePage } from './markdown';
import { mcp } from './mcp/index';
import type { Env } from './types';
import { telegram, UPDATES_TTL } from './tg/webhook';
import { IDEM_TTL } from './v1/idempotency';
import { DELETING_TTL, v1 } from './v1/index';

const CF_CALLS_TTL = 90 * 86_400_000;
const HOURLY_HOURS = 48;
const DAILY_DAYS = 400;
const DEPARTED_TTL = 30 * 86_400_000;
/** Silence after which a worker is "no connection" (§4). */
const SILENCE = 26 * 3_600_000;
/** The minute of the hour the hourly jobs run in. */
const HOURLY_AT = 20;

/** How long before the working token expires the user is asked to renew it (§3 item 6). */
const RENEW_BEFORE = 30 * 86_400_000;

async function mailRenew(env: Env, a: { id: string; user_id: number; cf_account_id: string; cf_account_name: string | null; token_expires_at: number }, now: number): Promise<void> {
  const user = await recipient(env, a.user_id);
  if (!user) return;
  const mail = MAIL[user.locale].renew(a.cf_account_name ?? a.cf_account_id, a.token_expires_at, appUrl(env, user.locale, `#/accounts/${a.id}`));
  const sent = await sendNotice(env, user, mail.subject, mail.text, now);
  // Marked only once it went: a send that failed is tried again the next hour.
  if (sent) await env.DB.prepare('UPDATE edge_accounts SET renew_mailed_at = ? WHERE id = ?').bind(now, a.id).run();
}

/** The e-mail of §4: a worker silent for 26 hours. */
async function mailSilence(env: Env, a: { id: string; user_id: number; cf_account_id: string; cf_account_name: string | null }, now: number): Promise<void> {
  const user = await recipient(env, a.user_id);
  if (!user) return;
  const mail = MAIL[user.locale].silence(a.cf_account_name ?? a.cf_account_id, appUrl(env, user.locale, `#/accounts/${a.id}`));
  await sendNotice(env, user, mail.subject, mail.text, now, true);
}

/** Pro's balance runs low, its grace started, or it ran out and the account is back on free (§18):
 *  told once. */
async function mailPro(env: Env, userId: number, what: 'low' | 'grace' | 'ended', now: number): Promise<boolean> {
  const user = await recipient(env, userId);
  if (!user) return false;
  const link = appUrl(env, user.locale, '#/billing');
  const text = MAIL[user.locale];
  const mail = what === 'low' ? text.proLow(LOW_DAYS, link) : what === 'grace' ? text.proGrace(now + GRACE_MS, link) : text.proEnded(link);
  // The low-balance notice is tried again until its e-mail goes; the others go once, Telegram anyway.
  return sendNotice(env, user, mail.subject, mail.text, now, what !== 'low');
}

export const app = new Hono<{ Bindings: Env }>();

// Answers about a session or a user's data are never cached. Without its secrets the Worker refuses
// them: an empty JWT_SECRET would sign tokens anyone could forge, and without MASTER_KEYS no
// working token can be stored or opened.
for (const path of ['/auth/*', '/v1/*', '/admin/*', '/hook/*']) {
  app.use(path, async (c, next) => {
    if (!c.env.JWT_SECRET || (path !== '/auth/*' && !c.env.MASTER_KEYS)) {
      const error = path === '/auth/*' ? 'not_configured' : { code: 'not_configured', message: 'The service is not configured.' };
      return c.json({ error }, 503, { 'cache-control': 'no-store' });
    }
    await next();
    c.header('cache-control', 'no-store');
  });
}
// `?ref=CODE` on the home page (§19): the cookie for a valid code, and the address without it. Also
// on the Russian sign-in card, where the Russian host's links carry the code (it cannot set the cookie).
app.use('/', async (c, next) => (await refVisit(c)) ?? next());
app.use('/ru/signin', async (c, next) => (await refVisit(c)) ?? next());
app.on(['GET', 'HEAD'], '/ru/signin', (c) => c.env.ASSETS.fetch(c.req.raw));
app.route('/auth', auth);
app.route('/auth', signup);
app.route('/v1', v1);
app.route('/admin', admin);
app.route('/hook', hook);
// The Telegram bot (§17): its actions call this same app, so /v1 runs as for any request.
app.route('/hook/telegram', telegram((request, env, ctx) => app.fetch(request, env, ctx)));
// The MCP server (§15, ADR 0023): its tools call this same app, so /v1 runs as for any request.
app.route('/mcp', mcp((request, env, ctx) => app.fetch(request, env, ctx)));
// The pages with a markdown copy: markdown to `Accept: text/markdown`, else the HTML file (§16).
for (const path of Object.keys(MARKDOWN_PAGES)) app.on(['GET', 'HEAD'], path, (c) => servePage(c.req.raw, c.env, path));

export default {
  fetch: app.fetch,
  // Every minute: install and update operations — resumed if stalled, ended if the worker's
  // setup_ok is overdue (§4). Hourly: a slice of the token check (§3 item 6), lost connects,
  // expired idempotency records (§15), API call log rows (90 days, §13 item 1) and totals (§7), and
  // workers gone silent, and a slice of the upgrade advice (§8).
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const now = Date.now();
        const ops = await runOperations(env, now);
        if (ops) console.log(`operations run ${ops}`);
        const sites = await runSites(env, now);
        if (sites.synced + sites.routes + sites.retired) console.log(`sites: synced ${sites.synced}, routes ${sites.routes}, retired ${sites.retired}`);
        const linkHosts = await runLinkHosts(env, now);
        if (linkHosts) console.log(`link hosts: ${linkHosts}`);
        // Crypto top-ups Trybit has not told us of, and Stars invoices that can no longer be paid
        // (§18): every 15 minutes.
        if (new Date(event.scheduledTime).getUTCMinutes() % RECONCILE_EVERY_MIN === 2) {
          const r = await reconcile(env, now).catch((e: unknown) => (console.error('reconcile', e instanceof Error ? e.message : e), {}));
          if (Object.keys(r).length) console.log(`invoices reconciled: ${JSON.stringify(r)}`);
          const stars = await expireStars(env, now).catch((e: unknown) => (console.error('expire stars', e instanceof Error ? e.message : e), 0));
          if (stars) console.log(`stars invoices expired: ${stars}`);
          const told = await tellStarsReviews(env).catch((e: unknown) => (console.error('tell stars reviews', e instanceof Error ? e.message : e), 0));
          if (told) console.log(`stars payments in review told again: ${told}`);
          const asked = await tellRefunds(env).catch((e: unknown) => (console.error('tell refunds', e instanceof Error ? e.message : e), 0));
          if (asked) console.log(`refund requests told again: ${asked}`);
          const payouts = await tellPayouts(env).catch((e: unknown) => (console.error('tell payouts', e instanceof Error ? e.message : e), 0));
          if (payouts) console.log(`payout requests told again: ${payouts}`);
          const accrued = await sweepAccruals(env.DB, now).catch((e: unknown) => (console.error('accruals', e instanceof Error ? e.message : e), 0));
          if (accrued) console.log(`commissions and promo bonuses written late: ${accrued}`);
        }
        if (new Date(event.scheduledTime).getUTCMinutes() !== HOURLY_AT) return;
        const hour = Math.floor(now / 3_600_000);
        const day = Math.floor(now / 86_400_000);
        const [, , , , , , , , , silent] = await env.DB.batch([
          env.DB.prepare('DELETE FROM idempotency WHERE created_at < ?').bind(now - IDEM_TTL),
          // The bot's handled updates and dialogs that ran out (§17).
          env.DB.prepare('DELETE FROM tg_updates WHERE at < ?').bind(now - UPDATES_TTL),
          env.DB.prepare('DELETE FROM tg_states WHERE expires_at < ?').bind(now),
          env.DB.prepare('DELETE FROM cf_calls WHERE at < ?').bind(now - CF_CALLS_TTL),
          // Totals (§7): hours for the "today" chart, 2 days; days, 400; a disconnected account's, 30 days.
          env.DB.prepare('DELETE FROM hourly WHERE hour < ?').bind(hour - HOURLY_HOURS),
          env.DB.prepare('DELETE FROM daily WHERE day < ?').bind(day - DAILY_DAYS),
          env.DB.prepare('DELETE FROM hourly WHERE account_id IN (SELECT account_id FROM departed WHERE at < ?)').bind(now - DEPARTED_TTL),
          env.DB.prepare('DELETE FROM daily WHERE account_id IN (SELECT account_id FROM departed WHERE at < ?)').bind(now - DEPARTED_TTL),
          env.DB.prepare('DELETE FROM departed WHERE at < ?').bind(now - DEPARTED_TTL),
          // A worker silent for 26 hours: "no connection" (§4), until its next push.
          env.DB.prepare(
            "UPDATE edge_accounts SET state = 'no_connection', updated_at = ?1 WHERE state = 'ready' AND coalesce(last_push_at, installed_at, created_at) < ?2 AND (lease_until IS NULL OR lease_until < ?1) RETURNING id, user_id, cf_account_id, cf_account_name",
          ).bind(now, now - SILENCE),
        ]);
        if (silent?.meta.changes) console.log(`no connection: ${silent.meta.changes} accounts`);
        // The user hears of it once, when the account goes silent (§4).
        for (const a of (silent?.results ?? []) as { id: string; user_id: number; cf_account_id: string; cf_account_name: string | null }[]) await mailSilence(env, a, now).catch((e: unknown) => console.error('silence mail', a.id, e instanceof Error ? e.message : e));
        // "Renew the connection" 30 days before the working token expires (§3 item 6), once per token.
        const expiring = (
          await env.DB.prepare(
            "SELECT id, user_id, cf_account_id, cf_account_name, token_expires_at FROM edge_accounts WHERE token_expires_at BETWEEN ?1 AND ?1 + ?2 AND (renew_mailed_at IS NULL OR renew_mailed_at < token_expires_at - ?2 - 86400000) AND state NOT IN ('pending', 'bootstrap_lost', 'revoked') LIMIT 100",
          )
            .bind(now, RENEW_BEFORE)
            .all<{ id: string; user_id: number; cf_account_id: string; cf_account_name: string | null; token_expires_at: number }>()
        ).results;
        for (const a of expiring) await mailRenew(env, a, now).catch((e: unknown) => console.error('renew mail', a.id, e instanceof Error ? e.message : e));
        const r = await checkTokens(env, now);
        console.log(`tokens checked ${r.checked}, revoked ${r.revoked}, connects lost ${r.lost}`);
        const a = await runAdvice(env, now);
        if (a.advised) console.log(`advice: ${a.advised} accounts`);
        // A delete that died left its mark (§18): money moves for that user again.
        await env.DB.prepare('UPDATE users SET deleting_at = NULL WHERE deleting_at < ?').bind(now - DELETING_TTL).run();
        // Pro (§18): today's day charged for every open period, graces followed, ended ones closed.
        const charges = await runCharges(env, now);
        if (charges.users) console.log(`charges: ${charges.users} users, grace ${charges.grace.length}, closed ${charges.closed.length}`);
        for (const id of charges.grace) await mailPro(env, id, 'grace', now).catch((e: unknown) => console.error('grace mail', id, e instanceof Error ? e.message : e));
        for (const id of charges.closed) await mailPro(env, id, 'ended', now).catch((e: unknown) => console.error('pro ended mail', id, e instanceof Error ? e.message : e));
        for (const id of await lowBalances(env)) if (await mailPro(env, id, 'low', now).catch((e: unknown) => (console.error('low balance mail', id, e instanceof Error ? e.message : e), false))) await markLowTold(env, id, now);
        // A plan that disagrees with its periods, or more working on free than free allows.
        const plans = await reconcilePlans(env, now);
        if (plans) console.log(`plans reconciled: ${plans}`);
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
