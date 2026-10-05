#!/usr/bin/env node
// node scripts/user.mjs add <email>                — a new user
// node scripts/user.mjs password <email>           — a new password for an existing user
// node scripts/user.mjs list
//
// Until sign-up lands (docs/spec.md §9), users are made here, in the remote D1 (--local for the
// local one). The password is generated, never typed or printed: it is written to .secrets/user-<email>.txt for the
// owner to move to a password manager and delete. The hash is the Worker's format
// (src/auth/password.ts): PBKDF2-SHA256, 100 000 rounds, "<salt b64>:<hash b64>".
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { lockSecrets } from './secrets-dir.mjs';

const args = process.argv.slice(2).filter((a) => a !== '--local');
const where = process.argv.includes('--local') ? '--local' : '--remote';
const [cmd, rawEmail] = args;
const sq = (s) => `'${String(s).replace(/'/gu, "''")}'`;

const wrangler = (extra) => {
  const r = spawnSync(process.execPath, ['scripts/wrangler.mjs', 'd1', 'execute', 'clx', where, ...extra], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`d1 execute failed: ${(r.stderr || r.stdout).slice(-400)}`);
  return r.stdout;
};

/** Rows of a query that carries nothing secret (it goes on wrangler's command line). */
const query = (sql) => JSON.parse(wrangler(['--json', `--command=${sql}`]))[0].results;

/** A write that carries a hash: from a file, never the command line. Wrangler answers a file with
 *  progress text, not rows, so the caller checks the result with query(). */
function write(sql) {
  fs.mkdirSync('temp', { recursive: true });
  const file = `temp/user-${process.pid}.sql`;
  fs.writeFileSync(file, sql);
  try {
    wrangler([`--file=${file}`, '--yes']);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

function newPassword(email) {
  // Upper, lower and digits are guaranteed, the rest random: 24 characters.
  const password = `Aa1${crypto.randomBytes(18).toString('base64url')}`.slice(0, 24);
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 32, 'sha256');
  fs.mkdirSync('.secrets', { recursive: true });
  lockSecrets();
  const out = `.secrets/user-${email.replace(/[^a-z0-9@._-]/gu, '_')}.txt`;
  fs.writeFileSync(out, `${email}\n${password}\n`, { mode: 0o600 });
  return { stored: `${salt.toString('base64')}:${hash.toString('base64')}`, out };
}

if (cmd === 'list') {
  const rows = query('SELECT email, last_login_at FROM users ORDER BY email');
  for (const r of rows) console.log(`${r.email}\t${r.last_login_at ? new Date(r.last_login_at).toISOString() : 'never'}`);
  process.exit(0);
}
const email = (rawEmail ?? '').trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || !['add', 'password'].includes(cmd)) {
  console.error('usage: node scripts/user.mjs add <email> | password <email> | list  [--local]');
  process.exit(2);
}
const known = query(`SELECT id FROM users WHERE email = ${sq(email)}`).length > 0;
if (known !== (cmd === 'password')) {
  console.error(cmd === 'add' ? `user ${email} exists — use: password ${email}` : `no user ${email}`);
  process.exit(1);
}
const { stored, out } = newPassword(email);
try {
  write(
    cmd === 'add'
      ? `INSERT INTO users (email, password_hash, created_at) VALUES (${sq(email)}, ${sq(stored)}, ${Date.now()});`
      : `UPDATE users SET password_hash = ${sq(stored)} WHERE email = ${sq(email)};`,
  );
} catch (e) {
  // No write, no password: a file that matches nothing would only mislead.
  fs.rmSync(out, { force: true });
  throw e;
}
// The file's password is good only if the stored hash is the one just made; the hash is compared
// by its digest, so it never reaches the command line.
const digest = crypto.createHash('sha256').update(stored).digest('hex');
const [row] = query(`SELECT password_hash FROM users WHERE email = ${sq(email)}`);
if (!row || crypto.createHash('sha256').update(row.password_hash).digest('hex') !== digest) {
  fs.rmSync(out, { force: true });
  throw new Error(`the write did not land for ${email}`);
}
console.log(cmd === 'add' ? `user ${email} added; password in ${out}` : `new password for ${email} in ${out}`);
