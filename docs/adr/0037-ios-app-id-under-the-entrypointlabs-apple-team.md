# 0037: iOS ships as com.entrypointlabs.prydd under the EntrypointLabs Apple team

**Status:** Accepted
**Date:** 2026-10-30
**Deciders:** Gift Opia
**Tags:** mobile, release, ios

## Context and Problem Statement

Prydd is going to TestFlight from a new Apple Developer account, not the one
that registered the app so far. The old account already holds an App ID and an
App Store Connect record for `com.giftedborg.xend`.

A bundle ID belongs to the account whose App Store Connect record used it. The
only way to move it is an app transfer, and Apple's
[transfer criteria](https://developer.apple.com/help/app-store-connect/transfer-an-app/app-transfer-criteria)
require "at least one version that was released to the App Store". Prydd has
never released one, so the new account cannot register `com.giftedborg.xend`.

## Decision Drivers

- TestFlight, and later the App Store, should sit in the company's Apple account.
- An App Store record's bundle ID can never change, so the new ID is permanent.
- There are no real users yet, so nothing on a device has to survive the move.
- The Solana dApp Store listing is bound to the Android package and its signing
  key, and Android is not changing accounts.

## Considered Options

1. **Stay on the old Apple account** and keep `com.giftedborg.xend` on both
   platforms.
2. **New Apple account, new iOS ID `com.entrypointlabs.prydd`**; Android keeps
   `com.giftedborg.xend`.
3. **New Apple account and rename both platforms** to the new ID.

## Decision Outcome

Chosen option: **"New Apple account, new iOS ID"**, because the release has to
live in the company account and the old ID cannot follow it there. Android is
left alone: renaming it would orphan the dApp Store listing for nothing, since
the Android package was never in conflict.

The prefix is the company's reverse DNS rather than a Prydd domain, which is not
settled yet.

### Consequences

- ✅ **Good:** TestFlight and the App Store record sit in the EntrypointLabs team.
- ✅ **Good:** the iOS ID names the product instead of a personal handle.
- ⚠️ **Bad:** the two platforms have different app IDs. Anything keyed on "the
  app id" has to say which platform it means.
- ⚠️ **Bad:** every iOS registration outside the repo has to follow, or the
  feature behind it fails on iOS only:
  - Privy: add `com.entrypointlabs.prydd` to the native client's allowed app
    identifiers, or sign-in is refused.
  - `xend.global/.well-known/apple-app-site-association`: list
    `<TEAM_ID>.com.entrypointlabs.prydd` under `webcredentials` and `applinks`,
    or passkeys and universal links fail.
  - Backend `IOS_APP_ATTEST_APP_ID`: set to `<TEAM_ID>.com.entrypointlabs.prydd`,
    or hardware-key enrolment on iOS fails closed.
  - EAS: a new distribution certificate and provisioning profile for the new
    team, and an APNs key before push notifications reach iOS.
- ⚠️ **Bad:** the `com.giftedborg.xend` record in the old account is abandoned.
  Its ID cannot be reused by anyone else.

## More Information

- `apps/mobile/app.json`: `ios.bundleIdentifier`
- [`docs/specs/ios-testflight-runbook.md`](../specs/ios-testflight-runbook.md):
  the console steps and the first build
- Android stays on `com.giftedborg.xend`: `apps/mobile/app.json`
  (`android.package`), `apps/mobile/google-services.json`,
  `apps/backend/src/attestation/key-attestation.verifier.ts`
  (`ANDROID_PACKAGE_NAME`)
