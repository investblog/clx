#!/usr/bin/env node
// node scripts/wrangler.mjs <wrangler args…>
//
// The pinned wrangler with the deploy token from .secrets/cloudflare.env (scripts/make-token.mjs):
// only CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID reach the child, nothing else from the file.
// Nothing is printed from the file.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lockSecrets } from './secrets-dir.mjs';

// Without the file (a fresh clone), wrangler runs on its own login (`wrangler login`) or environment.
const bin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
if (!fs.existsSync('.secrets/cloudflare.env')) {
  const r = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
lockSecrets();
const env = Object.fromEntries(
  fs
    .readFileSync('.secrets/cloudflare.env', 'utf8')
    .split(/\r?\n/u)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
  console.error('.secrets/cloudflare.env has no CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID — run scripts/make-token.mjs first.');
  process.exit(2);
}
const child = { ...process.env, CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID };
delete child.CF_GLOBAL_API_KEY;
delete child.CLOUDFLARE_API_KEY;
delete child.CLOUDFLARE_EMAIL;
// The repository's own wrangler, run by node directly: no shell, so arguments with spaces and
// quotes (SQL in --command) arrive as they were given.
const r = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], { stdio: 'inherit', env: child });
process.exit(r.status ?? 1);
