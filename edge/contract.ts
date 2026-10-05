// What clx.cx and clx-edge agree on (docs/spec.md §4): the cron of the self-check, when the worker
// reports `setup_ok`, and the working cron clx.cx sets once it has.
export const SELF_CHECK_CRON = '* * * * *';
export const WORKING_CRON = '5 * * * *';

/** A site in the synced config (§5, §6), under the key `siteKey(host)`. */
export interface SiteConfig {
  /** the target, `s…`: every count of this site carries it */
  t: string;
  /** the current path first; after a rotation the old ones follow, each with its expiry (ms) */
  paths: { path: string; c: string; s: string; script: string; until?: number }[];
  /** path prefixes that are not counted */
  excluded: string[];
}

export const siteKey = (host: string) => `site:${host}`;

// The worker's counting tables (§5), as the day close and the reports (stages 4c, 4d) read them.
/** Time is a UTC hour or day number since the epoch. */
export const hourOf = (ms: number) => Math.floor(ms / 3_600_000);
export const dayOf = (ms: number) => Math.floor(ms / 86_400_000);
/** The page of a detail row holding the views beyond the caps; its other dimensions are empty. */
export const OTHER = '(other)';
/** The target of the account-wide `(other)` row, and the account's scope in `rows_hourly`. */
export const ACCOUNT = '*';
/** `totals` keeps a target's views per UTC hour of the day in v00…v23. Bots per hour are summed
 *  from `bots_hourly`, which is exact: at most one row per bot category. */
export const HOUR_COLUMNS = Array.from({ length: 24 }, (_, h) => `v${String(h).padStart(2, '0')}`);
/** Detail caps per hour (§5) and the database size at which no new detail row is made (§8). The
 *  day close keeps the same caps per day. */
export const TARGET_ROWS = 299;
export const ACCOUNT_ROWS = 1500;
export const FULL_BYTES = 400 * 1024 * 1024;

// What the worker sends clx.cx (§7): totals only. Hour items and the running day snapshot are sites
// only and wait in `outbox`; a final day (sites and links) waits in `final_days` until accepted.
/** A closed hour of a site: final. */
export interface HourItem {
  target: string;
  hour: number;
  views: number;
  bots: number;
}
/** A day: a running snapshot as of the end of `as_of_hour`, or final once the day is closed. */
export interface DayItem {
  target: string;
  day: number;
  as_of_hour?: number;
  final: boolean;
  views: number;
  bots: number;
  visitors: number;
}
/** At most this many items in one `outbox` part and one push. */
export const PART_ITEMS = 2000;
/** A push body (`POST HOOK_URL/push`, `Bearer EDGE_KEY`): the items with an `id` unique within the
 *  body, and the heartbeat — this bundle, the schema, the queue depth, the latest config commit, the
 *  last error and the counters of dropped items (§4, §6, §7). It never names the account. */
export interface PushBody {
  v: typeof PUSH_VERSION;
  bundle: string;
  schema: number | null;
  queue: number;
  revision: number;
  error?: string;
  dropped?: Partial<Record<DropReason, number>>;
  items: ((HourItem | DayItem) & { id: number })[];
}
export const PUSH_VERSION = 1;
export const PUSH_BYTES = 256 * 1024;
/** Why clx.cx refused an item. Terminal ones drop it at once; `busy` is retried, at most 3 times. */
export const TERMINAL = ['budget', 'invalid', 'unknown_target', 'too_old'] as const;
export type Reason = (typeof TERMINAL)[number] | 'busy';
export const ATTEMPTS = 3;
/** What `sync_status` counts: refused items by reason, and queue parts expired unsent. */
export type DropReason = Reason | 'expired';
export interface PushAnswer {
  accepted: number[];
  rejected: { id: number; reason: Reason }[];
}
/** How long hourly and running items wait in `outbox` (§7), and how far back hours are queued. */
export const OUTBOX_HOURS = 7 * 24;
