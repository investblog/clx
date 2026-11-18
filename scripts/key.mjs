#!/usr/bin/env node
// node scripts/key.mjs issue <email> <scope,scope…> [--allow-accounts id,id] [--allow-ips ip,ip]
//
// An API key for a user made by scripts/user.mjs, issued the way a person issues one: sign in
// (POST /auth/login with the password of .secrets/user-<email>.txt), then POST /v1/keys with that
// page session, then sign out. Nothing reaches the database but through the API. The key is shown
// once: it is written to .secrets/key-<email>-<prefix>.txt for the owner to hand to the agent that
// needs it, and only its prefix is printed. No key is left issued and unsaved: a key whose answer
// was lost or whose file could not be written is revoked. CLX_ORIGIN overrides https://clx.cx (a
// local `wrangler dev`).
import crypto from 'node:crypto';
import fs from 'node:fs';
import { lockSecrets, SECRETS } from './secrets-dir.mjs';

const ORIGIN = process.env.CLX_ORIGIN || 'https://clx.cx';
const SCOPES = ['accounts', 'sites', 'links', 'reports', 'billing'];
const UA = 'clx-scripts/key';
const USAGE = `usage: node scripts/key.mjs issue <email> <${SCOPES.join('|')},…> [--allow-accounts id,…] [--allow-ips ip,…]`;

const usage = () => {
  console.error(USAGE);
  process.exit(2);
};
const [cmd, rawEmail, rawScopes, ...rest] = process.argv.slice(2);
// Only the two flags, each with a value: a mistyped or empty one would issue a key without the limit.
const limits = {};
for (let i = 0; i < rest.length; i += 2) {
  const [flag, value] = [rest[i], rest[i + 1]];
  const field = { '--allow-accounts': 'allow_accounts', '--allow-ips': 'allow_ips' }[flag];
  const list = value?.split(',').filter(Boolean);
  if (!field || field in limits || !list?.length || value.startsWith('--')) usage();
  limits[field] = list;
}
const email = (rawEmail ?? '').trim().toLowerCase();
const scopes = (rawScopes ?? '').split(',').filter(Boolean);
if (cmd !== 'issue' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || !scopes.length || !scopes.every((s) => SCOPES.includes(s))) usage();

lockSecrets();
const safe = email.replace(/[^a-z0-9@._-]/gu, '_');
const userFile = `${SECRETS}/user-${safe}.txt`;
if (!fs.existsSync(userFile)) {
  console.error(`no ${userFile}: the password of a user made by scripts/user.mjs is needed`);
  process.exit(1);
}
const [fileEmail, password] = fs.readFileSync(userFile, 'utf8').split(/\r?\n/u);
if (fileEmail?.trim().toLowerCase() !== email || !password) throw new Error(`${userFile} does not hold ${email} and a password`);

async function call(path, init) {
  const res = await fetch(`${ORIGIN}${path}`, { ...init, headers: { 'user-agent': UA, 'content-type': 'application/json', ...init.headers } });
  const body = await res.json().catch(() => null);
  return { res, body };
}

const login = await call('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
if (!login.res.ok || !login.body?.access_token) throw new Error(`sign-in failed: ${login.res.status} ${login.body?.error ?? ''}`);
const auth = { authorization: `Bearer ${login.body.access_token}` };
const refresh = login.res.headers.getSetCookie().find((c) => c.startsWith('clx_refresh='))?.split(';')[0];

async function revoke(id) {
  const r = await call(`/v1/keys/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { ...auth, 'idempotency-key': crypto.randomUUID() } }).catch((e) => ({ res: { ok: false, status: e.message } }));
  return r.res.ok ? `key ${id} revoked` : `key ${id} NOT revoked (${r.res.status}): revoke it on the Keys page`;
}

try {
  // One Idempotency-Key for every try: a retry after a lost answer finds the key already issued
  // (409 key_already_issued with its id) instead of issuing a second one.
  const idem = crypto.randomUUID();
  const body = JSON.stringify({ scopes, ...limits });
  let issued;
  for (let attempt = 1; ; attempt++) {
    issued = await call('/v1/keys', { method: 'POST', headers: { ...auth, 'idempotency-key': idem }, body }).catch((e) => ({ res: { status: 0 }, body: null, error: e }));
    const lost = issued.res.status === 0 || issued.res.status >= 500 || (issued.res.status === 201 && !issued.body?.key) || issued.body?.error?.code === 'operation_in_progress';
    if (!lost || attempt === 4) break;
    // A claim with no answer stays in flight for 60 s (src/v1/idempotency.ts): the next try comes
    // after it, when the server either replays the issued key's id or lets this try issue it.
    await new Promise((r) => setTimeout(r, issued.body?.error?.code === 'operation_in_progress' ? 65_000 : 2000 * attempt));
  }
  const err = issued.body?.error;
  if (issued.res.status === 409 && err?.code === 'key_already_issued') {
    // Issued by a try whose answer was lost: it can never be shown again.
    const id = err.details?.key_id;
    throw new Error(`a key was issued but its answer was lost; ${id ? await revoke(id) : 'its id is unknown: check the Keys page'}`);
  }
  // After a lost answer or a call still running, a key may exist: the Keys page shows it.
  if (issued.res.status !== 201 || !issued.body?.key) throw new Error(`issuing failed: ${issued.res.status} ${issued.error?.message ?? JSON.stringify(err ?? issued.body)}; if a try may have reached the server, check the Keys page for a key to revoke`);
  const k = issued.body;
  const out = `${SECRETS}/key-${safe}-${k.prefix}.txt`;
  try {
    fs.writeFileSync(out, `${k.key}\n# ${email} · id ${k.id} · scopes ${k.scopes.join(',')} · accounts ${k.allow_accounts?.join(',') ?? 'any'} · ips ${k.allow_ips?.join(',') ?? 'any'} · ${k.created_at}\n`, { mode: 0o600, flag: 'wx' });
  } catch (e) {
    throw new Error(`the key could not be saved (${e.message}); ${await revoke(k.id)}`);
  }
  console.log(`key ${k.prefix}… (id ${k.id}, scopes ${k.scopes.join(',')}) for ${email} in ${out}`);
} finally {
  // The session was only for this: its refresh session goes now, not when it expires.
  const out = refresh ? await call('/auth/logout', { method: 'POST', headers: { cookie: refresh } }).catch(() => null) : null;
  if (!out?.res.ok) console.warn(`warning: sign-out failed${refresh ? '' : ' (no refresh cookie)'}; the session ends by itself, or with a new password (scripts/user.mjs password)`);
}
