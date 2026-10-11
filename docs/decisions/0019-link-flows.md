---
title: A click records where it was sent; a link with rules shows its flows as a sankey
type: decision
status: accepted
date: 2026-10-11
---

# 0019. A click records where it was sent; a link with rules shows its flows as a sankey

**Context.** A link's report ranked its sources, countries and devices, each on its own. With rules
(§6), one link sends people different ways, and the question its owner has — which rule took which
clicks, from where — was answered by no chart. affiliate-charts draws flows between columns
(`sankey`). The worker did not record which rule a click matched.

**Decision.**
- A click records its destination in its row's `page`, empty for every link so far: the matched
  rule's own conditions and the URL it was sent to, `AT,DE;mobile>https://…`, or `>https://…` for
  the main URL — the first 512 characters. The conditions are sorted (matching treats them as
  sets, so `DE,AT` is `AT,DE`) and past 40 countries kept as the first 40 and `+N#<fingerprint>`: a
  rule may name 250, and a full list would push the `>` past 512; the FNV-1a fingerprint of the
  whole list keeps lists alike in their first 40 apart (Codex, 11.10). No migration and no new
  column; while the rules stay the same, no extra row: the destination follows from the country
  and the device, already in the row.
- The rule's conditions, not its position or its URL alone: rules are edited and reordered, a rule
  may send to the main URL, and two rules may share one — a position or a URL read back against
  today's rules would name the wrong rule (Codex, 11.10). The report names a destination from what
  was recorded, taking from today's rules only the number of the one still the same — "Rule 2 (DE,
  AT)", "Main address"; otherwise by its URL first, as two earlier rules may share their
  conditions: "example.org/de (earlier rule: DE, AT)", "example.org/old (earlier main address)".
- A link's breakdowns gain `flows`: source and destination pairs, the top 200, as one more dimension
  of the same pass over the rows (D1's limit of five terms a compound SELECT leaves no room for
  another `UNION`); its `pages` are its destinations.
- The app draws "Where the clicks went" when the clicks went more than one way: the link has rules,
  or its period holds clicks a rule took. At most eight nodes a column: past eight, the eighth on are joined into one, so the
  flows still add up. Clicks a bundle counted before this have `''` and are shown as not recorded;
  with nothing recorded yet, the card says the chart starts with the worker's update. The row over
  the detail caps keeps no dimension, so its clicks are "other" on both sides, not "direct".
- `/short-links` shows the same chart for its example link, drawn at build time by the same code
  (`ui/flows.ts`).

**Rejected.** A sankey in place of the rankings: most links have one main source, and a ranking is
read faster. Source → country or source → device from the data already kept: little beyond two
rankings side by side, and the rows over the detail caps carry no dimension at all.

**Consequences.** The flows start with the update of each account's worker; earlier days stay
unrecorded. A long destination URL is stored in every row of its link, within the existing caps
and backpressure (§5, §8); two destinations alike in their first 512 characters count as one.
