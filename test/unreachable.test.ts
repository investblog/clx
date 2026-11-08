// Which link rules no visitor can reach (edge/contract.ts `unreachable`, ADR 0042): a rule whose
// visitors one rule above it takes, by the worker's match (countries, device, bot category).
import { describe, expect, it } from 'vitest';
import { type LinkRule, unreachable } from '../edge/contract';

const u = 'https://example.org/';
const dead = (...rules: Omit<LinkRule, 'url'>[]) => unreachable(rules.map((r) => ({ ...r, url: u })));

describe('unreachable', () => {
  it('refuses what a rule above takes whole', () => {
    // A country above the same country for search bots: every such bot is in DE.
    expect(dead({ countries: ['DE'] }, { bots: ['search'], countries: ['DE'] })).toEqual([{ index: 1, by: 0 }]);
    // Any bot above search bots.
    expect(dead({ bots: ['search', 'ai_training', 'monitoring', 'ad_review', 'social_preview', 'headless', 'other'] }, { bots: ['search'] })).toEqual([{ index: 1, by: 0 }]);
    // A duplicate, and a narrower list under a wider one.
    expect(dead({ countries: ['DE', 'AT'], devices: ['mobile'] }, { countries: ['AT', 'DE'], devices: ['mobile'] })).toEqual([{ index: 1, by: 0 }]);
    expect(dead({ countries: ['DE', 'AT'] }, { countries: ['AT'], devices: ['desktop'] })).toEqual([{ index: 1, by: 0 }]);
    // Both devices are as good as none.
    expect(dead({ devices: ['mobile', 'desktop'] }, { devices: ['mobile'], countries: ['RS'] })).toEqual([{ index: 1, by: 0 }]);
    expect(dead({ devices: ['desktop', 'mobile'] }, { bots: ['other'] })).toEqual([{ index: 1, by: 0 }]);
  });

  it('allows what each rule above leaves some visitors of', () => {
    // Search bots above DE: browsers and other bots in DE still reach it.
    expect(dead({ bots: ['search'] }, { countries: ['DE'] })).toEqual([]);
    expect(dead({ devices: ['mobile'] }, { devices: ['desktop'] })).toEqual([]);
    expect(dead({ countries: ['DE'] }, { countries: ['AT'] })).toEqual([]);
    expect(dead({ countries: ['DE'] }, { countries: ['DE', 'AT'] })).toEqual([]);
    expect(dead({ bots: ['search'] }, { bots: ['search', 'monitoring'] })).toEqual([]);
    // Every bot category is still not everyone: browsers reach the rule below.
    expect(dead({ bots: ['search', 'ai_training', 'monitoring', 'ad_review', 'social_preview', 'headless', 'other'] }, { devices: ['mobile'] })).toEqual([]);
    expect(dead({ countries: ['DE'], devices: ['mobile'] }, { countries: ['DE'] })).toEqual([]);
  });

  it('names the first rule that takes it, and looks at pairs only', () => {
    expect(dead({ countries: ['RS'] }, { countries: ['DE', 'AT'] }, { countries: ['DE'] })).toEqual([{ index: 2, by: 1 }]);
    // Mobile and desktop above together leave nothing to DE, but neither does on its own.
    expect(dead({ devices: ['mobile'] }, { devices: ['desktop'] }, { countries: ['DE'] })).toEqual([]);
    expect(dead({ countries: ['DE'] }, { countries: ['DE'] }, { countries: ['DE'] })).toEqual([
      { index: 1, by: 0 },
      { index: 2, by: 0 },
    ]);
  });
});
