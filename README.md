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

v2 is being built — the design is in [`docs/spec.md`](docs/spec.md), the stages in its §14, the API
contract in [`docs/openapi.yaml`](docs/openapi.yaml), and what Cloudflare was found to do on a live
account in [`docs/cloudflare-facts.md`](docs/cloudflare-facts.md). Done: sign-in, the management API
(API keys, connecting a Cloudflare account) and installing, updating and removing the `clx-edge`
worker (`edge/`) in a connected account. The counter, links and reports come with stages 4–6.

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
cp wrangler.example.jsonc wrangler.jsonc     # then fill in your route, the D1 and KV ids, HOOK_URL
node scripts/wrangler.mjs d1 migrations apply clx --remote
node scripts/secrets.mjs JWT_SECRET
node scripts/secrets.mjs MASTER_KEYS         # seals users' Cloudflare tokens; set once
pnpm run deploy
node scripts/user.mjs add you@example.com    # the password goes to .secrets/
node scripts/user.mjs admin you@example.com on   # rollouts of clx-edge (docs/spec.md §4)
```

`scripts/wrangler.mjs` runs the repository's own wrangler. With a `.secrets/cloudflare.env`
(`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) it uses that token instead of your login;
`scripts/make-token.mjs` makes such a scoped token for the clx.cx deployment.

## License

[AGPL-3.0](LICENSE). The QR code library, `@301st/qr-svg`, is a separate MIT package; until it is
published on npm a copy lives in [`src/qr/`](src/qr/) under its own [MIT license](src/qr/LICENSE).
