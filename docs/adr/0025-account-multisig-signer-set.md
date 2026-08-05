# 0025: The Account becomes a Squads smart account with a 2-of-3 signer set

**Status:** Proposed
**Date:** 2026-08-02
**Deciders:** Xend founding team
**Tags:** mobile, wallet, security, vendor, solana

## Context and Problem Statement

The **Account** today is a Privy embedded Solana wallet: one ed25519 keypair, one
signer, threshold 1. The send path is `prepareTransfer` -> Privy `signTransaction`
-> `submitTransfer` (`apps/mobile/app/(send)/confirm.tsx:83`), and
`useWalletAddress()` returns the Privy address, so **Consumer** funds sit at an
address a single key controls. The passkey in `apps/mobile/hooks/usePasskey.ts` is a
Privy login credential, not a signer on anything.

The consequence is that whoever controls the sign-in email inbox can complete a
login and move all funds. Privy's own security checklist names this shape directly
and recommends MFA for any app using email OTP as primary auth.

Vendor-side MFA is a partial answer. It is enforced by one vendor, so a compromise
or coercion of that vendor defeats it. A threshold enforced on-chain cannot be
defeated by any single vendor. This ADR records the move to that shape.

This ADR **extends** [0024](0024-privy-adoption.md) rather than reopening it. 0024
adopted Privy as the consumer-side signing vendor with no fallback vendor in scope.
Turnkey enters here not as a fallback, an alternative, or a revived vendor race, but
as a **second simultaneous signer that exists precisely so that no single vendor is
sufficient**. Both vendors are load-bearing at the same time. 0024's review-blocking
rule still holds: each vendor SDK is reached only through its own owned adapter.

## Decision Drivers

- A signer is a key holder **plus an unlock channel**. Splitting vendors defends
  against vendor compromise, which is rare. Splitting unlock channels defends
  against account takeover, which is what actually drains consumer wallets.
- **Checkout is passkey-only.** Tapping "Pay with Xend" on a merchant page prompts the
  passkey and nothing else: no app, no login, no OTP. This is the product, and it
  determines S1's anchor rather than being determined by it.
- A consumer has exactly three identity anchors: their email inbox, their platform
  account (Apple ID or Google), and physical possession of their phone. Everything
  else collapses into one of these, so the signer set gets one per anchor.
- The **Account** must be reachable from any device. A **Consumer** on a MacBook
  must be able to **Spend**. This rules out any design where a device-bound key is
  required on every spend, which is why Fuse is effectively iPhone-only.
- Everyday **Spend** must stay one tap. A second factor on a $6 P2P send would
  destroy the product.
- No seed phrases and no crypto vocabulary. Recovery has to be expressible as
  "enter your email".
- There are no users yet, so every **Account** can be created in its final shape.
  No migration, no sweep, no address change to manage.

## Considered Options

1. **Squads Smart Account Program, 2-of-3, one signer per identity anchor** - Privy
   behind a passkey, Turnkey behind a phone hardware key, and an email-gated recovery
   signer, with policies carrying the everyday UX.
2. **Privy wallet MFA alone** - keep the single signer, gate every signature on a
   passkey MFA challenge.
3. **Squads V4 multisig** - the same signer set on the older, more battle-tested
   program that Fuse runs on.
4. **Copy Fuse exactly** - device key in the Secure Enclave plus an iCloud cloud key
   as the two active keys.

## Decision Outcome

Chosen option: **"Squads Smart Account Program, 2-of-3, one signer per identity
anchor"**, because it is the only option that puts the threshold on-chain (so no
single vendor is sufficient) while keeping everyday spends at one signature and one
transaction.

### The signer set

|             | S1                            | S2                                                  | S3                                   |
| ----------- | ----------------------------- | --------------------------------------------------- | ------------------------------------ |
| Anchor      | platform account              | physical possession                                 | email inbox                          |
| Key holder  | Privy                         | Turnkey                                             | Xend, encrypted and server-held      |
| Unlock      | passkey, on its own           | biometric-gated hardware key on the phone           | proving control of the sign-up email |
| Permissions | `Initiate \| Vote \| Execute` | `Vote \| Execute`                                   | `Vote`                               |
| Present     | every spend                   | above the spending limit, and every settings change | recovery only                        |

Threshold 2, `settings_authority` unset (autonomous, no admin override), non-zero
`time_lock` on settings changes.

The anchors follow from the product rather than from preference. "Pay with Xend" on a
merchant page must prompt the passkey and nothing else, so the passkey alone completes
S1 and S1's anchor is the platform account. S3 therefore cannot also live there, which
is why it moved server-side behind an email check. That also fixes the
iPhone-to-Android case, where a passkey and an iCloud blob would both be lost at once.

Signup is passkey-first (`signupWithPasskey`), with the email collected on a later
onboarding screen as simply "your email". One email, once.

**Invariant:** no single compromise may yield `threshold` signers. Not one vendor,
not one inbox, not one platform account, not one device.

### Policies carry the UX

A `Policy` is a separate account with **its own signer set and threshold**, and
`transaction_execute_sync` accepts either the Settings or a Policy as its consensus
account. This is used to scope authority per action:

| Path                             | Consensus                 | Signers    | Threshold |
| -------------------------------- | ------------------------- | ---------- | --------- |
| Spend under the limit            | SpendingLimit policy      | S1         | 1         |
| Spend over the limit             | ProgramInteraction policy | S1, S2     | 2         |
| Settings change, signer rotation | Settings                  | S1, S2, S3 | 2         |

S3 therefore cannot move money on any path. Its authority is confined to changing
the signer set, which is time-locked and notifiable. That is what keeps a compromise
reaching both S1 and S3 to a survivable event rather than a drain.

Policies are **required**, not an optimization. Runtime testing against the deployed
bytecode established two things that force it:

1. Vote-only permissions do not stop a signer contributing to a spend. S1 plus S3
   spent successfully through the Settings consensus. Only a policy signer set
   excludes S3.
2. Synchronous execution requires the consensus account's `time_lock` to be 0
   (`TimeLockNotZero`, 6051). A time-locked Settings cannot carry spends at all, so
   the Settings time lock and one-transaction spends coexist only because the spend
   runs under a policy whose own `time_lock` is 0.

### Verified against the deployed program

Run against real mainnet-and-devnet bytecode in LiteSVM. Account creation, threshold
enforcement, a 2-signer spend in one transaction (23,264 CU), settings time lock
delay and release, per-policy signer sets, and a synchronous policy spend while the
Account is time-locked all pass. An Account costs **0.00252452 SOL** to create,
almost entirely settings-account rent, with a 0 creation fee. Detail and the
one failing assumption are recorded in the spec.

### Consequences

- ✅ **Good:** An inbox compromise yields one signer and cannot move funds. That is
  the single biggest change to the threat model.
- ✅ **Good:** No vendor can move funds alone. Privy and Turnkey are both required
  above the limit, and the **Consumer** can outvote either with S1 or S2 plus S3.
- ✅ **Good:** Everyday **Spend** stays one signature and one transaction, on any
  device, because `transaction_execute_sync` avoids the proposal round trips.
- ✅ **Good:** Recovery is symmetric and seedless. Any two signers restore access
  and rotate in a replacement for the third.
- ✅ **Good:** Funds move to a PDA that no single key controls, and the address is
  stable across every signer rotation.
- ⚠️ **Bad:** A second vendor is now load-bearing. Turnkey being down blocks spends
  above the limit, though not everyday spends.
- ⚠️ **Bad:** Above-limit spends on a laptop require the phone, because the
  possession factor lives there. This is deliberate but it is real friction.
- ⚠️ **Bad:** Xend holds S3, encrypted and email-gated. Not pure self-custody. It is
  the weakest of the three signers, cannot spend under any path, and cannot reach
  threshold alone, but it is a custody claim we now have to stand behind.
- ⚠️ **Bad:** S2 is unrecoverable in isolation by design, since Turnkey email auth
  and recovery are disabled. A lost phone burns it, making S3 load-bearing rather
  than decorative.
- ⚠️ **Bad:** More moving parts: two vendor adapters, a policy set, and a spending
  limit band that must be tuned or the second factor fires on ordinary payments.
- ⚠️ **Bad:** The program is v0.1. Audited by OtterSec and Certora and formally
  verified by Certora, but younger than V4.

## Pros and Cons of the Options

### Squads Smart Account Program, 2-of-3, one signer per anchor

- ✅ Threshold enforced on-chain, so no single vendor is sufficient.
- ✅ `transaction_execute_sync` gives one transaction per spend, no proposal rent.
- ✅ Per-policy signer sets let S3 be recovery-only without extra machinery.
- ✅ Creation verified permissionless: mainnet `ProgramConfig` shows a 0 lamport
  creation fee, no whitelist field, and 502,795 accounts already created.
- ❌ v0.1, and the `@sqds/smart-account` SDK is unpublished, so it must be vendored
  from the repo at a pinned commit.
- ❌ Two vendor integrations to build and maintain instead of one.

### Privy wallet MFA alone

- ✅ Far less work. No second vendor, no smart account, no policies.
- ✅ Keeps the current address and send path untouched.
- ❌ Vendor-enforced, not chain-enforced. A Privy compromise or coercion defeats it.
- ❌ MFA enrollment is opt-in with no app-wide force switch, so coverage is partial
  by construction.
- ❌ Key export is on by default, so a compromised session can exfiltrate the raw
  key and end the discussion permanently.

### Squads V4 multisig

- ✅ The most battle-tested option, audited four times, and what Fuse runs on.
- ✅ `@sqds/multisig` is published on npm, so no vendoring.
- ❌ No synchronous execution. Every spend outside a spending limit is 3 to 4
  transactions plus rent for the proposal and transaction accounts.
- ❌ No per-policy signer sets, so scoping S3 out of spending needs another
  mechanism.

### Copy Fuse exactly

- ✅ Proven in a shipping product, with an information architecture we can borrow.
- ❌ The cloud key is an iCloud container, so the **Account** hard-binds to Apple and
  Android **Consumers** cannot spend. This alone disqualifies it.
- ❌ Their default is 1-of-2 until a recovery key is added, which is two attack
  surfaces and no threshold.

## More Information

- Full decision record, verified vendor findings, and open items:
  [`docs/specs/account-security-model-decisions.md`](../specs/account-security-model-decisions.md)
- Supersedes nothing. Extends [0024](0024-privy-adoption.md), whose adapter rule
  still applies to both vendors.
- Related: [0013](0013-session-model.md),
  [`docs/specs/privy-config-verification.md`](../specs/privy-config-verification.md)
- Program: `SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG`, mainnet and devnet,
  [Squads-Protocol/smart-account-program](https://github.com/Squads-Protocol/smart-account-program)
- Fuse key explainer screenshots, captured from a live account:
  `docs/design/references/fuse/`
- Current single-signer path: `apps/mobile/app/(send)/confirm.tsx:83`,
  `apps/mobile/hooks/useWalletAddress.ts`, `apps/mobile/hooks/usePasskey.ts`
