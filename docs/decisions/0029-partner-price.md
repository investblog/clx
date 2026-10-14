---
title: A partner pays half while a client of theirs pays the site generator since the month began
type: decision
status: accepted
date: 2026-10-15
---

# 0029. A partner pays half while a client of theirs pays the site generator since the month began

**Context.** Agencies and webmasters who run sites for clients bring those clients to the site
generator that clx integrates with, and through it to clx. The owner wants to reward them with a
lower price. clx has no paid plan yet (ADR 0014); the generator has paid plans.

**Decision** (the owner's, 15.10.2026).

- A **partner** pays half — for the generator or for clx, for whichever they pay.
- They do while at least **one** of their clients is active; one is enough.
- A client is **active** when it has been on a paid plan of the generator since the beginning of
  the month.

**What follows.** Whether a client is active is known from the generator's plans and payments, not
from clx; clx counts no clients. Nothing is built in clx until it has paid plans.

**Open — to decide with clx's billing.**

- What happens in the month when the last active client stops paying: the half to the end of
  that month, or not.
- How clx learns a partner's status from the generator.
- Whether a partner who pays for their own "client" counts.
- How the price is named and shown on the prices page and in the app.
