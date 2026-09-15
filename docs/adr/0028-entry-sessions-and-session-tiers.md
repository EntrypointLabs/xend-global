# 0028: Entry sessions: an emailed code opens a second, server-enforced session tier

**Status:** Accepted
**Date:** 2026-09-07
**Accepted:** 2026-08-30
**Deciders:** Xend founding team
**Tags:** backend, mobile, security, auth

## Context and Problem Statement

[0027](0027-email-is-an-entry-point-not-a-login-method.md) decided that an emailed
code proves an inbox and unlocks S3, and never returns S1. It also decided that a
**Consumer** who arrives with only an inbox, on a phone that holds no passkey for the
**Account**, must still be able to get in far enough to look around and start a
recovery. Before this, the only credential the backend understood was the Xend JWT
minted by `auth/exchange` against a verified Privy identity token, which is to say a
passkey. There was no way to admit an inbox without admitting it as a passkey.

`O10` in the decisions spec named the failure mode of getting this wrong: Privy's
email login returned the same embedded wallet that is S1, so an inbox reached the
whole daily spending limit. Removing that route (`b6dc884`) left the question of what
an inbox is allowed to be, and how the backend tells.

## Decision Drivers

- The 0027 capability table is a security boundary, not a UI plan. "Read balances,
  start the lost-phone rotation, nothing else" has to hold against a client that
  lies about which buttons it showed.
- A route that nobody made a decision about must be closed to an inbox. The
  dangerous default is the open one.
- The credential has to be ours. A Privy session of any shape stands for S1.
- [0013](0013-session-model.md) already settled how an opaque server-side token
  looks: random bytes, hashed at rest, raw value crosses the boundary once.
- The app should be able to tell the two tiers apart without a second code path
  for every screen.

## Considered Options

1. **A second session tier stamped on the principal, closed by default** - the guard
   accepts a Xend JWT or a Xend entry token, stamps `tier` on the principal, and
   refuses an `entry` principal on any route not marked `@AllowEntry()`.
2. **A scoped JWT** - mint the existing JWT with a `scope` claim and check the claim
   in each handler that cares.
3. **Hide the buttons** - open a full session from the emailed code and rely on the
   app not to offer spending.

## Decision Outcome

Chosen option: **"A second session tier stamped on the principal, closed by
default"**, because it puts the decision on the server, makes the safe answer the one
a forgotten route gets, and keeps one guard on every **Consumer** route so there is
one place to be wrong.

### The credential

`EntrySessionService.open` (`apps/backend/src/auth/entry-session.service.ts`) mints
`xentry_` followed by 32 random bytes base64url. The row stores the SHA-256 of the
raw value, the user id and an expiry; the raw value is returned once and never
stored. `ENTRY_SESSION_TTL_MS` is one hour, absolute, no sliding window: long enough
to look around and start a recovery, short enough that a token lifted from a phone
that was put down is worth little. Revocation is a row update
(`entry_sessions.revoked_at`), and `DrizzleEntrySessionStore.findLive` folds every
liveness rule into one query: unexpired, unrevoked, on an **Account** that is bound
and not closed.

`auth/signup/email` issues it when the address it just proved already anchors an
**Account**; for an unclaimed address the same endpoint issues the single-use sign-up
token from 0027 instead. One endpoint, two outcomes, and the response shape does
not leak which.

### The tier

`Principal` (`apps/backend/src/auth/principal.ts`) carries
`tier: 'full' | 'entry'`. `full` is a passkey-backed session from `auth/exchange`;
`entry` is what an email code opens on an existing **Account**. The tier is set from
the credential that was presented, never from anything the client claims.

### The guard

`ConsumerAuthGuard` (`apps/backend/src/auth/consumer-auth.guard.ts`) is the one guard
on every **Consumer** route. A bearer that starts with `xentry_` is authenticated as
an entry session; anything else goes through the JWT strategy. Then the tier is
enforced: an `entry` principal on a route without `@AllowEntry()`
(`allow-entry.decorator.ts`) gets a 403 with code `ENTRY_SESSION_FORBIDDEN` and the
message "sign in with your passkey to do that". A 403 rather than a 401, because the
session is valid and the app must not throw it away over this.

### The inventory

`entry-route-inventory.spec.ts` discovers every route the backend serves and
requires each to be in exactly one of two lists, `ENTRY_ALLOWED` and
`CLOSED_TO_ENTRY`. A new route in neither list fails the build until somebody reads
the capability table and places it. As of this ADR the allowed list is the read
endpoints (`GET /wallet/me`, balances, transfers, `GET /account/me`, recovery keys,
pending changes, merchant **Sessions**), the two recovery starters (device and
primary rotation: challenge, verify, start, next, submit), **Session** revocation and
`POST /auth/signout`. Everything that spends, enrols a credential, changes the signer
set or a policy, moves the contact address, closes the **Account** or changes where
notices go is closed, by name, with the reason grouped above it.

The same spec asserts that no **Consumer** route is left on the raw `AuthGuard('jwt')`,
which stamps no tier and would let an entry token through as nobody.

### On the phone

`AuthContext` (`apps/mobile/contexts/AuthContext.tsx`) holds `sessionTier`. An entry
session has nothing to refresh from, so the app does not try; signing out revokes
the exact row through `POST /auth/signout`, which is why that route is open to
entry. Hooks that must not run for an inbox, such as push registration
(`usePushRegistration.ts`), check the tier rather than the route.

### Consequences

- ✅ **Good:** The 0027 capability table is enforced where it can be verified. An
  inbox cannot spend, cannot rotate a signer, cannot enrol a passkey, whatever the
  app renders.
- ✅ **Good:** A forgotten route is closed. The inventory test turns "closed by
  default" from a convention into a build failure.
- ✅ **Good:** One guard, one principal shape. A handler reads `req.user.tier` and
  needs no second code path.
- ✅ **Good:** The credential is Xend's own: no Privy session exists behind it, so
  nothing about it can be mistaken for S1.
- ⚠️ **Bad:** Every new **Consumer** route has to be placed in a list, and the author
  has to understand the capability table to place it. That is the cost of the
  default being safe.
- ⚠️ **Bad:** Two tiers means two things the app can be showing at once. A screen
  reachable from an entry session has to handle the 403 gracefully, not as a
  sign-out.
- ⚠️ **Bad:** An entry session on a phone that also holds the **Device Key** can start
  a lost-passkey rotation ([0031](0031-lost-passkey-primary-rotation.md)). That is
  intended, and it is also the reason the freeze in
  [0030](0030-support-freeze-of-recovery-signer-release.md) exists.

## Pros and Cons of the Options

### A second session tier stamped on the principal, closed by default

- ✅ Server-enforced, closed by default, one guard.
- ✅ Follows 0013's token shape; nothing new to reason about at rest.
- ❌ An inventory list to maintain.

### A scoped JWT

- ✅ No new table.
- ❌ The scope check lives in each handler, so a route that forgets is open.
- ❌ A JWT cannot be revoked without a denylist, and an entry session must be
  revocable at sign-out.

### Hide the buttons

- ✅ Nothing to build on the server.
- ❌ This is `O10` with a different coat. Any client that holds the token holds S1.

## More Information

- Extends [0027](0027-email-is-an-entry-point-not-a-login-method.md), build map
  item 10. Related: [0013](0013-session-model.md) (opaque token shape),
  [0031](0031-lost-passkey-primary-rotation.md) (a flow reachable from entry).
- Source: `apps/backend/src/auth/entry-session.service.ts`,
  `entry-session.store.ts`, `principal.ts`, `consumer-auth.guard.ts`,
  `allow-entry.decorator.ts`, `entry-route-inventory.spec.ts`,
  `apps/backend/src/db/schema.ts` (`entry_sessions`),
  `apps/mobile/contexts/AuthContext.tsx`
- Landed in `d8dfb08`; email login removed in `b6dc884`.
