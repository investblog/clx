#!/usr/bin/env node
// node scripts/deploy-qr.mjs <checkout of github.com/investblog/qr-generator>
//
// Deploys the free QR API to qr.clx.cx (docs/spec.md §16, ADR 0044): the worker `clx-qr` on clx's
// own account, a Workers Custom Domain, built from qr-generator (MIT, its own repository) at the
// commit pinned below. The checkout must be at that commit with no tracked file changed; its vars
// must be the contract's; its tests run first. The wrangler config is written here, in a temporary
// folder — clx's own wrangler.jsonc (routes, D1, crons) never takes part. The upload goes through
// scripts/wrangler.mjs, so with the clx-deploy token. An update is a new pin here, reviewed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const QR_COMMIT = '4946196a856dd09867b23cc697737270b96dc932'; // feat/drop-bare-urls: no bare URLs, no cache
const HOST = 'qr.clx.cx';
const NAME = 'clx-qr';
// The contract the extension's links rely on (ADR 0044): the checkout's wrangler.toml must say the same.
const VARS = { DEFAULT_PRESET: 'sq250', DEFAULT_ECC: 'M', DEFAULT_QUIET: '2', MAX_DATA_LEN: '2048', API_KEY: '' };

if (!process.argv[2]) {
  console.error('usage: node scripts/deploy-qr.mjs <checkout of investblog/qr-generator>');
  process.exit(2);
}
const co = path.resolve(process.argv[2]);
const git = (...args) => execFileSync('git', ['-C', co, ...args], { encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD');
if (head !== QR_COMMIT) throw new Error(`${co} is at ${head}, not the pinned ${QR_COMMIT}`);
const dirty = git('status', '--porcelain', '--untracked-files=no');
if (dirty) throw new Error(`tracked files changed in ${co}:\n${dirty}`);

// wrangler.toml: `name = "…"`, `compatibility_date = "…"`, and `KEY = "…"` lines under [vars].
const toml = fs.readFileSync(path.join(co, 'wrangler.toml'), 'utf8');
const vars = {};
let date;
let section = '';
for (const line of toml.split(/\r?\n/u)) {
  const s = /^\s*\[([^\]]+)\]\s*$/u.exec(line);
  if (s) { section = s[1]; continue; }
  const kv = /^\s*([A-Za-z_]+)\s*=\s*"([^"]*)"\s*$/u.exec(line);
  if (!kv) continue;
  if (section === 'vars') vars[kv[1]] = kv[2];
  else if (section === '' && kv[1] === 'compatibility_date') date = kv[2];
}
const sorted = (o) => JSON.stringify(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
if (sorted(vars) !== sorted(VARS))
  throw new Error(`${co}/wrangler.toml [vars] differ from the contract: ${JSON.stringify(vars)}`);
if (!date) throw new Error(`${co}/wrangler.toml has no compatibility_date`);

// Its own tests are the reference for the contract (53 at the pinned commit).
execFileSync(process.execPath, [path.join(co, 'node_modules/vitest/vitest.mjs'), 'run'], { cwd: co, stdio: 'inherit' });

// wrangler reads .env files from the working directory (clx's) whatever --config says, and a few of
// its variables (WRANGLER_CI_OVERRIDE_NAME, CLOUDFLARE_ENV) would rename or redirect the upload: it
// gets this script's own --config and an empty --env-file, and an environment without them (names
// compared without case: Windows does).
const childEnv = { ...process.env };
for (const k of Object.keys(childEnv)) if (/^(WRANGLER_|CLOUDFLARE_ENV$)/iu.test(k)) delete childEnv[k];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clx-qr-'));
try {
  const file = path.join(dir, 'wrangler.json');
  const envFile = path.join(dir, 'empty.env');
  const wrangler = (args, opts = {}) =>
    execFileSync(process.execPath, ['scripts/wrangler.mjs', ...args, '--config', file, '--env-file', envFile], { env: childEnv, ...opts });
  const config = {
    name: NAME,
    main: path.resolve(co, 'src/worker.ts'),
    compatibility_date: date,
    // No workers.dev or preview address, no logs: the data is in the query string (ADR 0044).
    workers_dev: false,
    preview_urls: false,
    observability: { enabled: false },
    routes: [{ pattern: HOST, custom_domain: true }],
    vars: Object.fromEntries(Object.entries(VARS).filter(([, v]) => v !== '')),
  };
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  fs.writeFileSync(envFile, '');

  // A deploy keeps the worker's secrets: an API_KEY set by hand would close the free API. None may exist.
  let secrets = [];
  try {
    secrets = JSON.parse(wrangler(['secret', 'list', '--format', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (e) {
    // Only a first deploy may pass here: wrangler's own words for a worker that does not exist yet.
    if (!`${e.stdout}${e.stderr}`.includes(`Worker "${NAME}" not found`)) throw e;
  }
  if (secrets.length) throw new Error(`${NAME} has secrets (${secrets.map((s) => s.name).join(', ')}): remove them first`);

  wrangler(['deploy'], { stdio: 'inherit' });
  console.log(`deployed ${NAME} from qr-generator ${QR_COMMIT.slice(0, 7)} to https://${HOST}`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
