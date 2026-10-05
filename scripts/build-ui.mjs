#!/usr/bin/env node
// node scripts/build-ui.mjs — bundles the reports' client (ui/) into public/app.js, which Workers
// Static Assets serve. The bundle is built, not committed: `build` and `deploy` run this first.
import { build } from 'esbuild';

await build({
  entryPoints: ['ui/main.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
  outfile: 'public/app.js',
  legalComments: 'none',
  logLevel: 'warning',
});
console.log('public/app.js built');
