---
title: A link rule that one rule above it takes every visitor of is refused by the API — rule_unreachable
type: decision
status: accepted
date: 2026-11-08
---

# 0042. Unreachable link rules are refused

**Context.** A link's rules are matched in order and the first match wins (§6). A rule that a rule
above it takes every visitor of is never used. Once rules by bot category arrived (ADR 0041), this
got easy to do by accident. A rule without `bots` takes bots too, so "DE" above "search bots in DE"
leaves the second one nothing. The editor's hint says to put a rule for bots above the others, but
nothing checked it. 301-ui's TDS rule editor faced the same question and refuses a reorder that it
can prove leaves a rule unreachable. The owner chose to refuse such a list in the API (06.11.2026),
so a client, the bot and an agent through MCP meet the same check as the page.

**Decision.**
- **What "unreachable" means.** Rule B is unreachable when one rule A above it takes every visitor
  B would. That is, by the worker's own match (`destination()` in `edge/worker.ts`), each of A's
  conditions is absent or holds all of B's:
  - countries: A has none, or B has some and all of them are in A's;
  - devices: the same, both devices counting as none;
  - bots: A has none (it takes bots too), or both have `bots` and B's categories are all in A's.
    A list of all seven categories is still not everyone: a B without `bots` takes browsers too.
- **Pairs only.** Only what one rule proves on its own counts. Several rules covering one together
  ("mobile", then "desktop", then "DE") are not looked for, as in 301-ui ("proved by inclusion
  only"). A duplicate rule is the plainest case.
- **Refused, not warned.** `POST /v1/links` and `PATCH /v1/links/{id}` with `rules` answer
  `409 rule_unreachable`, details `{field: "rules[j]", shadowed_by: i}`, for the first such rule.
  The page shows it with the rules' numbers from 1. Links saved before are not checked again: a
  change without `rules`, or with the stored rules sent back as they are (the editor sends the whole
  list on a change of the URL alone, Codex 08.11), goes through.
- **One function for the API and the editor.** `unreachable(rules)` in `edge/contract.ts`, beside
  `ruleOf`. The worker does not import it, so the bundle is unchanged (`build:edge --check`). The
  link editor (stage 6 of the backlog plan) marks such rules from the same function before saving.

**Consequences.**
- A list that used to save may now be refused when it holds a dead rule. Nothing live changes: the
  worker never used that rule.
- A rule covered only by several above together still saves, and stays unused. Telling those
  apart would need more than pairs, for little.
