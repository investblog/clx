#!/usr/bin/env node
// node scripts/secrets.mjs JWT_SECRET | MASTER_KEYS
//
// Makes a Worker secret and puts it with wrangler (through scripts/wrangler.mjs, value on stdin —
// never on a command line). Nothing is printed.
// - JWT_SECRET: a new one signs everyone out within 15 minutes.
// - MASTER_KEYS: the keyring sealing users' working tokens (docs/spec.md §3), "<id>:<base64>".
//   It is set only when the Worker has none: replacing it would make every stored token unreadable.
//   Rotation (a new key in front of the old one, re-encryption) is a separate, later tool.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const name = process.argv[2];
if (!['JWT_SECRET', 'MASTER_KEYS'].includes(name)) {
  console.error('usage: node scripts/secrets.mjs JWT_SECRET | MASTER_KEYS');
  process.exit(2);
}
if (name === 'MASTER_KEYS') {
  const list = spawnSync(process.execPath, ['scripts/wrangler.mjs', 'secret', 'list'], { encoding: 'utf8' });
  if (list.status !== 0) throw new Error('wrangler secret list failed');
  if (list.stdout.includes('"MASTER_KEYS"')) {
    console.error('MASTER_KEYS is already set; replacing it would lose every stored token. Not changed.');
    process.exit(1);
  }
}
const value =
  name === 'MASTER_KEYS' ? `k${new Date().toISOString().slice(0, 10).replace(/-/gu, '')}:${crypto.randomBytes(32).toString('base64')}` : crypto.randomBytes(32).toString('base64url');
const r = spawnSync(process.execPath, ['scripts/wrangler.mjs', 'secret', 'put', name], { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
if (r.status !== 0) throw new Error(`wrangler secret put ${name} failed`);
console.log(`${name}: set (value not shown)`);
