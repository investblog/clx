---
title: Sign-in, sign-up and the reset request are a card on the home page
type: decision
status: accepted
date: 2026-10-12
---

# 0026. Sign-in, sign-up and the reset request are a card on the home page

Supersedes, in part, [ADR 0017](./0017-app-in-the-site-frame.md) (the header's one link to the app,
the signed-out forms in the app) and [ADR 0021](./0021-language-switch-in-the-header.md) (the
sister links under the signed-out forms).

**Context.** A visitor who wanted to sign up left the home page for the app (`/app#/signup`), a
page with nothing but a form; signing in was a separate page there too. catchall.in, of the same
owner, keeps all three forms on its home page as one card switched by the fragment, and the owner
asked for that approach here (12.10.2026).

**Decision.**
- Each language's home page holds one card (`site/auth.ts`) with three forms — sign-in, sign-up,
  the reset request — shown by the fragment: `#login`, `#register`, `#recover`. Without one the
  card is hidden; with one, on a wide screen the hero moves left and the card stands to its right,
  on a narrow one under it. Two tabs switch sign-in and sign-up; the reset is reached from sign-in.
- The forms are printed at build time from the app's dictionaries (`ui/i18n`), so the card says
  what the app said; the texts the script shows later (errors, what comes after sending) travel in a
  `data-t` attribute, since the CSP allows no inline script. `/site.js` (`site/auth-client.ts`)
  switches the forms and sends them to the same `/auth` endpoints; each form has `method="post"`,
  so a submit before the script binds it never puts the password in the address.
- Sign-in leads to `/app#/` (`/ru/app#/`): the app takes the session from the refresh cookie the
  sign-in set. The app keeps no sign-in form: without a session it goes to `#login`, carrying the page
  it was asked for as `?next=` (`/?next=%2Fsites#login`), and sign-in comes back to it — an app route
  only (`/` and word characters, `- / ? = & .`), put after the app's own `#`; sign-out goes
  to the home page; its old `#/signup` and `#/reset` go to `#register` and `#recover`. When an
  account is deleted, the app still shows what is left to remove by hand, with the way home.
- The e-mails' links are unchanged: `/app#/confirm?t=` and `/app#/reset?t=` open the app's pages,
  which lead back to the card (sign in, ask for a new link).
- The header has "Sign in" (`#login` on the home page) when signed out and "Dashboard" (the app)
  when signed in, as two links `/theme.js` chooses between; every call to sign up — the hero, the
  closing banner, the product and comparison pages — opens `#register`. Signed in, the hero's first
  button leads to the app.

**Consequences.** One place to sign in and sign up, next to what the visitor just read. A deep
link into the app (`/app#/sites`) opened signed out comes back to that page after sign-in. The password minimum is printed into the forms; a test holds it equal to the
server's.
