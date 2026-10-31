#!/usr/bin/env node
// node scripts/rekey.mjs start | status | finish
//
// A MASTER_KEYS rotation (docs/spec.md §3 item 5, ADR 0038). A Worker secret cannot be read back, so
// the new key cannot be written in front of the old one inside MASTER_KEYS: it goes into a second
// secret, MASTER_KEYS_NEXT, which the Worker puts in front of the ring (src/lib/crypto.ts keyring).
//   start  — makes the new key, keeps it in .secrets/master-keys-next.txt with the time it started
//            (so an interrupted rotation resumes with the same key) and puts it as MASTER_KEYS_NEXT.
//            From then on new tokens are sealed with it, and the minute cron re-seals the stored ones
//            (src/cf/rekey.ts). Run again, it puts the kept key again — never a new one.
//   status — how many ciphertexts each key seals, from the live D1.
//   finish — puts the new key as MASTER_KEYS, deletes MASTER_KEYS_NEXT and the kept file; the old
//            key is gone for good after this. Only when the old Worker can no longer write: 30
//            minutes after start, leases past their time cleared and none live (every write of a
//            ciphertext is made under one, src/cf/connect.ts), and every ciphertext names the new key.
// Through scripts/wrangler.mjs; keys go on stdin, never on a command line; nothing secret is printed.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { lockSecrets } from './secrets-dir.mjs';

const KEPT = '.secrets/master-keys-next.txt';
/** Longer than anything a Worker version from before `start` may still be doing. */
const SETTLE = 30 * 60_000;
const cmd = process.argv[2];
if (!['start', 'status', 'finish'].includes(cmd)) {
  console.error('usage: node scripts/rekey.mjs start | status | finish');
  process.exit(2);
}

const wrangler = (args, input) => {
  const r = spawnSync(process.execPath, ['scripts/wrangler.mjs', ...args], { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] });
  if (r.status !== 0) throw new Error(`wrangler ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || r.stdout).slice(-400)}`);
  return r.stdout;
};
const secrets = () => {
  const out = wrangler(['secret', 'list', '--format', 'json']);
  return JSON.parse(out.slice(out.indexOf('['))).map((s) => s.name);
};
const query = (sql) => {
  const out = wrangler(['d1', 'execute', 'clx', '--remote', '--json', `--command=${sql}`]);
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
};
/** Ciphertexts by key: `token:<id>` for tokens in use, `next:<id>` for renewals' new ones; a broken
 *  one is `…:invalid`, one without a key id `…:?`. */
const keyOf = (c) => `CASE WHEN json_valid(${c}) THEN coalesce(json_extract(${c}, '$.key_id'), '?') ELSE 'invalid' END`;
const census = () =>
  query(
    `SELECT 'token:' || ${keyOf('token_sealed')} AS k, count(*) AS n FROM edge_accounts WHERE token_sealed IS NOT NULL GROUP BY 1 ` +
      `UNION ALL SELECT 'next:' || ${keyOf('next_sealed')}, count(*) FROM edge_accounts WHERE next_sealed IS NOT NULL GROUP BY 1`,
  );
const put = (name, value) => {
  wrangler(['secret', 'put', name], value);
  console.log(`${name}: set (value not shown)`);
};

lockSecrets();
// The kept file: the key on the first line, `started=<ms>` on the second.
const [kept, startedLine] = fs.existsSync(KEPT) ? fs.readFileSync(KEPT, 'utf8').split(/\r?\n/u) : [];
const keptId = kept?.slice(0, kept.indexOf(':'));
const started = Number(startedLine?.replace(/^started=/u, ''));

if (cmd === 'status') {
  for (const { k, n } of census()) console.log(`${k} ${n}`);
  const next = secrets().includes('MASTER_KEYS_NEXT');
  if (next && !kept) {
    console.error(`MASTER_KEYS_NEXT is set but ${KEPT} is gone: new tokens are sealed with a key kept nowhere else`);
    process.exitCode = 1;
  } else console.log(kept ? `rotation under way to ${keptId}, started ${new Date(started).toISOString()}${next ? '' : ' — MASTER_KEYS_NEXT is not set: run `start` again'}` : 'no rotation under way');
} else if (cmd === 'start') {
  const names = secrets();
  if (!names.includes('MASTER_KEYS')) throw new Error('the Worker has no MASTER_KEYS: set it with scripts/secrets.mjs, nothing to rotate');
  if (kept) {
    console.log(`resuming the rotation to ${keptId}`);
    // The secret was gone: the Worker sealed with the old key meanwhile, so the wait starts again.
    if (!names.includes('MASTER_KEYS_NEXT')) fs.writeFileSync(KEPT, `${kept}\nstarted=${Date.now()}\n`, { mode: 0o600 });
    put('MASTER_KEYS_NEXT', kept);
  } else {
    if (names.includes('MASTER_KEYS_NEXT')) throw new Error(`MASTER_KEYS_NEXT is set but ${KEPT} is gone: its key cannot be recovered — not changed`);
    // The current key's id is not known here (a token sealed with it may not be in D1 yet): a random
    // part keeps the new id from ever being the old one.
    const id = `k${new Date().toISOString().slice(0, 10).replace(/-/gu, '')}-${crypto.randomBytes(4).toString('hex')}`;
    const value = `${id}:${crypto.randomBytes(32).toString('base64')}`;
    // Kept before it is put: a key the Worker seals with must never exist only in Cloudflare.
    fs.writeFileSync(KEPT, `${value}\nstarted=${Date.now()}\n`, { mode: 0o600 });
    lockSecrets();
    put('MASTER_KEYS_NEXT', value);
    console.log(`rotation to ${id} started; in 30 minutes, when \`status\` shows only ${id}, run \`finish\``);
  }
} else {
  if (!kept) throw new Error(`${KEPT} is missing: no rotation of this machine to finish`);
  if (!(Date.now() - started >= SETTLE)) throw new Error(`not yet: a Worker from before \`start\` may still write — wait until ${new Date(started + SETTLE).toISOString()}`);
  // A lease past its time still lets its owner renew it and write (connect.ts checks the owner, not
  // the time): such leases are cleared first, so an old Worker's request can no longer do either.
  const now = Date.now();
  query(`UPDATE edge_accounts SET lease_until = NULL, lease_owner = NULL WHERE lease_until <= ${now}`);
  const leased = query(`SELECT count(*) AS n FROM edge_accounts WHERE lease_until > ${now}`)[0].n;
  if (leased) throw new Error(`not yet: ${leased} account(s) under a lease (a connect, renewal or sync in progress) — try again in a few minutes`);
  const left = census().filter((r) => !r.k.endsWith(`:${keptId}`));
  if (left.length) throw new Error(`not yet: ${left.map((r) => `${r.k} ${r.n}`).join(', ')} — the cron re-seals ~20 a minute; a broken or unopenable one needs a look`);
  if (!secrets().includes('MASTER_KEYS_NEXT')) throw new Error('MASTER_KEYS_NEXT is not set: run `start` again first');
  put('MASTER_KEYS', kept);
  wrangler(['secret', 'delete', 'MASTER_KEYS_NEXT']);
  console.log('MASTER_KEYS_NEXT: deleted');
  fs.rmSync(KEPT);
  console.log(`rotation to ${keptId} finished; the old key is gone`);
}
