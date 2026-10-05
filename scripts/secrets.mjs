#!/usr/bin/env node
// node scripts/secrets.mjs
//
// Makes the Worker's JWT_SECRET and puts it with wrangler (through scripts/wrangler.mjs, value on
// stdin — never on a command line). Nothing is printed. A new JWT_SECRET signs everyone out within
// 15 minutes.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const value = crypto.randomBytes(32).toString('base64url');
const r = spawnSync(process.execPath, ['scripts/wrangler.mjs', 'secret', 'put', 'JWT_SECRET'], { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
if (r.status !== 0) throw new Error('wrangler secret put JWT_SECRET failed');
console.log('JWT_SECRET: set (value not shown)');
