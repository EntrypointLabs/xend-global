# 0031: A lost passkey is replaced by rotating S1, approved by the phone and the recovery signer

**Status:** Accepted
**Date:** 2026-09-07
**Accepted:** 2026-09-01
**Deciders:** Xend founding team
**Tags:** mobile, backend, security, wallet

## Context and Problem Statement

[0025](0025-account-multisig-signer-set.md) made the passkey S1: the signer on every
**Spend**, held by Privy, unlocked by the platform credential. A passkey deleted from
iCloud Keychain or Google Password Manager is as gone as a hardware key in a lost
phone. D10c in the decisions spec covered the lost phone by rotating S2; nothing
covered the lost passkey, and a **Consumer** in that state held S2 and S3, which is
threshold, with no flow that used it.

[0027](0027-email-is-an-entry-point-not-a-login-method.md) also set the rule this
flow has to respect: an email session must never enrol a passkey on an existing
**Account**, because a fresh passkey is a fresh S1 and one mailbox would then hold S1
and S3. Replacing a passkey therefore has to go through the threshold, the same way
the **Device Key** does.

## Decision Drivers

- The pair that meets threshold without S1 is S2 and S3. The phone proposes,
  approves and executes, which is what its `Initiate` grant exists for; the emailed
  code buys S3's vote.
- The old primary never participates. It is gone, and a design that needed it
  would be no design.
- A new passkey means a new Privy user and a new embedded wallet. The incoming
  signer has to be read off a verified identity token, not the request body, or
  anyone could name any wallet.
- The primary sits on both spend policies, each of which carries its own copy of
  the signer set. A rotation that touched only the Settings would leave every
  **Spend** unsignable.
- The credential binding must move on execution, not on staging. Staging is what
  an attacker does.
- The flow is reachable from an entry session
  ([0028](0028-entry-sessions-and-session-tiers.md)), because the **Consumer** who
  needs it has no passkey to open a full one.

## Considered Options

1. **Rotate S1 through a settings change, driven by the phone, with S3 released
   against an emailed code** - a state machine that mirrors the device rotation.
2. **Let the email session enrol a passkey directly** - mint a fresh Privy user from
   the entry session and rebind the **Account** to it.
3. **Require a second recovery key** - make the lost-passkey case a two-recovery-key
   recovery and offer nothing to a **Consumer** who has only one.

## Decision Outcome

Chosen option: **"Rotate S1 through a settings change, driven by the phone, with S3
released against an emailed code"**, because it is the mirror image of the device
rotation already built, uses the pair that actually holds threshold, and keeps the
0027 rule intact: the emailed code unlocks S3's vote and nothing else.

### The state machine

`PrimaryRotationService` (`apps/backend/src/account/primary-rotation.service.ts`)
exposes `start`, `next` and `submit` on `POST /account/recovery/primary/*`, all
open to an entry session. `start` verifies the grant
(`RecoveryChallengeService.assertGrant`, purpose `primary_rotation`, fifteen
minutes), checks the release freeze
([0030](0030-support-freeze-of-recovery-signer-release.md)), verifies the fresh
passkey's Privy identity token, and stages the swap by writing
`pendingPrimarySigner`, `pendingPrimaryProviderId` and `pendingPrimaryChangeIndex`
on the `squads_accounts` row under the user lock. It refuses a passkey already
bound to another **Account** (`PasskeyInUseError`), refuses while a device rotation
is in flight (both write the same signer set and race the same index), and treats
a passkey that is already the primary as nothing lost.

`next` re-derives the step from chain state rather than from a stored cursor:

| Chain says                               | Step               | Signed by  |
| ---------------------------------------- | ------------------ | ---------- |
| No proposal at the staged index          | `propose`          | S2         |
| Proposal exists, S2 has not approved     | `approve-approval` | S2         |
| S2 approved, no held recovery signer has | `approve-recovery` | S3, server |
| Both approved, lock not yet elapsed      | `waiting`          | nobody     |
| Both approved, lock elapsed              | `execute`          | S2         |
| Settled                                  | done               |            |

The `propose` step carries `buildRotatePrimarySigner` from `@xend/smart-account`: the
Settings swap plus a `PolicyUpdate` on each of the two policies, restating the
spending-limit terms from `spending-limit.terms.ts` because a policy update
replaces the whole policy. The `approve-recovery` step is taken by the server: it
compiles the approval, has `RecoveryService.approveWithRecoverySigner` sign it
with the sealed key, submits, and consumes the grant, so the emailed code is
spent on exactly one vote. Every device-signed step is pinned in the prepared
store ([0033](0033-provisioning-idempotency-and-prepared-transaction-pins.md)) so
`submit` co-signs only bytes the backend built.

### Settlement

When the proposal settles as executed, `settle` moves the binding: `smart_accounts`
gets the new `providerUserId` and `walletAddress`, `squads_accounts.primarySigner`
becomes the new key, the pending columns clear, `passkey_enrolled` and
`settings_change_executed` are recorded, and the new signer is registered with
the Helius webhook best-effort. If it settles as rejected, the pending columns
clear and `settings_change_rejected` is recorded. Until then the old binding
stands, and the new passkey opens nothing.

The staging itself records `settings_change_staged` with `change: 'passkey'`,
which is what pushes "Your sign-in passkey is being replaced" to the phone
([0029](0029-push-is-the-load-bearing-channel-for-staged-changes.md)). An inbox is
enough to start this, and the delay only protects somebody who is told it began.

### On the phone

`settings/replace-passkey.tsx` explains, sends the code, verifies it, calls
`usePasskeyLogin.createReplacement` (which logs out of any Privy session and runs
`signupWithPasskey` to mint the fresh credential), then `runPrimaryRotation` in
`hooks/useReplacePasskey.ts` loops `next` and `submit` with the **Device Key**
signing every step until the plan says `waiting` or done. A day later the loop is
run again from the same screen to execute.

### Consequences

- ✅ **Good:** A **Consumer** with the phone and the inbox can replace a lost passkey
  without support, without a seed phrase, and without the **Account** address
  changing.
- ✅ **Good:** The 0027 rule holds. The emailed code buys one vote; the fresh passkey
  becomes S1 only when two signers and a day have said so.
- ✅ **Good:** The credential binding moves on execution, so a staged swap opens
  nothing for its author.
- ✅ **Good:** The step is derived from the chain, so an interrupted flow resumes and
  a retry is safe.
- ⚠️ **Bad:** It needs the phone. A **Consumer** who has lost the passkey and the
  phone together holds S3 alone and this flow cannot help; that is the second
  recovery key's job, and 0027 records that key as prompted, not required.
- ⚠️ **Bad:** It is reachable from an entry session, so an attacker holding the
  inbox and the phone can start it. That is two anchors, which is threshold by
  design; the freeze in 0030 is the response.
- ⚠️ **Bad:** The spending-limit terms are restated from the provisioning default.
  The day limits become editable, the `propose` step has to read the live terms
  or it silently resets them.

## Pros and Cons of the Options

### Rotate S1 through a settings change, driven by the phone

- ✅ Uses the pair that holds threshold; mirrors the device rotation.
- ✅ Time-locked and notified like every signer change.
- ❌ A 24 hour wait to sign in again.

### Let the email session enrol a passkey directly

- ✅ Instant.
- ❌ One mailbox then holds S1 and S3. This is the exact outcome 0027 forbids.

### Require a second recovery key

- ✅ Nothing new to build.
- ❌ Offers nothing to a **Consumer** who declined the prompt, which 0027 accepts
  most will.

## More Information

- Extends [0025](0025-account-multisig-signer-set.md) (D10c's mirror) and
  [0027](0027-email-is-an-entry-point-not-a-login-method.md). Related:
  [0028](0028-entry-sessions-and-session-tiers.md),
  [0030](0030-support-freeze-of-recovery-signer-release.md),
  [0033](0033-provisioning-idempotency-and-prepared-transaction-pins.md).
- Source: `apps/backend/src/account/primary-rotation.service.ts`,
  `primary-rotation.service.spec.ts`, `apps/backend/src/recovery/recovery-challenge.service.ts`,
  `packages/smart-account/src/policy.ts` (`buildRotatePrimarySigner`),
  `apps/mobile/app/(tabs)/settings/replace-passkey.tsx`,
  `apps/mobile/hooks/useReplacePasskey.ts`, `apps/mobile/hooks/usePasskeyLogin.ts`
