---
title: The link editor is a screen of its own, not a drawer — #/links/new and #/links/<id>/edit
type: decision
status: accepted
date: 2026-11-09
---

# 0043. The link editor is a screen

**Context.** Adding and editing a link were drawers, 540 px wide, over the list and the link's page.
A link holds up to 10 rules, each a row of countries, device, who, URL, move up and remove. In the
drawer every rule took two lines and the "who" label was cut ("bot: Search en…"). 301-ui's
StyleGuide ("Editor Screen", "Screen, drawer or dialog") gives the rule the owner asked to follow
(06.11.2026): a record with a home — a list it belongs to, an address worth linking, a form long
enough to scroll — is edited on a screen; a quick add or a step with no home stays a drawer. In clx
only the link editor is such a record.

**Decision.**
- **Addresses.** `#/links/new` and `#/links/<id>/edit` are pages. "New link" on the list and "Edit"
  on a link's page are links to them; Back returns. Save leads to the link's page; Cancel and the
  back link lead where the editor was opened from (the list, the link). `#/links/new` opened with no
  working link host says so instead of drawing an empty form; a deleted link's editor says it is
  deleted.
- **Unsaved edits ask first.** The page compares what Save would send with what it held when it was
  drawn — values, not keystrokes, so typing and undoing it asks nothing. Leaving for another page
  of the app asks (`askConfirm`): the address, already moved, goes back while the user decides, and
  leaving after all steps over the entry put back, as on 301-ui's screen. The language switch and
  sign-out ask too, before they act. Closing or reloading the tab gets the browser's own question
  (`beforeunload`, listened to only while an editor is shown). `ui/leave.ts`, checked first in
  `route()` (`ui/main.ts`).
- **Layout by its own width** (`@container`, not the window). From 860 px of the editor the summary
  sits beside the form, pinned under the header and scrolling inside itself; narrower, it stands
  above Save. Where the form is 640 px wide a rule is one row — countries, device, who, address,
  actions — every rule on the same columns.
- **The summary shows the result**, rebuilt on every change from the draft Save sends: each rule's
  conditions and where it leads, then "everyone else" and the main address. A rule with no condition
  yet is marked (the API answers 400), and so is a rule that a rule above takes every visitor of —
  from `unreachable()` in `edge/contract.ts`, the API's own check (ADR 0042), so Save meets no
  `409 rule_unreachable` the summary did not show (`ui/rule-steps.ts`).
- **A rule for both devices is kept as it is.** The API takes `devices: ["mobile", "desktop"]`;
  the editor showed it as "any device" and sent it without, so a rule with no other condition
  stopped saving. Such a rule now shows "phone and computer", an option only it has, and goes back
  unchanged — as a set of bot categories the API wrote is kept (ADR 0041).
- **The other drawers stay**: adding a site or a link host, the excluded paths, keys, top-ups and
  refunds, partner payouts — short, with no home of their own.

**Consequences.**
- An editor's address can be bookmarked and shared within an account; a bookmark of the old
  `#/links/new`, which opened the list, now opens the editor.
- Leaving inside the app with unsaved edits puts one extra entry in the history when the user stays.
- Chrome's own Back button skips a history entry the page put back without a user's click (its
  history manipulation intervention). After "stay", Back may then land on the editor again with no
  question, or ask once more; the edits are never dropped without asking. A script's
  `history.back()` asks every time — a check of the guard uses that, not the browser's button.
