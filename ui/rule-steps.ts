// The link editor's summary without the page (the tests import it): which rule has no condition yet
// and which one a rule above it takes every visitor of — the API's own check (edge/contract.ts,
// ADR 0042), so Save meets no 409 the summary did not show.
import { type LinkRule, unreachable } from '../edge/contract';

export interface Step {
  /** no countries, devices or bots: the API answers 400 */
  empty: boolean;
  /** the index of the rule above that takes all of this one's visitors */
  by?: number;
}

const hasCondition = (r: LinkRule) => !!(r.countries?.length || r.devices?.length || r.bots?.length);

/** One step per rule, in order. A rule without a condition stays out of the check: it would
 *  take every rule below it, and the API refuses it before that check. */
export function ruleSteps(rules: LinkRule[]): Step[] {
  const checked = rules.flatMap((r, i) => (hasCondition(r) ? [{ r, i }] : []));
  const dead = new Map(unreachable(checked.map((x) => x.r)).map((d) => [checked[d.index]!.i, checked[d.by]!.i]));
  return rules.map((r, i) => {
    const by = dead.get(i);
    return { empty: !hasCondition(r), ...(by === undefined ? {} : { by }) };
  });
}
