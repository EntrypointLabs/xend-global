# 0033: Provisioning derives its step from chain state, pins prepared transactions in a shared store, and takes the one-transaction shortcut only at lock zero

**Status:** Accepted
**Date:** 2026-09-07
**Accepted:** 2026-08-14
**Deciders:** Xend founding team
**Tags:** backend, mobile, wallet, solana

## Context and Problem Statement

An **Account** is created with three signers and then made usable by one settings
change that installs the spending-limit policy, the above-limit policy and the 24
hour Settings lock ([0025](0025-account-multisig-signer-set.md)). A settings change
needs two of the three signers, and the backend holds only S3 by design, so the
change is driven from the phone: the backend builds transactions, the device signs
them, the backend co-signs as fee payer and submits.

Three things make that fragile. A flow with a biometric prompt in the middle will
be interrupted: a backgrounded app, a dropped connection, a killed process. The
submit endpoint has the settlement authority partially sign whatever arrives, so
without a guard it is a way to have the backend sign any transaction naming the
authority as fee payer. And the naive shape of a settings change is four
transactions (propose, two approvals, execute), which is four round trips and two
hardware-key prompts for something the **Consumer** experiences as one act.

## Decision Drivers

- The chain already knows how far provisioning got: which policies exist, what
  the lock is, who has approved the proposal in flight. Tracking that a second
  time in Postgres is a reconciliation problem waiting to happen.
- A retry has to be safe from any point. The only way to guarantee that is for
  each call to ask the chain what comes next.
- The authority's signature is the thing being protected. It must sign only
  bytes this backend built.
- A pin held in process memory refuses a good signature after a restart or from a
  second instance, and the transfer flow already learned that lesson.
- Synchronous execution requires the consensus account's `time_lock` to be zero
  (`TimeLockNotZero`, verified in 0025). Before provisioning lands, the Settings
  lock is zero. After, it is not.

## Considered Options

1. **Derive the step from chain state, pin the prepared message in a shared store,
   and propose-approve-execute in one transaction when nothing is staged** - the
   shape built.
2. **Track progress in a `provisioning_step` column** - persist the cursor and
   advance it on each submit.
3. **Always four transactions** - no shortcut; the same granular steps every time.

## Decision Outcome

Chosen option: **"Derive the step from chain state, pin in a shared store,
one-transaction shortcut when nothing is staged"**.

### The step is derived, never stored

`ProvisioningService.prepareNext` (`apps/backend/src/account/provisioning.service.ts`)
reads the Settings (`timeLockSeconds`, `transactionIndex`) and, if the lock is
already non-zero, checks that both policies exist; that is `isProvisioned`, read
from the chain so an **Account** half-provisioned by an interrupted run or an older
build is diagnosed rather than trusted. Otherwise it reads the proposal at the
current index. A settled proposal means that index is spent and the next change
starts at `index + 1`; an open one is the change in flight. `nextStep` then maps
who has approved to what comes next:

| Proposal at this index | Step               |
| ---------------------- | ------------------ |
| none                   | `provision`        |
| S1 not yet approved    | `approve-primary`  |
| S2 not yet approved    | `approve-approval` |
| both approved          | `execute`          |

`submit` takes no claim about which step it is. The transaction was compiled by
`prepareNext` and is signed, so what it does is already fixed; a label from the
client could only disagree with it. The next `prepareNext` reads the chain and
finds out what landed. On the phone, `useProvisionAccount`
(`apps/mobile/hooks/useProvisionAccount.ts`) loops `prepareNext` and `submit` with a
bound of six steps so a disagreement between device and chain ends in an error
rather than an endless prompt.

Every chain read in `Web3ProvisioningChain` (`provisioning-chain.web3.ts`) throws
on failure rather than reporting an absence, because an RPC error read as "no
policy yet" would propose a policy that already exists and waste two signatures
and a biometric prompt on a transaction that cannot land.

### The prepared message is pinned in a shared store

`prepareNext` compiles the step and pins the base64 message under the user's key
in `PreparedTxStore` (`apps/backend/src/prepared/prepared-tx.interface.ts`).
`submit` deserialises what arrived, serialises its message, and refuses anything
that does not match the pin ("signed transaction does not match the prepared
provisioning step"), then deletes the pin so a signed step is submitted once and a
replay has to prepare again against the chain's current index.

The store is the seam. `PreparedTxStore` is `set`, `get`, `delete` with a TTL;
`PREPARED_TX_TTL_SECONDS` is five minutes, long enough for a biometric prompt and
a slow network, short enough that a stale blockhash never outlives its pin by
much. `prepared-tx.redis.ts` backs it in Redis so any backend instance can
complete what any other prepared, and `prepared-tx.memory.ts` backs it in tests.
The same store carries the pins for a **Spend** (`spend.service.ts`, keyed by
message), a transfer intent (`transfer.service.ts`), the device and primary
rotations, a recovery-key change and a rejection. The pin used to be a `Map` on
each of those services, which is why a restart between prepare and submit
refused a perfectly good signature; that shape is retired.

### The one-transaction shortcut, and when it is legal

When no proposal exists at the index, `provision` builds propose, both approvals
and execute into a single transaction (`buildProvisionAccount` in
`packages/smart-account/src/policy.ts`, followed by two `buildApproveSettingsChange`
and one `buildExecuteSettingsChange`). One round trip, one hardware-key prompt,
one Privy signature.

This is legal only because the Settings lock is zero at that moment. The lock is
checked once, before any action in the change applies, against the lock the
Settings currently carries, and provisioning is the change that sets it. The
`SetTimeLock` action rides last in the list and does not hold back the policies
beside it. Once the lock is non-zero, an execute in the same transaction as its
approvals would fail, which is why every later settings change (a rotation, a
recovery-key change) is granular and waits out the lock. The granular
`approve-primary`, `approve-approval` and `execute` steps exist here only to resume
a change an interrupted older run left partway, which a single atomic transaction
can no longer produce.

Rent for the transaction, proposal and policy accounts is paid by the settlement
authority, because a **Consumer** has funded nothing yet when these run and neither
S1 nor S2 can pay.

### Consequences

- ✅ **Good:** Nothing to reconcile. A **Consumer** who kills the app mid-prompt opens
  it again and the next call is the right one.
- ✅ **Good:** Sign-up is one prompt for the whole settings change.
- ✅ **Good:** The authority signs only bytes this backend built, from any instance,
  across a restart.
- ✅ **Good:** The store is one owned seam for every prepare-then-submit flow, so
  the next flow inherits the guard instead of re-implementing a `Map`.
- ⚠️ **Bad:** Every `prepareNext` costs chain reads: Settings, a proposal, and up to
  two policy accounts. The time lock is checked first because it is already in
  hand.
- ⚠️ **Bad:** Redis is on the sign-up path. It is already required at boot
  ([0012](0012-pay-platform-topology.md)), so no new dependency, but a Redis
  outage now blocks provisioning as well as Pay.
- ⚠️ **Bad:** The shortcut and the granular path build the same change two ways,
  and both have to stay in step with the policy builders.

## Pros and Cons of the Options

### Derive from chain, shared pin, one-transaction shortcut

- ✅ Retry-safe from any point; no stored cursor to drift.
- ✅ One prompt at sign-up.
- ❌ More RPC reads per step.

### Track progress in a column

- ✅ Cheaper reads.
- ❌ A column that says `execute` while the chain says the proposal was never
  created is a stuck **Account**, and the failure modes that produce it (a submit
  that timed out after landing) are the common ones.

### Always four transactions

- ✅ One code path.
- ❌ Two hardware-key prompts and four round trips at sign-up for no benefit while
  the lock is zero.

## More Information

- Extends [0025](0025-account-multisig-signer-set.md). Related:
  [0012](0012-pay-platform-topology.md) (Redis), [0020](0020-solana-sdk-coexistence.md)
  and its update (why this path is web3.js), [0031](0031-lost-passkey-primary-rotation.md)
  and the device rotation, which reuse the derived-step and pin pattern.
- Source: `apps/backend/src/account/provisioning.service.ts`,
  `provisioning-chain.web3.ts`, `account.interface.ts` (`ProvisioningChain`,
  `ProvisioningStep`), `apps/backend/src/prepared/prepared-tx.interface.ts`,
  `prepared-tx.redis.ts`, `prepared-tx.memory.ts`,
  `packages/smart-account/src/policy.ts` (`buildProvisionAccount`),
  `apps/mobile/hooks/useProvisionAccount.ts`
