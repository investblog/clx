---
title: The QR code comes from @spintax/qr-svg on npm; the copy in the repository goes
type: decision
status: accepted
date: 2026-10-22
---

# 0033. The QR code comes from `@spintax/qr-svg` on npm

Supersedes [0009](./0009-qr-copy-in-repo.md).

**Context.** ADR 0009 kept a copy of the QR library in `src/qr/` until it was on npm, under the
name `@301st/qr-svg`. No `301st` scope exists on npm; the owner's other open libraries are published
under the `spintax` account. On 22.10 the library was published as **`@spintax/qr-svg` 0.1.0**
(MIT, `github.com/investblog/qr-svg`, with provenance), and on the way it lost its one dependency:
the uqr encoder is ported into it, and a test there compares every matrix with uqr 0.1.3 module for
module. Its own golden SVG is the one `src/qr/` was tested against.

**Decision.** clx depends on `@spintax/qr-svg`, pinned to the exact version (the package promises
byte-identical output only within a minor version). `src/qr/`, its tests and fixture, and the `uqr`
and `jsqr` dependencies go. The package is one UMD file, so clx imports it by default
(`import QR from '@spintax/qr-svg'`): Node's ESM loader does not see its named exports. The site's
example QR (`site/products.ts`) keeps its own one-subpath-per-module drawing and takes only the
matrix from the package.

**Alternatives.** Keeping the copy — two places to fix one bug. Publishing as `@301st/qr-svg` — an
npm organisation for one package.

**Consequences.** The QR codes clx serves do not change: same matrix, same SVG
(`test/links.test.ts` and `test/site.test.ts` compare against the package). The library's tests and
its reading back with jsQR live in its own repository. An update is a version bump here, checked
against its CHANGELOG.
