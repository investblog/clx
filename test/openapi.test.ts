// docs/openapi.yaml is the contract (docs/spec.md §15): every /v1 route in the code is in it, and
// every operation in it is a route.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { v1 } from '../src/v1/index';

describe('openapi.yaml', () => {
  it('lists exactly the /v1 routes', () => {
    const lines = fs.readFileSync('docs/openapi.yaml', 'utf8').split(/\r?\n/u);
    const start = lines.indexOf('paths:');
    const documented: string[] = [];
    let path = '';
    for (const line of lines.slice(start + 1)) {
      const p = line.match(/^ {2}(\/\S+):$/u);
      const m = line.match(/^ {4}(get|post|put|patch|delete):/u);
      if (p) path = p[1]!;
      else if (m) documented.push(`${m[1]!.toUpperCase()} ${path}`);
    }
    const routed = v1.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} /v1${r.path.replace(/:(\w+)/gu, '{$1}')}`);
    expect([...new Set(routed)].sort()).toEqual(documented.sort());
  });
});
