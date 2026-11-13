# 0036: Checkout Cancel dismisses the attempt, it does not terminally cancel the intent

**Status:** Accepted
**Date:** 2026-09-20
**Deciders:** Pay with Xend
**Tags:** frontend, checkout, backend

## Context and Problem Statement

When a Consumer taps Cancel in Checkout, the surface reports a canceled result to
the merchant or navigates to the signed cancel URL, and shows a canceled state.
It does not mutate the intent: a local devnet intent stayed `created` with zero
attempts after a cancel. The production-readiness sweep asked us to decide
whether Cancel dismisses only this attempt (and to say so) or permanently
invalidates the intent, and noted that permanent cancellation needs an
authorized backend transition with race handling.

## Decision Drivers

- A Consumer holds no credential that authorizes mutating a merchant's intent
  before the passkey ceremony; the only thing they can prove at the Cancel button
  is that they closed the sheet.
- The intent lifecycle already has a `canceled` terminal, reached by a merchant
  cancel before authorization, not by the checkout surface.
- The Consumer should not be told the order is permanently gone when returning to
  the store lets them pay the same intent again.
- A signature that has moved money must never be reversible by a Cancel tap.

## Considered Options

1. **Cancel dismisses this attempt.** No intent mutation; the surface reports the
   dismissal and the intent stays payable until it expires or the merchant
   cancels it. Say so in the copy.
2. **Cancel terminally cancels the intent.** The surface calls a backend
   transition that moves the intent to `canceled`.

## Decision Outcome

Chosen option: **Cancel dismisses this attempt.** It matches what the Consumer
can actually authorize, keeps the intent payable so a return to the store works,
and leaves terminal cancellation where it already belongs, with the merchant.
The result copy now says the attempt was canceled and to head back to the store
to try again, rather than implying the payment is permanently void.

Terminal, Consumer-initiated cancellation is deliberately not built. If it is
ever wanted, it is a separate authorized backend transition (authenticated as the
Consumer who owns the checkout, race-handled against a concurrent authorization,
and refused once a signature exists), tracked as its own change and not inferred
from the current screen.

### Consequences

- Good: the copy matches the real semantics; no unauthenticated intent mutation.
- Good: returning to the store re-opens the same intent, so a mistaken cancel is
  recoverable until expiry.
- Bad: a merchant that wants a hard cancel from the Consumer side does not have
  it yet; that is a named, deferred capability, not a silent gap.

## More Information

- Source: `apps/checkout/src/App.tsx` (`deliverCancel`),
  `apps/checkout/src/screens/Result.tsx` (canceled copy).
- ADR 0016 for the checkout result transport this rides on.
