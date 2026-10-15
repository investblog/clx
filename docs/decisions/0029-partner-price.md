---
title: A partner plan — half the price for a partner with a client on the site generator's paid plan
type: decision
status: accepted
date: 2026-10-15
---

# 0029. A partner plan — half the price for a partner with a client on the site generator's paid plan

**Context.** Agencies and webmasters who run sites for clients bring those clients to the site
generator that clx integrates with, and through it to clx. The owner wants to reward them with a
lower price. clx has no paid plan yet (ADR 0014); the generator has paid plans.

**Decision** (the owner's, 15.10.2026).

- It is the **partner plan**: a partner pays half — for the generator or for clx, for whichever
  they pay.
- They do while at least **one** of their clients is active; one is enough.
- A client is **active** when it has been on a paid plan of the generator since the beginning of
  the month.
- When the last active client stops paying, the half holds to the end of that month.
- The partner plan is switched on with a **code**; keeping it is up to the clients — their being
  active.
- A client the partner pays for themselves counts like any other.

**What follows.** Whether a client is active is known from the generator's plans and payments, not
from clx; clx counts no clients. Nothing is built in clx until it has paid plans.

**Open — to decide with clx's billing:** where the code comes from, and how
clx learns, month by month, that a partner's clients are still active.
