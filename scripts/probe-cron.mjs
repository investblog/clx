#!/usr/bin/env node
// node scripts/probe-cron.mjs inventory
// node scripts/probe-cron.mjs fresh [scripts = 5] [minutes = 90]
// node scripts/probe-cron.mjs recreate [delays = 1,1,10,10] [minutes = 90]
// node scripts/probe-cron.mjs clx [scripts = 2] [minutes = 180]
// node scripts/probe-cron.mjs report | cleanup
//
// The cron stand (docs/TODO.md, "a new script's crons may not fire"): on the throwaway Cloudflare
// account of .secrets/test-cloudflare.env, with its Global API Key, without clx.cx. Each stand
// script is uploaded the way clx uploads clx-edge (PUT the script, then PUT …/schedules) with the
// cron `* * * * *`; its `scheduled` handler writes one row per run into the D1 database
// `cron-stand`. The rows are the ground truth of when a cron fired.
//   inventory — the account's scripts with their crons, and its databases;
//   fresh     — N new scripts with unique names, uploaded within the same minute, watched until
//               every one has fired and 15 more minutes have passed, or the time is up; the
//               scripts are left running for `report` (hours later) and `recreate`;
//   recreate  — the scripts of the last run deleted and created again under the same name, the
//               i-th after delays[i] minutes (`recreate 1,1,10,10 [minutes]`); the rest go on
//               untouched as the control. It does not clean up: `report`, then `cleanup`;
//   clx       — clx's own pattern: both crons at upload, replaced by the working one at the first
//               self-check run (`clx [scripts = 2] [minutes = 180]`; two crons per script);
//   report    — every script's runs so far by scheduled time: never ran, delivered twice, late;
//   cleanup   — deletes every `cron-stand-<run>-<n>` script and the database; any other name in
//               the state file stops every mode before it deletes anything.
// Every name is written to temp/probe-cron.state.json before it is created, so `cleanup` works
// after a run that was killed. Run it into a file (`> temp/probe-cron.log`), never through `head`.
// Nothing secret is printed.
import fs from 'node:fs';
import { lockSecrets } from './secrets-dir.mjs';

const CF = 'https://api.cloudflare.com/client/v4';
const PREFIX = 'cron-stand-';
const DB = 'cron-stand';
const STATE = 'temp/probe-cron.state.json';
lockSecrets();
const env = Object.fromEntries(
  fs
    .readFileSync('.secrets/test-cloudflare.env', 'utf8')
    .split(/\r?\n/u)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/u, '$2')]),
);
const account = env.CF_ACCOUNT_ID;
const acc = `/accounts/${account}`;
const admin = { 'X-Auth-Email': env.CF_EMAIL, 'X-Auth-Key': env.CF_GLOBAL_API_KEY };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const log = (...a) => console.log(now(), ...a);

async function cf(method, path, body, { ok404 = false } = {}) {
  const init = { method, headers: { ...admin } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  // A run lasts an hour or more: a dropped or hung connection, a 429 or a 5xx is retried, not the
  // end of the run (22.10 a lost connection ended the first one without its cleanup).
  for (let i = 1; ; i++) {
    let res;
    let json;
    try {
      res = await fetch(`${CF}${path}`, { ...init, signal: AbortSignal.timeout(60_000) });
      if (ok404 && res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
    } catch (e) {
      if (i === 10) throw e;
      log('retry', i, `${method} ${path.replace(acc, '')}:`, e.cause?.code ?? e.message);
      await sleep(30_000);
      continue;
    }
    if (!json.success) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json.errors)}`);
    return json.result;
  }
}

/** A name this stand made: nothing else is ever deleted, whatever the state file says. */
const OURS = /^cron-stand-[a-z0-9]+-\d+$/u;
function readState() {
  if (!fs.existsSync(STATE)) return { scripts: [] };
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const foreign = state.scripts.filter((s) => !OURS.test(s));
  if (foreign.length) throw new Error(`${STATE} names scripts the stand did not make: ${foreign.join(', ')}`);
  return state;
}
/** Written to a temporary file and renamed, so a killed run leaves the old state or the new one. */
const writeState = (s) => {
  fs.mkdirSync('temp', { recursive: true });
  fs.writeFileSync(`${STATE}.tmp`, JSON.stringify(s, null, 2));
  fs.renameSync(`${STATE}.tmp`, STATE);
};

const scripts = () => cf('GET', `${acc}/workers/scripts`);
const schedules = async (name) => ((await cf('GET', `${acc}/workers/scripts/${name}/schedules`, undefined, { ok404: true }))?.schedules ?? []).map((s) => s.cron);
const database = async () => (await cf('GET', `${acc}/d1/database?name=${DB}`)).find((d) => d.name === DB);
const query = async (uuid, sql, params = []) => (await cf('POST', `${acc}/d1/database/${uuid}/query`, { sql, params }))[0].results;

/** Cron triggers held by the account's scripts (only a `scheduled` handler can hold one). */
async function inventory() {
  const list = await scripts();
  let used = 0;
  for (const s of list) {
    const crons = s.handlers?.includes('scheduled') ? await schedules(s.id) : [];
    used += crons.length;
    log('script', s.id, `created ${s.created_on}`, `modified ${s.modified_on}`, crons.length ? `crons ${crons.join(', ')}` : 'no crons');
  }
  const dbs = (await cf('GET', `${acc}/d1/database?per_page=100`)).map((d) => d.name);
  log(`crons in use: ${used} of 5`, '| databases:', dbs.join(', ') || 'none');
  return used;
}

const WORKER = `export default {
  async scheduled(event, env) {
    await env.DB.prepare('INSERT INTO fired (script, upload, at, scheduled, cron) VALUES (?, ?, ?, ?, ?)').bind(env.NAME, env.UPLOAD, Date.now(), event.scheduledTime, event.cron).run();
  },
};`;

/** Each upload's id, by script name: the rows of a re-created script are told from its earlier self's. */
const uploads = {};

async function upload(name, dbId) {
  uploads[name] = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const form = new FormData();
  form.append('worker.js', new Blob([WORKER], { type: 'application/javascript+module' }), 'worker.js');
  const metadata = {
    main_module: 'worker.js',
    compatibility_date: '2026-09-01',
    bindings: [
      { type: 'd1', name: 'DB', id: dbId },
      { type: 'plain_text', name: 'NAME', text: name },
      { type: 'plain_text', name: 'UPLOAD', text: uploads[name] },
    ],
  };
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  await cf('PUT', `${acc}/workers/scripts/${name}`, form);
}

async function ensureDatabase(state) {
  let db = await database();
  if (!db) {
    state.database = DB;
    writeState(state);
    // A create whose answer was lost may have worked: then the database is there to adopt.
    db = await cf('POST', `${acc}/d1/database`, { name: DB }).catch(async (e) => (await database()) ?? Promise.reject(e));
  }
  await query(db.uuid, 'CREATE TABLE IF NOT EXISTS fired (script TEXT NOT NULL, upload TEXT NOT NULL, at INTEGER NOT NULL, scheduled INTEGER NOT NULL, cron TEXT)');
  return db.uuid;
}

async function fresh(n, minutes) {
  const used = await inventory();
  if (used + n > 5) throw new Error(`only ${5 - used} cron triggers are free on the account; asked for ${n}`);
  const state = readState();
  const dbId = await ensureDatabase(state);
  const run = Date.now().toString(36);
  const names = Array.from({ length: n }, (_, i) => `${PREFIX}${run}-${i}`);
  const created = {};
  for (const name of names) {
    state.scripts.push(name);
    writeState(state);
    await upload(name, dbId);
    await cf('PUT', `${acc}/workers/scripts/${name}/schedules`, [{ cron: '* * * * *' }]);
    created[name] = Date.now();
    log('created', name, 'crons', (await schedules(name)).join(', '));
  }
  await watch(dbId, names, created, minutes);
  log('the scripts keep running: `report` reads their runs later, `recreate` re-creates them, `cleanup` ends the stand');
}

/**
 * One row per scheduled time of a script since `since` (a delivery repeated is counted once, with
 * its first arrival and how many arrived), in scheduled order. A script this process uploaded
 * counts only its own upload's rows: a run of the deleted script delivered late is not its first.
 */
const occurrences = (dbId, s, since = 0, cron = '* * * * *', upload = uploads[s] ?? null) =>
  query(
    dbId,
    'SELECT scheduled, MIN(at) AS at, COUNT(*) AS n FROM fired WHERE script = ? AND at >= ? AND cron = ? AND (?4 IS NULL OR upload = ?4) GROUP BY scheduled ORDER BY scheduled',
    [s, since, cron, upload],
  );

/**
 * Polls the rows each minute until every script has run since it was (re)created and 15 more
 * minutes have passed, or the time is up; then prints each script's runs as minutes after that.
 */
async function watch(dbId, names, created, minutes) {
  const end = Date.now() + minutes * 60_000;
  for (;;) {
    await sleep(60_000);
    const runs = Object.fromEntries(await Promise.all(names.map(async (s) => [s, await occurrences(dbId, s, created[s])])));
    log(names.map((s) => (runs[s].length ? `${s.slice(-1)}: first +${((runs[s][0].at - created[s]) / 60_000).toFixed(1)}m runs ${runs[s].length}` : `${s.slice(-1)}: —`)).join(' | '));
    const firsts = names.map((s) => runs[s][0]?.at);
    if ((firsts.every(Boolean) && Date.now() - Math.max(...firsts) > 15 * 60_000) || Date.now() > end) break;
  }
  for (const s of names) log('runs', s, (await occurrences(dbId, s, created[s])).map((r) => `+${Math.round((r.at - created[s]) / 60_000)}`).join(' ') || 'none');
}

/**
 * The scripts of the state file, deleted and created again under the same name: the i-th after
 * delays[i] minutes. Scripts beyond the delays keep running untouched, as the control.
 */
async function recreate(delays, minutes) {
  const state = readState();
  const dbId = (await database()).uuid;
  const names = state.scripts.slice(0, delays.length);
  if (names.length < delays.length) throw new Error(`the state file has ${names.length} scripts, asked to recreate ${delays.length}`);
  const deleted = {};
  for (const name of names) {
    await cf('DELETE', `${acc}/workers/scripts/${name}?force=true`);
    deleted[name] = Date.now();
    log('deleted', name);
  }
  const created = {};
  for (const [i, name] of [...names.entries()].sort((x, y) => delays[x[0]] - delays[y[0]])) {
    const wait = deleted[name] + delays[i] * 60_000 - Date.now();
    if (wait > 0) await sleep(wait);
    await upload(name, dbId);
    await cf('PUT', `${acc}/workers/scripts/${name}/schedules`, [{ cron: '* * * * *' }]);
    created[name] = Date.now();
    log('created again', name, `${((created[name] - deleted[name]) / 60_000).toFixed(1)} min after its delete`);
  }
  const control = state.scripts.slice(delays.length);
  for (const c of control) created[c] = Date.now();
  await watch(dbId, [...names, ...control], created, minutes);
}

/**
 * clx's own pattern (docs/spec.md §4): N new scripts get both crons at upload, the self-check
 * `* * * * *` and the working `5 * * * *`; at a script's first self-check run the crons are
 * replaced by the working one alone, as confirmSetup() does. Until every script is replaced the
 * rows are read every 5 s (production replaces within seconds of the self-check: the worker's own
 * request), then every minute. Watched until every script has had two working runs (two scheduled
 * times, not two deliveries) after its replacement and no self-check run for 15 minutes, or the
 * time is up.
 */
async function clxPattern(n, minutes) {
  const used = await inventory();
  if (used + 2 * n > 5) throw new Error(`only ${5 - used} cron triggers are free on the account; asked for ${2 * n}`);
  const state = readState();
  const dbId = await ensureDatabase(state);
  const run = Date.now().toString(36);
  const names = Array.from({ length: n }, (_, i) => `${PREFIX}${run}-${i}`);
  const created = {};
  const replaced = {};
  for (const name of names) {
    state.scripts.push(name);
    writeState(state);
    await upload(name, dbId);
    await cf('PUT', `${acc}/workers/scripts/${name}/schedules`, [{ cron: '* * * * *' }, { cron: '5 * * * *' }]);
    created[name] = Date.now();
    log('created', name, 'crons', (await schedules(name)).join(', '));
  }
  const min = (s, t) => `+${((t - created[s]) / 60_000).toFixed(1)}m`;
  const end = Date.now() + minutes * 60_000;
  let lastLog = 0;
  for (;;) {
    await sleep(names.every((s) => replaced[s]) ? 60_000 : 5_000);
    const status = [];
    let done = true;
    for (const s of names) {
      const check = await occurrences(dbId, s, 0, '* * * * *');
      if (check.length && !replaced[s]) {
        await cf('PUT', `${acc}/workers/scripts/${s}/schedules`, [{ cron: '5 * * * *' }]);
        replaced[s] = Date.now();
        log('replaced', s, 'by the working cron alone, at', min(s, replaced[s]), `(${((replaced[s] - check[0].at) / 1000).toFixed(0)} s after its first self-check)`, '→ crons', (await schedules(s)).join(', '));
      }
      const lastCheck = check.at(-1)?.at;
      const working = await occurrences(dbId, s, replaced[s] ?? Infinity, '5 * * * *');
      status.push(`${s.slice(-1)}: checks ${check.length}${lastCheck ? ` last ${min(s, lastCheck)}` : ''}, working ${working.length}`);
      if (!(replaced[s] && working.length >= 2 && Date.now() - (lastCheck ?? 0) > 15 * 60_000)) done = false;
    }
    if (Date.now() - lastLog >= 55_000) {
      log(status.join(' | '));
      lastLog = Date.now();
    }
    if (done || Date.now() > end) break;
  }
  for (const s of names) {
    log('runs', s, 'replaced', replaced[s] ? min(s, replaced[s]) : 'never');
    for (const cron of ['* * * * *', '5 * * * *']) {
      const runs = await occurrences(dbId, s, 0, cron);
      log(`  ${cron}:`, runs.map((x) => `${min(s, x.at)} (${new Date(x.scheduled).toISOString().slice(11, 16)}${x.n > 1 ? ` ×${x.n}` : ''})`).join(' ') || 'none');
    }
  }
  await cleanup();
}

/**
 * The every-minute runs of the scripts in the state file so far, by scheduled time: the scheduled
 * minutes between the first and the last that never arrived, those delivered more than once, and
 * those that arrived over a minute late.
 */
async function report() {
  const db = await database();
  if (!db) throw new Error(`no database ${DB}`);
  const iso = (t) => new Date(t).toISOString().slice(0, 16);
  // Each upload of a script on its own: the minutes between a delete and a re-creation are not gaps.
  const generations = [];
  for (const s of readState().scripts) {
    const ids = await query(db.uuid, 'SELECT upload FROM fired WHERE script = ? GROUP BY upload ORDER BY MIN(at)', [s]);
    if (!ids.length) log(s, 'no runs');
    for (const { upload } of ids) generations.push([s, upload]);
  }
  for (const [s, upload] of generations) {
    const runs = await occurrences(db.uuid, s, 0, '* * * * *', upload);
    if (!runs.length) continue;
    const minute = (t) => Math.floor(t / 60_000);
    const seen = new Set(runs.map((r) => minute(r.scheduled)));
    const missing = [];
    for (let m = minute(runs[0].scheduled); m <= minute(runs.at(-1).scheduled); m++) if (!seen.has(m)) missing.push(m * 60_000);
    const twice = runs.filter((r) => r.n > 1);
    const late = runs.filter((r) => r.at - r.scheduled > 60_000);
    log(s, `upload ${upload}: scheduled times run ${runs.length}, first ${iso(runs[0].scheduled)}, last ${iso(runs.at(-1).scheduled)}`);
    log('  never ran:', missing.map(iso).join(', ') || 'none');
    log('  delivered more than once:', twice.map((r) => `${iso(r.scheduled)} ×${r.n}`).join(', ') || 'none');
    log('  over a minute late:', late.map((r) => `${iso(r.scheduled)} +${Math.round((r.at - r.scheduled) / 1000)} s`).join(', ') || 'none');
  }
}

async function cleanup() {
  // A state file cut short is no reason to leave the stand behind: the account is searched too.
  let state = { scripts: [] };
  try {
    state = readState();
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    log(`${STATE} is unreadable; cleaning by the account's script names alone`);
  }
  const names = new Set([...state.scripts, ...(await scripts()).map((s) => s.id).filter((id) => OURS.test(id))]);
  for (const name of names) {
    await cf('DELETE', `${acc}/workers/scripts/${name}?force=true`, undefined, { ok404: true });
    log('deleted', name);
  }
  const db = await database();
  if (db) {
    await cf('DELETE', `${acc}/d1/database/${db.uuid}`);
    log('deleted database', DB);
  }
  writeState({ scripts: [] });
  const left = (await scripts()).map((s) => s.id).filter((id) => id.startsWith(PREFIX));
  log('left:', left.join(', ') || 'nothing');
  if (left.length) process.exitCode = 1;
}

const [mode = 'inventory', a, b] = process.argv.slice(2);
if (mode === 'inventory') await inventory();
else if (mode === 'fresh') await fresh(Number(a ?? 5), Number(b ?? 90));
else if (mode === 'recreate') await recreate((a ?? '1,1,10,10').split(',').map(Number), Number(b ?? 90));
else if (mode === 'clx') await clxPattern(Number(a ?? 2), Number(b ?? 180));
else if (mode === 'report') await report();
else if (mode === 'cleanup') await cleanup();
else throw new Error(`unknown mode ${mode}`);
