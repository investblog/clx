// The link editor's summary marks (ui/rule-steps.ts): the API's own unreachable() over the rules
// that have a condition, indexes back on the editor's own rows.
import { describe, expect, it } from 'vitest';
import { ruleSteps } from '../ui/rule-steps';

describe('ruleSteps', () => {
  it('marks a rule one above takes every visitor of, by that rule', () => {
    expect(ruleSteps([{ countries: ['DE'], url: '/de' }, { countries: ['DE'], bots: ['search'], url: '/s' }, { countries: ['AT'], url: '/at' }])).toEqual([{ empty: false }, { empty: false, by: 0 }, { empty: false }]);
  });

  it('marks a rule with no condition yet, and keeps it out of the check', () => {
    // Checked with it, the empty rule would take every rule below it.
    expect(ruleSteps([{ countries: ['DE'], url: '/de' }, { url: '' }, { devices: ['mobile'], url: '/m' }, { devices: ['mobile'], countries: ['AT'], url: '/x' }])).toEqual([
      { empty: false },
      { empty: true },
      { empty: false },
      { empty: false, by: 2 },
    ]);
  });

  it('counts both devices as none, as the API does', () => {
    expect(ruleSteps([{ devices: ['mobile', 'desktop'], countries: ['DE'], url: '/a' }, { countries: ['DE'], url: '/b' }])).toEqual([{ empty: false }, { empty: false, by: 0 }]);
  });

  it('leaves rules that only narrow each other the other way alone', () => {
    expect(ruleSteps([{ bots: ['search'], url: '/s' }, { countries: ['DE'], url: '/de' }, { devices: ['mobile'], url: '/m' }, { devices: ['desktop'], url: '/d' }])).toEqual([{ empty: false }, { empty: false }, { empty: false }, { empty: false }]);
  });
});
