#!/usr/bin/env node
// node scripts/probe-qr.mjs [base] [reference]
//
// Live check of the QR API (ADR 0044) at base (default https://qr.clx.cx). Builds canonical URLs
// with its own SHA-256 of the contract's payload, so the hash rule is checked too, not only reused.
// With a reference origin (another deployment of the same qr-generator rendering), every 200 SVG
// must equal the reference's byte for byte. Read-only: GET and one POST, nothing is created.
// Prints one line per check and exits 1 if any failed.
import { createHash } from 'node:crypto';
import QR from '@spintax/qr-svg';

const BASE = (process.argv[2] || 'https://qr.clx.cx').replace(/\/$/u, '');
const REF = process.argv[3]?.replace(/\/$/u, '');
let failed = 0;

const hash = ({ data, preset, ecc, q }) =>
  createHash('sha256').update(`${data}|p=${preset}|ecc=${ecc}|q=${q}|fg=000|bg=fff|r=v1`, 'utf8').digest('hex');
const canonical = (p, query = p) =>
  `/qr/${p.preset}/${hash(p)}.svg?data=${encodeURIComponent(query.data)}&ecc=${query.ecc}&q=${query.q}`;

async function check(name, path, want, opts = {}) {
  const url = BASE + path;
  let res;
  try {
    res = await fetch(url, { redirect: opts.follow ? 'follow' : 'manual', method: opts.method || 'GET' });
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message}`);
    failed++;
    return;
  }
  const body = await res.text();
  const problems = [];
  if (res.status !== want.status) problems.push(`status ${res.status}, want ${want.status} (${body.slice(0, 120)})`);
  for (const [h, v] of Object.entries(want.headers || {})) {
    const got = res.headers.get(h);
    if (v instanceof RegExp ? !v.test(got ?? '') : got !== v) problems.push(`${h}: ${got}`);
  }
  if (want.status === 200 && !body.startsWith('<svg')) problems.push('body is not an SVG');
  if (want.status === 200 && REF) {
    const ref = await (await fetch(REF + path, { redirect: opts.follow ? 'follow' : 'manual' })).text();
    if (ref !== body) problems.push(`body differs from ${REF}`);
  }
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name}: ${res.status}, URL ${url.length} chars, body ${body.length}` +
    (problems.length ? ` — ${problems.join('; ')}` : ''));
  if (problems.length) failed++;
}

const svg = { 'content-type': 'image/svg+xml; charset=utf-8' };
const immutable = { ...svg, 'cache-control': 'public, max-age=31536000, immutable' };
const p = { data: 'https://example.com/a?x=1&y=два', preset: 'sq250', ecc: 'M', q: 2 };
const bare = `/qr/${p.preset}/${hash(p)}.svg`;

// Cloudflare weakens the ETag when it compresses the answer (W/"…"); the hash is the same.
await check('canonical with data', canonical(p), { status: 200, headers: { ...immutable, etag: new RegExp(`^(W/)?"${hash(p)}"$`, 'u') } });
await check('bare path', bare, { status: 400 });
await check('data swapped, same hash', canonical(p, { ...p, data: 'https://phish.example/login' }), { status: 400 });
await check('no ecc', `${bare}?data=${encodeURIComponent(p.data)}&q=2`, { status: 400 });
await check('no q', `${bare}?data=${encodeURIComponent(p.data)}&ecc=M`, { status: 400 });
await check('lowercase ecc, padded data', canonical(p, { ...p, data: `  ${p.data} `, ecc: 'm' }), { status: 200, headers: immutable });
await check('other preset, ecc, q', canonical({ data: 'hello', preset: 'sq125', ecc: 'H', q: 0 }), { status: 200, headers: immutable });
await check('/qr.svg → 302', `/qr.svg?data=${encodeURIComponent(p.data)}&ecc=M&q=2`, {
  status: 302,
  headers: { location: canonical(p) },
});
await check('/qr.svg followed → 200', `/qr.svg?data=${encodeURIComponent(p.data)}&ecc=M&q=2`, { status: 200, headers: immutable }, { follow: true });
await check('/qr.inline', `/qr.inline?data=${encodeURIComponent(p.data)}&ecc=M&q=2`, {
  status: 200,
  headers: { ...svg, 'cache-control': 'public, max-age=86400' },
});
// The biggest QR: version 40 at ECC L holds 2,953 bytes — 984 three-byte characters (2,952 bytes).
const big = { data: '€'.repeat(984), preset: 'sq250', ecc: 'L', q: 2 };
await check('largest Unicode QR (984 × 3 bytes, ECC L)', canonical(big), { status: 200, headers: immutable });
await check('2,048 ASCII, ECC L', canonical({ data: 'a'.repeat(2048), preset: 'sq250', ecc: 'L', q: 2 }), { status: 200, headers: immutable });
await check('2,049 characters → 413', canonical({ data: 'a'.repeat(2049), preset: 'sq250', ecc: 'L', q: 2 }), { status: 413 });
// Past the QR's capacity, within MAX_DATA_LEN: the QR's capacity binds, not Cloudflare's URL size —
// an 18.5 KB URL reaches the worker, which answers 500 (measured 12.11.2026).
const over = { data: '€'.repeat(2048), preset: 'sq250', ecc: 'L', q: 2 };
await check('2,048 × 3 bytes (URL ~18.5 KB): over the QR capacity', canonical(over), { status: 500 });
await check('POST → 404', canonical(p), { status: 404 }, { method: 'POST' });
await check('unknown path → 404', '/', { status: 404 });

// The generator page (site/qr.ts, ADR 0045) draws with @spintax/qr-svg and promises the API's image
// byte for byte: every preset, every level, several margins.
const W = { sq125: 125, sq200: 200, sq250: 250, sq300: 300 };
const parity = [['https://example.com/a', 'sq125', 'L', 0], ['hello', 'sq200', 'M', 2], ['Привет, мир! € 😀', 'sq250', 'Q', 4], ['€'.repeat(400), 'sq300', 'H', 16]];
for (const [data, preset, ecc, q] of parity) {
  const name = `same SVG as @spintax/qr-svg (${preset}, ${ecc}, q=${q})`;
  try {
    const body = await (await fetch(BASE + canonical({ data, preset, ecc, q }))).text();
    const local = QR.renderSvg(QR.generateMatrix(data, { ecc }), { quiet: q, size: W[preset] });
    console.log(`${body === local ? 'ok  ' : 'FAIL'} ${name}`);
    if (body !== local) failed++;
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message}`);
    failed++;
  }
}

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
