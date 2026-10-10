// vitest globalSetup: on Windows, wait for the ports of the previous run to come back.
// Miniflare closes the connection after every proxied call (`options.reset = true` in its
// DispatchFetchDispatcher), so each D1 call of a test takes one outgoing port, held ~2 min in
// TIME_WAIT after it. A full run takes ~14,000 ports (07.10): with Windows' default 16,384 dynamic
// ports a second run started sooner fails random tests with `connect EADDRINUSE`. Waiting turns that
// into a pause; a wider range (`netsh int ipv4 set dynamicport tcp start=10000 num=55000`, this
// machine since 10.10) makes it unneeded.
import { execSync } from 'node:child_process';

const NEEDED = 15_000; // free ports a full run needs, with room for other programs
const CAP = 180_000;
const run = (cmd: string) => execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function free(range: number): number {
  return range - run('netstat -ano -p tcp').split('\n').filter((l) => l.includes('TIME_WAIT')).length;
}

export default async function setup(): Promise<void> {
  if (process.platform !== 'win32') return;
  // The output's last number is the count of ports (the line names are localized).
  const range = Number([...run('netsh int ipv4 show dynamicport tcp').matchAll(/(\d+)/gu)].at(-1)?.[1] ?? 16_384);
  const end = Date.now() + CAP;
  let n = free(range);
  if (n >= NEEDED) return;
  console.log(`waiting for ports: ${n} of ${range} free, a run needs ${NEEDED} (up to ${CAP / 1000} s)…`);
  while (n < NEEDED && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 3_000));
    n = free(range);
  }
  if (n < NEEDED) console.warn(`still only ${n} ports free: tests may fail with EADDRINUSE`);
}
