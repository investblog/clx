#!/usr/bin/env node
// node scripts/seed-local.mjs — a dev-only user in the LOCAL D1 for `wrangler dev`:
// dev@clx.local / Dev-pass-1 (a literal dev password; this never touches the remote database).
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';

const sq = (s) => `'${String(s).replace(/'/gu, "''")}'`;
const salt = crypto.randomBytes(16);
const hash = `${salt.toString('base64')}:${crypto.pbkdf2Sync('Dev-pass-1', salt, 100_000, 32, 'sha256').toString('base64')}`;
const sql = ['DELETE FROM users;', `INSERT INTO users (id, email, password_hash, created_at, email_confirmed_at) VALUES (1, 'dev@clx.local', ${sq(hash)}, ${Date.now()}, ${Date.now()});`];

fs.mkdirSync('temp', { recursive: true });
fs.writeFileSync('temp/seed.sql', sql.join('\n'));
const r = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'clx', '--local', '--file=temp/seed.sql', '--yes'], { stdio: 'inherit' });
fs.rmSync('temp/seed.sql', { force: true });
process.exit(r.status ?? 1);
