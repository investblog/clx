# clx

A free, open visit counter and short-link service for sites on Cloudflare, at [clx.cx](https://clx.cx).

- **Counter** — no cookies, no third-party address in the page: the beacon goes to a path on your own
  site.
- **Short links** on your own domain, a QR code for every link, rules by country and device.
- **Reports** — views, visitors, clicks, pages, sources, countries, devices, browsers, OS, bots.

The counting runs in a worker that clx installs into **your** Cloudflare account, on your quotas;
clx.cx keeps your sign-in, settings and summary totals, and reads the details from your account only
when you open a report.

## Status

v2 is being built — the design is in [`docs/spec.md`](docs/spec.md), the stages in its §14. Today the
repository holds sign-in and the page shell; the counter, links and reports come with stages 2–5.

## Development

Node.js 22 or newer, pnpm.

```sh
pnpm install
pnpm run lint
pnpm test          # vitest with a real local D1 (wrangler's platform proxy)
```

## Running your own copy

```sh
pnpm install
node scripts/wrangler.mjs login
node scripts/wrangler.mjs d1 create clx
node scripts/wrangler.mjs kv namespace create SESSIONS
cp wrangler.example.jsonc wrangler.jsonc     # then fill in your route, the D1 and KV ids
node scripts/wrangler.mjs d1 migrations apply clx --remote
node scripts/secrets.mjs                     # sets JWT_SECRET
pnpm run deploy
node scripts/user.mjs add you@example.com    # the password goes to .secrets/
```

`scripts/wrangler.mjs` runs the repository's own wrangler. With a `.secrets/cloudflare.env`
(`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) it uses that token instead of your login;
`scripts/make-token.mjs` makes such a scoped token for the clx.cx deployment.

## License

[AGPL-3.0](LICENSE). The QR code library, `@301st/qr-svg`, is a separate MIT package.
