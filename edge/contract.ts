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
