# 0030: Support can freeze the release of the recovery signer, and can do nothing else

**Status:** Accepted
**Date:** 2026-09-07
**Accepted:** 2026-08-30
**Deciders:** Xend founding team
**Tags:** backend, security, ops, wallet

## Context and Problem Statement

[0025](0025-account-multisig-signer-set.md) leaves `settings_authority` unset, so
the **Account** is autonomous: nobody at Xend can cancel a staged change, rotate a
signer or move a vote. [0027](0027-email-is-an-entry-point-not-a-login-method.md)
named the one lever that does not violate that: refusal. Xend holds S3, sealed, and
releases it only against an emailed code. Declining to release it costs nothing in
the threat model, because declining to sign is not the same as being able to sign.

The 2026-09-07 update to 0025 makes the lever necessary rather than merely
available. The program's rejection cutoff on a 2-of-3 **Account** is two signers, so
a **Consumer** who holds one signer against an attacker's pair cannot reject the
staged change. In the compromise 0027 defends against, the attacker's second vote
is S3, bought with the stolen inbox. Withholding S3 is therefore the only thing
that stops the change reaching two approvals.

## Decision Drivers

- The invariant: no single compromise may yield `threshold` signers, and no Xend
  override may become a fourth anchor.
- Refusal must be asymmetric. A **Consumer** with their passkey and phone holds
  threshold without S3 and must be unaffected.
- The refusal has to fire before an index is burned, so a **Consumer** is told at
  the start of a rotation rather than after staging it.
- A frozen **Account** cannot be recovered onto a new phone, so the state must be
  visible and reversible from the same place it was set.
- The console ([0022](0022-internal-console-auth-boundary.md)) is the only
  operator surface and was read-only apart from webhook redelivery.

## Considered Options

1. **A per-Account freeze on S3's release, set and cleared from the console** - a
   timestamp on `users`, checked wherever the vault is about to be opened and
   wherever a rotation that needs S3 is about to be staged.
2. **A settings authority held by Xend** - an on-chain admin key able to cancel a
   staged change directly.
3. **Nothing** - rely on the time lock and the notification alone.

## Decision Outcome

Chosen option: **"A per-Account freeze on S3's release, set and cleared from the
console"**, because it is the only option that adds a lever without adding an
anchor.

### The state

`users.recovery_release_frozen_at` (`apps/backend/src/db/schema.ts`, migration
`0033_c_contact_rotation_and_release_freeze.sql`). Null is open; a timestamp is
frozen since then. `RecoveryService.freezeRelease` and `unfreezeRelease`
(`apps/backend/src/recovery/recovery.service.ts`) write it and log at `warn` on
both transitions.

### Where it is checked

`RecoveryService.assertReleaseAllowed` throws `RecoveryReleaseFrozenError`
(code `RECOVERY_RELEASE_FROZEN`, message "recovery through email is paused on this
Account while a report is open; contact support") from three places:

- `approveWithRecoverySigner`, which is the only code that opens the vault and
  signs with a sealed key. This is the check that actually withholds the vote.
- `DeviceRotationService.start` and `PrimaryRotationService.start`
  (`apps/backend/src/account/`), before anything is staged, so the **Consumer** is
  refused before a transaction index is spent on a change that could never
  execute.

`release-freeze.spec.ts` pins the asymmetry: a device rotation started on the
strength of the inbox is refused while frozen, a recovery-key change approved by
S1 and S2 goes through untouched because S3 is never asked, and lifting the freeze
lets the rotation through again.

### The console

`POST /console/accounts/:userId/recovery/freeze` and `/unfreeze`
(`apps/backend/src/console/console.controller.ts`) behind the same Basic Auth
guard as the rest of the console. `GET /console/accounts` lists **Accounts** with
the contact email, because a compromise report names an inbox and the operator
has to find the **Account** it anchors, the vault address, and the freeze state
with a Freeze or Release button. Nothing else about the **Consumer** is surfaced.

### The runbook

Freezing is the mandatory first step when a compromise report is opened, before
any investigation: `docs/specs/multisig-credentials-runbook.md`, section 8. It is
first because the staged change is on a clock and a lone signer cannot stop it.

### Consequences

- ✅ **Good:** The one lever Xend holds costs nothing in the threat model. The
  freeze cannot move an anchor, cancel a change, or sign anything.
- ✅ **Good:** The asymmetry is right. A **Consumer** holding phone and passkey is
  untouched; an attacker holding the inbox drops from one vote to none.
- ✅ **Good:** The refusal is early and explains itself, so a **Consumer** who is
  frozen learns it at the first tap of a recovery rather than after a 24 hour
  wait.
- ⚠️ **Bad:** A frozen **Account** cannot be recovered by email. An operator who
  forgets to release it strands a **Consumer** who later loses their phone. The
  runbook's last step is the release, and the console shows the state, but the
  reminder is procedural, not enforced.
- ⚠️ **Bad:** The console has a write surface with real consequence behind a
  shared credential. 0022's own revisit trigger has fired; CSRF and audit-log
  controls are being added, and per-operator identity is still owed.
- ⚠️ **Bad:** It does nothing against a pair that does not include S3. A stolen
  phone and a stolen passkey together is two of the **Consumer**'s own anchors and
  is outside what the design defends.

## Pros and Cons of the Options

### A per-Account freeze on S3's release

- ✅ No new anchor; refusal only.
- ✅ Checked at the vault and at the start of both rotations.
- ❌ Manual, and has to be released by hand.

### A settings authority held by Xend

- ✅ Can cancel a staged change outright.
- ❌ An override able to move an anchor is a fourth anchor, and voids the
  invariant. Rejected by 0025 and 0027 already.

### Nothing

- ✅ Nothing to build.
- ❌ The time lock is a notified wait with no exit for a **Consumer** holding one
  signer.

## More Information

- Extends [0027](0027-email-is-an-entry-point-not-a-login-method.md), build map
  item 16, and the 2026-09-07 update to
  [0025](0025-account-multisig-signer-set.md). Widens
  [0022](0022-internal-console-auth-boundary.md), see its update.
- Landed in `d2d0c78`.
- Source: `apps/backend/src/recovery/recovery.service.ts` (`assertReleaseAllowed`,
  `freezeRelease`, `unfreezeRelease`), `recovery.errors.ts`,
  `apps/backend/src/account/release-freeze.spec.ts`,
  `apps/backend/src/console/console.controller.ts`, `console.service.ts`,
  `apps/backend/src/db/schema.ts` (`users.recovery_release_frozen_at`)
