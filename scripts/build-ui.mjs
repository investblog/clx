#!/usr/bin/env node
// node scripts/build-ui.mjs — builds what Workers Static Assets serve: the app's client (ui/ →
// public/app.js), the site pages' script (site/client.ts → public/site.js), the stylesheet (ui/css/ →
// public/app.css), then the site pages, the app's page, robots.txt and sitemap.xml (site/build.ts).
// The output is built, not committed:
// `build` and `deploy` run this first, and scripts/check-site.mjs checks it.
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const common = { bundle: true, minify: true, format: 'iife', target: 'es2022', legalComments: 'none', logLevel: 'warning' };
await build({ ...common, entryPoints: ['ui/main.ts'], outfile: 'public/app.js' });
await build({ ...common, entryPoints: ['site/client.ts'], outfile: 'public/site.js' });
await build({ bundle: true, minify: true, legalComments: 'none', logLevel: 'warning', entryPoints: ['ui/css/index.css'], outfile: 'public/app.css' });
console.log('public/app.js, public/site.js, public/app.css built');
execFileSync(process.execPath, ['site/build.ts'], { stdio: 'inherit' });
