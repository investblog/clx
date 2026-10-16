#!/usr/bin/env node
// node scripts/deploy-ru.mjs <git URL of the Russian host's repository>
//
// Publishes the Russian host (docs/spec.md §16, ADR 0030): the built directory (dist-ru/, from
// `node scripts/build-ui.mjs` with the Russian host on — site/urls.ts) goes to the repository's
// `gh-pages` branch as one orphan commit, made in a temporary folder: this repository's history and
// working tree take no part, and only the files of site/ru-files.ts are copied, so nothing but the
// built host can leave with it (scripts/check-site.mjs refuses a build with anything else). GitHub Pages serves
// the branch; its CNAME names the host. The repository is a public one that holds only the build
// (GitHub's free plan serves Pages from public repositories only).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ruHostFiles } from '../site/ru-files.ts';
import { RU_ORIGIN } from '../site/urls.ts';

const remote = process.argv[2];
if (!remote) {
  console.error('usage: node scripts/deploy-ru.mjs <git URL of the Russian host repository>');
  process.exit(2);
}
const SRC = process.env.CLX_RU_OUT || 'dist-ru';
if (!RU_ORIGIN) throw new Error('the Russian host is off (site/urls.ts RU_LIVE): nothing to publish');
if (!fs.existsSync(path.join(SRC, 'index.html')) || fs.readFileSync(path.join(SRC, 'CNAME'), 'utf8').trim() !== new URL(RU_ORIGIN).hostname)
  throw new Error(`${SRC}/ is not a build of ${RU_ORIGIN}: run node scripts/build-ui.mjs and node scripts/check-site.mjs first`);

// The build is checked here too, not only trusted to have been: a failed check stops the publish.
execFileSync(process.execPath, ['scripts/check-site.mjs'], { stdio: 'inherit' });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clx-ru-'));
const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
try {
  // Exactly the host's files (site/ru-files.ts), not the folder: nothing else can be published.
  for (const f of ruHostFiles()) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  }
  git('init', '-q', '-b', 'gh-pages');
  git('add', '-A');
  git('-c', 'user.name=clx build', '-c', 'user.email=build@clx.cx', 'commit', '-q', '-m', `build ${new Date().toISOString()}`);
  git('push', '-q', '--force', remote, 'gh-pages');
  console.log(`${RU_ORIGIN}: ${git('ls-files').split('\n').filter(Boolean).length} files pushed to gh-pages`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
