// What a referral's deposit earns (docs/spec.md §19, ADR 0036): the partner's commission and the
// promo code's bonus. Written in the same batch as the deposit; the cron writes any that is missing.
// Both are held to one by unique indexes, so a webhook, a reconcile run and the cron write once.
export const RATE_BP = 3000;
export const HOLD_DAYS = 30;
const DAY = 86_400_000;
/** The smallest deposit a promo bonus is granted on. */
export const PROMO_MIN_DEPOSIT = 9_000_000;

/**
 * The commission on the deposit of `invoiceId`: 30% of the whole deposit, rounded down, held 30 days
 * from the deposit, only while the partner exists and is not being deleted. Never skipped because of
 * a refund — each refund writes its own clawback, so the two always sum to the rate times what the
 * deposit kept.
 */
export const commissionStmt = (db: D1Database, invoiceId: string, now: number) =>
  db
    .prepare(
      `INSERT OR IGNORE INTO partner_ledger (user_id, type, amount, invoice_id, referral_id, rate_bp, matures_at, note, created_at)
       SELECT u.referred_by, 'commission', l.amount * ?2 / 10000, l.invoice_id, u.id, ?2, l.created_at + ?3, ?4, ?5
       FROM ledger l JOIN users u ON u.id = l.user_id JOIN users p ON p.id = u.referred_by
       WHERE l.invoice_id = ?1 AND l.type = 'deposit' AND u.referred_by <> u.id AND p.deleting_at IS NULL AND l.amount * ?2 / 10000 > 0`,
    )
    .bind(invoiceId, RATE_BP, HOLD_DAYS * DAY, `${RATE_BP / 100}% of a referral's top-up`, now);

/** A deposit bonus is the user's promo code's, on a deposit of at least $9 not refunded from: a
 *  first-deposit code on the first one, any-deposit up to its end. */
const DEPOSIT_BONUS_WHERE = `l.type = 'deposit' AND l.amount >= ${PROMO_MIN_DEPOSIT} AND u.deleting_at IS NULL
  AND ((p.kind = 'first_deposit' AND NOT EXISTS (SELECT 1 FROM ledger f WHERE f.user_id = u.id AND f.type = 'deposit' AND f.id < l.id))
    OR (p.kind = 'any_deposit' AND (p.until IS NULL OR l.created_at < p.until)))
  AND (p.max_uses IS NULL OR (SELECT count(*) FROM promo_redemptions c WHERE c.promo_id = p.id) < p.max_uses)
  AND NOT EXISTS (SELECT 1 FROM ledger rf WHERE rf.invoice_id = l.invoice_id AND rf.type = 'refund')`;

/** The bonus row of the use just counted, only if this batch counted it. */
const bonusRow = (db: D1Database, where: string, ...binds: unknown[]) =>
  db
    .prepare(
      `INSERT OR IGNORE INTO ledger (user_id, type, amount, invoice_id, op_key, note, created_at)
       SELECT r.user_id, 'bonus', r.amount, r.invoice_id, 'promo:' || r.promo_id || ':' || r.user_id, 'Promo ' || p.code, r.created_at
       FROM promo_redemptions r JOIN promo_codes p ON p.id = r.promo_id WHERE ${where} AND changes() = 1`,
    )
    .bind(...binds);

/** A promo bonus on the deposit of `invoiceId`: the use counted and the bonus written together. */
export const depositBonusStmts = (db: D1Database, invoiceId: string, now: number) => [
  db
    .prepare(
      `INSERT OR IGNORE INTO promo_redemptions (promo_id, user_id, invoice_id, amount, created_at)
       SELECT p.id, u.id, l.invoice_id, p.bonus, ?2 FROM ledger l JOIN users u ON u.id = l.user_id JOIN promo_codes p ON p.id = u.promo_id
       WHERE l.invoice_id = ?1 AND ${DEPOSIT_BONUS_WHERE}`,
    )
    .bind(invoiceId, now),
  bonusRow(db, 'r.invoice_id = ?1', invoiceId),
];

/** A start credit: granted once the e-mail is confirmed, while the code is open. */
export const signupCreditStmts = (db: D1Database, userId: number, now: number) => [
  db
    .prepare(
      `INSERT OR IGNORE INTO promo_redemptions (promo_id, user_id, invoice_id, amount, created_at)
       SELECT p.id, u.id, NULL, p.bonus, ?2 FROM users u JOIN promo_codes p ON p.id = u.promo_id
       WHERE u.id = ?1 AND p.kind = 'signup_credit' AND u.email_confirmed_at IS NOT NULL AND u.deleting_at IS NULL
         AND (p.until IS NULL OR u.email_confirmed_at < p.until)
         AND (p.max_uses IS NULL OR (SELECT count(*) FROM promo_redemptions c WHERE c.promo_id = p.id) < p.max_uses)`,
    )
    .bind(userId, now),
  bonusRow(db, 'r.user_id = ?1 AND r.invoice_id IS NULL', userId),
];

/** Grant a start credit now, if one is due (after a confirmation). */
export async function grantSignupCredit(db: D1Database, userId: number, now = Date.now()): Promise<void> {
  await db.batch(signupCreditStmts(db, userId, now)).catch((e: unknown) => console.error('signup credit', userId, e instanceof Error ? e.message : e));
}

/** The cron, every 15 minutes: commissions, deposit bonuses and start credits not yet written,
 *  50 of each a run, the oldest first. */
export async function sweepAccruals(db: D1Database, now = Date.now()): Promise<number> {
  const commissions = (
    await db
      .prepare(
        `SELECT l.invoice_id FROM ledger l JOIN users u ON u.id = l.user_id JOIN users p ON p.id = u.referred_by
         WHERE l.type = 'deposit' AND u.referred_by <> u.id AND p.deleting_at IS NULL AND l.amount * ?1 / 10000 > 0
           AND NOT EXISTS (SELECT 1 FROM partner_ledger c WHERE c.type = 'commission' AND c.invoice_id = l.invoice_id)
         ORDER BY l.id LIMIT 50`,
      )
      .bind(RATE_BP)
      .all<{ invoice_id: string }>()
  ).results;
  const bonuses = (
    await db
      .prepare(
        `SELECT l.invoice_id FROM ledger l JOIN users u ON u.id = l.user_id JOIN promo_codes p ON p.id = u.promo_id
         WHERE ${DEPOSIT_BONUS_WHERE} AND NOT EXISTS (SELECT 1 FROM promo_redemptions r WHERE r.promo_id = p.id AND r.user_id = u.id)
         ORDER BY l.id LIMIT 50`,
      )
      .all<{ invoice_id: string }>()
  ).results;
  const credits = (
    await db
      .prepare(
        `SELECT u.id FROM users u JOIN promo_codes p ON p.id = u.promo_id
         WHERE p.kind = 'signup_credit' AND u.email_confirmed_at IS NOT NULL AND u.deleting_at IS NULL
           AND (p.until IS NULL OR u.email_confirmed_at < p.until)
           AND (p.max_uses IS NULL OR (SELECT count(*) FROM promo_redemptions c WHERE c.promo_id = p.id) < p.max_uses)
           AND NOT EXISTS (SELECT 1 FROM promo_redemptions r WHERE r.promo_id = p.id AND r.user_id = u.id)
         ORDER BY u.email_confirmed_at LIMIT 50`,
      )
      .all<{ id: number }>()
  ).results;
  for (const c of commissions) await commissionStmt(db, c.invoice_id, now).run();
  for (const b of bonuses) await db.batch(depositBonusStmts(db, b.invoice_id, now));
  for (const u of credits) await db.batch(signupCreditStmts(db, u.id, now));
  return commissions.length + bonuses.length + credits.length;
}

/**
 * What a refund of `micro` from the deposit of `invoiceId` takes back with it (§18, §19), in the
 * batch that writes the refund: the partner's clawback — the rate times all refunded from that
 * deposit, less the clawbacks already written, whether the commission is written yet or not — and
 * the promo bonus granted on that deposit in proportion to the refunded share. Both rows only once
 * the refund's own journal row is there (`refund:<id>`), each once by its key.
 */
export async function clawbacks(db: D1Database, refund: { id: string; user_id: number; invoice_id: string }, micro: number, now: number): Promise<{ stmts: D1PreparedStatement[]; bonusBack: number }> {
  const facts = (await db
    .prepare(
      `SELECT (SELECT amount FROM ledger WHERE invoice_id = ?1 AND type = 'deposit') AS deposit,
         (SELECT coalesce(-sum(amount), 0) FROM ledger WHERE invoice_id = ?1 AND type = 'refund') AS refunded,
         (SELECT rate_bp FROM partner_ledger WHERE invoice_id = ?1 AND type = 'commission') AS rate,
         (SELECT coalesce(-sum(amount), 0) FROM partner_ledger WHERE invoice_id = ?1 AND type = 'clawback') AS clawed,
         (SELECT amount FROM promo_redemptions WHERE invoice_id = ?1) AS bonus,
         (SELECT coalesce(-sum(amount), 0) FROM ledger WHERE invoice_id = ?1 AND type = 'bonus' AND amount < 0) AS bonus_back`,
    )
    .bind(refund.invoice_id)
    .first<{ deposit: number; refunded: number; rate: number | null; clawed: number; bonus: number | null; bonus_back: number }>())!;
  const after = facts.refunded + micro;
  const rate = facts.rate ?? RATE_BP;
  const claw = Math.floor((after * rate) / 10_000) - facts.clawed;
  // In BigInt: a bonus times what was refunded passes 2^53 for large sums.
  const bonusBack = facts.bonus ? Math.min(facts.bonus, Number((BigInt(facts.bonus) * BigInt(after)) / BigInt(facts.deposit))) - facts.bonus_back : 0;
  const written = `EXISTS (SELECT 1 FROM ledger WHERE op_key = 'refund:' || ?1)`;
  const stmts: D1PreparedStatement[] = [];
  if (claw > 0)
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO partner_ledger (user_id, type, amount, invoice_id, referral_id, rate_bp, op_key, note, created_at)
           SELECT u.referred_by, 'clawback', ?2, ?3, u.id, ?4, 'clawback:' || ?1, 'A referral''s top-up refunded', ?5
           FROM users u JOIN users p ON p.id = u.referred_by WHERE u.id = ?6 AND p.deleting_at IS NULL AND ${written}`,
        )
        .bind(refund.id, -claw, refund.invoice_id, rate, now, refund.user_id),
    );
  if (bonusBack > 0)
    stmts.push(
      db
        .prepare(`INSERT OR IGNORE INTO ledger (user_id, type, amount, invoice_id, op_key, note, created_at) SELECT ?2, 'bonus', ?3, ?4, 'promo-back:' || ?1, 'Promo bonus of a refunded top-up', ?5 WHERE ${written}`)
        .bind(refund.id, refund.user_id, -bonusBack, refund.invoice_id, now),
    );
  return { stmts, bonusBack: Math.max(bonusBack, 0) };
}

/** Credit the balance holds that no deposit brought: a start credit or the migration's Pro bonus —
 *  spent on Pro days only, never refunded. */
export const CREDITS_SQL = "SELECT coalesce(sum(amount), 0) FROM ledger WHERE user_id = ?1 AND type = 'bonus' AND invoice_id IS NULL AND amount > 0";
