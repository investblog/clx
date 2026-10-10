// vitest globalSetup: on Windows, wait for the ports of the previous run to come back.
// Miniflare closes the connection after every proxied call (`options.reset = true` in its
// DispatchFetchDispatcher), so each D1 call of a test takes one outgoing port, held ~2 min in
// TIME_WAIT after it. A full run takes ~14,000 of the 16,384 dynamic ports (07.10); a second run
// started sooner fails random tests with `connect EADDRINUSE`. Waiting turns that into a pause.
import { execSync } from 'node:child_process';

const FREE_ENOUGH = 1_500; // TIME_WAIT sockets a full run can start on top of (other programs use ports too)
const CAP = 180_000;

function timeWait(): number {
  return execSync('netstat -ano -p tcp', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter((l) => l.includes('TIME_WAIT')).length;
}

export default async function setup(): Promise<void> {
  if (process.platform !== 'win32') return;
  const end = Date.now() + CAP;
  let n = timeWait();
  if (n <= FREE_ENOUGH) return;
  console.log(`waiting for ${n} TIME_WAIT sockets of the last run to close (up to ${CAP / 1000} s)…`);
  while (n > FREE_ENOUGH && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 3_000));
    n = timeWait();
  }
  if (n > FREE_ENOUGH) console.warn(`still ${n} TIME_WAIT sockets: tests may fail with EADDRINUSE`);
}
