# 0040: A Consumer can decline a Payment handed to their phone, terminally

**Status:** Accepted
**Date:** 2026-11-20
**Deciders:** Prydd
**Tags:** backend, mobile, checkout

## Context and Problem Statement

A Payment above the one-signature band is refused at Checkout with
`APPROVAL_REQUIRED` and finished on the phone ([0026](0026-checkout-settles-from-the-account.md)).
The phone now shows it as a full-screen approval with Approve and Decline, and
the hosted checkout waits on the intent status instead of telling the Consumer
to go and find the app. A Decline that only closed the screen would leave the
checkout waiting until the quote expired.

[0036](0036-checkout-cancel-dismisses-the-attempt.md) kept Checkout Cancel
non-terminal because the Consumer holds no credential there, and named a
terminal Consumer cancel as a separate, authorized, race-handled transition that
is refused once a signature exists. This is that transition.

## Decision Outcome

`POST /payments/pending/:reference/decline`, behind the Consumer's app session
and the same ownership check as prepare and submit, moves the intent to
`canceled`:

- From `created`: a conditional `created -> canceled` update, which loses
  cleanly to a concurrent prepare.
- From `authorized` (the phone prepared it, then the device-key prompt was
  closed): the attempt is failed only while it is still `authorized`, the
  intent goes `authorized -> canceled`, and the reserved capacity is released
  in the windows it was reserved in, all in one transaction. A submitted
  attempt is `settling`, so the decline is refused with 409 once a signature
  exists.

A declined Payment publishes `payment.canceled`. Checkout reads `canceled` from
`GET /checkout/intents/:reference` and stops waiting. Checkout Cancel itself is
unchanged.

Prepare is re-entrant for the same reason: an `authorized` intent with an
unsubmitted attempt is re-built and re-pinned rather than refused, so "try
again" after a closed prompt works.

### Consequences

- Good: the checkout learns "no" immediately, from the same status field it
  polls for success.
- Good: an abandoned phone authorization no longer holds the Consumer's daily
  capacity until something else clears it.
- Bad: merchant webhooks do not carry `payment.canceled` yet; a Merchant learns
  of a decline from the checkout result, not a webhook.
