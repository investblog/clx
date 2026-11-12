---
title: The free QR API lives on qr.clx.cx as a worker of its own, deployed from qr-generator at a pinned commit
type: decision
status: accepted
date: 2026-11-12
---

# 0044. The free QR API on qr.clx.cx

**Context.** The owner's free QR code generator — a browser extension and an API of SVG images —
moves from its own domain to clx, so that it leads to clx. The API is the worker of
`github.com/investblog/qr-generator` (MIT, public): stateless, no storage, no cache on its canonical
path. Its contract is fixed by the extension's links, which people embed on their own pages:
- `GET /qr/<preset>/<sha256>.svg?data=…&ecc=…&q=…` — the canonical image. The hash is SHA-256 of
  `${data}|p=${preset}|ecc=${ecc}|q=${quiet}|fg=000|bg=fff|r=v1` (data trimmed, ecc upper-cased);
  without `data`, `ecc` or `q`, or with a hash that does not match, `400`; rebuilt on every request,
  `Cache-Control: public, max-age=31536000, immutable`, the hash as `ETag`. A bare path (no query) is
  `400` — the owner dropped the old bare links.
- `GET /qr.svg?data=…` — `302` to the canonical image; `GET /qr.inline?…` — the SVG, cached 24 hours.
- Defaults `sq250`, `M`, quiet zone 2; at most 2,048 UTF-16 units of data before encoding.

The hash does not name the host, so moving the API is one constant in the extension. §1 said
"clx.cx carries no user traffic": images embedded on other sites are other people's traffic.

**Decision.**
- The API answers on **`qr.clx.cx`**, a Workers Custom Domain on clx's own account (Workers Paid),
  served by a worker of its own, **`clx-qr`** — not by the product's worker `clx`. It has no
  bindings (no D1, KV, R2; the deploy refuses a worker with secrets), no workers.dev address, no
  preview URLs and no logs (observability off): the data is in the query string, and clx stores none
  of it. The one copy that exists is Cloudflare's edge cache of `/qr.inline` answers (the worker's
  `caches.default`, keyed by the full URL, 24 hours); the canonical image is never cached server-side.
- The code is qr-generator at a **pinned commit**. `scripts/deploy-qr.mjs <checkout>` refuses another
  commit or a changed tracked file, checks the checkout's vars against the contract above, runs its
  tests (the reference for the contract), writes its own wrangler config in a temporary folder and
  uploads through `scripts/wrangler.mjs` (the `clx-deploy` token). An update is a new pin here,
  reviewed like any change. qr-generator's own `deploy.yml` deploys elsewhere and is not a path to
  `qr.clx.cx`.
- The link QR of the product, `GET /v1/links/{id}/qr.svg` ([ADR 0033](./0033-qr-from-npm.md)), does
  not change and does not share code with the API.

**Alternatives.**
- A path on clx.cx in the product's worker — its deploys, errors and `run_worker_first` list would
  carry the embeds, and an embed's request would run next to sign-in and the API.
- Rendering with `@spintax/qr-svg` inside clx — the presets and every byte of the images would have to
  match qr-generator's tests first; work with no gain while the worker exists and is tested.
- Another Cloudflare account — another token and bill for about 8,000 requests a month.
- `qr.clx.cx` routed (a proxied record plus a route) instead of a Custom Domain — needs DNS Write,
  which the deploy token does not have (`cloudflare-facts.md`, 11.10.2026).

**Consequences.**
- clx.cx's domain now carries other sites' visitors: a page that embeds an image sends its viewer's
  IP address, User-Agent and `Referer`, with the encoded data in the URL, to Cloudflare's edge at
  `qr.clx.cx`. The privacy page and the abuse page must say so before the extension switches to the
  new host; the generator's pages, the API's documentation and its policy are the next step of this
  move (§16). A QR code is not a redirect: `qr.clx.cx` draws what it is asked to and sends no one
  anywhere.
- Every view of an embedded canonical image that the browser has not cached is one request on clx's
  quota (10M a month included, then $0.30 per million, §8); the year-long `immutable` header spares
  repeat views, the edge cache spares repeated `/qr.inline` calls. The switch-off is the
  Custom Domain's removal (`DELETE …/workers/domains/{id}`) or `wrangler delete --name clx-qr`.
- `qr.clx.cx` is on Cloudflare, which `ru.clx.cx` left (ADR 0030): from Russia its images may not
  load without a VPN. The Russian pages must say so; there is no mirror.
- The host is permanent once the extension ships with it and its links are embedded.
- qr-generator's MIT notice stays in its repository; clx's repository holds only the deploy script and its
  live check, `scripts/probe-qr.mjs`.
