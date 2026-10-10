#!/usr/bin/env node
// node scripts/build-ui.mjs — builds what Workers Static Assets serve: the app's client (ui/ →
// public/app.js), the site pages' script (site/client.ts → public/site.js), the stylesheet (ui/css/ →
// public/app.css), then the site pages, the app's page, robots.txt and sitemap.xml (site/build.ts), then
// the pages' Open Graph cards (scripts/build-og.mjs).
// The output is built, not committed:
// `build` and `deploy` run this first, and scripts/check-site.mjs checks it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { build } from 'esbuild';

const common = { bundle: true, minify: true, format: 'iife', target: 'es2022', legalComments: 'none', logLevel: 'warning' };
// The app bundles affiliate-charts (MIT): its licence goes with it, in full, at the end of the script.
const licence = fs.readFileSync('node_modules/affiliate-charts/LICENSE', 'utf8').trim();
await build({ ...common, entryPoints: ['ui/main.ts'], outfile: 'public/app.js', footer: { js: `/*! affiliate-charts\n${licence}\n*/` } });
await build({ ...common, entryPoints: ['site/client.ts'], outfile: 'public/site.js' });
// The fonts are static files next to the stylesheet (public/fonts), not something to bundle.
await build({ bundle: true, minify: true, legalComments: 'none', logLevel: 'warning', external: ['/fonts/*'], entryPoints: ['ui/css/index.css'], outfile: 'public/app.css' });
console.log('public/app.js, public/site.js, public/app.css built');
execFileSync(process.execPath, ['site/build.ts'], { stdio: 'inherit' });
// The Open Graph cards of the pages just written (scripts/build-og.mjs reads them).
execFileSync(process.execPath, ['scripts/build-og.mjs'], { stdio: 'inherit' });
