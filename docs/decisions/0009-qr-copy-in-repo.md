---
title: The QR library is copied into the repository until it is on npm
type: decision
status: accepted
date: 2026-10-06
---

# 0009. The QR library is copied into the repository until it is on npm

**Context.** The spec had clx take `@301st/qr-svg` from a local folder (`file:`) until the package
is published. The clx repository is public: a `file:` dependency puts a path to a private folder
into `package.json`, and a clone could not install it. Publishing first waits on the npm
organisation, which is the owner's step.

**Decision.** The package's source is copied into `src/qr/` with its MIT license file (which covers
that folder) and its tests (`test/qr.test.ts`, decoding the SVG back with `jsqr`); its one
dependency, `uqr`, comes from npm. Once `@301st/qr-svg` is published, clx depends on it and the
copy goes. The QR is built on clx.cx (`GET /v1/links/{id}/qr.svg`), not in the browser, so API
clients get the same image.

**Alternatives.** Publishing to npm first — blocks stage 5 on an account step, for no difference in
the image. A `file:` dependency — leaks a private path and breaks installs from a clone.
Generating the QR in the browser (as some link shorteners do) — leaves API clients without one.
Open link shorteners keep a copy of their QR generator in the repository too (Dub vendors Nayuki's
`qrcodegen`, Kutt ships `qrcode.min.js`).

**Consequences.** Two copies of the same code until the package is published; changes go to the
package first and are copied here. The repository's AGPL-3.0 covers clx; `src/qr/` stays MIT.
