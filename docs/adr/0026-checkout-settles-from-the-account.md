# 0026: A Payment settles out of the Consumer's Account, fee-paid by the settlement authority

**Status:** Accepted
**Date:** 2026-08-29
**Deciders:** Xend founding team
**Tags:** backend, pay, wallet, solana, security

## Context and Problem Statement

Pay with Xend was designed and built while the **Account** was a single Privy
embedded wallet. [0025](0025-account-multisig-signer-set.md) replaced that with a
Squads smart account holding a 2-of-3 signer set, and the app followed: a
**Send** now leaves the vault through the Account's own policies, and the
Consumer's receive address, Balance and Activity all read the vault.

Checkout did not follow. Every place it touched money still read
`smart_accounts.wallet_address`, which is now S1, a signer on the vault that
holds nothing:

- the Balance behind every capacity check and the `INSUFFICIENT_BALANCE` gate,
- the `accountAddress` the Identity API answers with,
- the source and authority of the settlement transfer itself.

So a real **Payment** measured a Consumer's spending power against an empty
address and then tried to debit it. Nothing had failed loudly because the
settlement leg had no caller: `payment.authorized` has no consumer, and local
Checkout resolves through a development-only short circuit.

Repairing the source address alone was not enough. The old settlement leg
compiled a plain SPL `TransferChecked` with the **relayer** as fee payer, and
the relayer cannot carry this transaction: its co-sign allowlist admits
ComputeBudget, Token and ATA and nothing else, which is exactly what makes an
internet-reachable co-signer safe to run. A Spend carries a Squads instruction.

## Decision Drivers

- A Payment and a Send are the same movement, out of the same vault, decided by
  the same policies. Two implementations of that is how the drift happened.
- The relayer's narrowness is a security property, not an accident. Widening the
  allowlist to admit a Squads instruction spends the property to save a module.
- The Consumer must not need SOL. Somebody other than the Consumer pays the fee.
- Whatever pays the fee must not become an authority over anyone's money.
- The backend already holds S3. It must not come to hold a second signer.

## Considered Options

1. **Settle through the Spend path, fee-paid by the settlement authority.**
2. **Widen the relayer allowlist** to admit the Squads program and keep the
   relayer as fee payer.
3. **Keep the plain SPL transfer** and have the Consumer pre-fund the Privy
   wallet, sweeping into it before each Payment.
4. **Sign S1 on the backend** through a provider session-signer grant, so a
   Payment settles server-side with no round trip to the popup.

## Decision Outcome

Chosen option: **"Settle through the Spend path, fee-paid by the settlement
authority"**.

- `SettlementService` builds a Payment through `SpendService`, so a Payment
  resolves its route with `resolveSpendRoute` and executes under the same
  policies a Send does. The Spend path was extracted into its own module so
  settlement can reach it without a cycle.
- The settlement authority signs as fee payer, as it already does for a Send.
- A Payment is a two-call flow. `POST /checkout/authorize` recognises the
  Consumer and returns the built Spend; the popup signs it with the Account's
  primary signer; `POST /checkout/settle` takes the signed bytes, the authority
  completes them, and the chain decides the outcome.
- The Merchant settlement endpoint is a bare token account rather than anybody's
  associated one, so the Spend names both the account and its owner. The
  deployed program accepts any token account the named destination owns, which
  is verified against the real bytecode in the integration suite rather than
  taken from documentation.
- A Payment above the band one signature carries is refused with
  `APPROVAL_REQUIRED` **before** the intent moves, so no capacity is spent and
  no Session is issued, and the Consumer can still finish it from the app.

### Consequences

- Good: there is one Spend path. A change to how money leaves an Account cannot
  reach the app and miss Checkout again.
- Good: the relayer stays as narrow as it was built to be.
- Good: the authority signs only bytes that match the message pinned on the
  attempt, which is the same guard provisioning already relies on. It cannot be
  handed an arbitrary transaction naming it as fee payer.
- Bad: the authority is now on the payment hot path, so it is a liveness
  dependency for Payments as well as for Sends. It was previously reachable only
  on ops paths.
- Bad: a Payment now takes two round trips where it took one, because the
  signature has to come from the Consumer's own key in between.
- Bad: a recognised Session no longer guarantees a promptless repeat Payment. A
  Session proves recognition; it is not a signature, and if the provider session
  behind the signer has lapsed the passkey is presented again.
- Above the one-signature band, Checkout cannot complete a Payment at all. The
  handoff into the app is a screen today and not yet a flow; see below.

### Why not the alternatives

**Widening the relayer allowlist** trades a real security property for a module
boundary. The allowlist is why an internet-reachable co-signer is safe to run at
all, and a Squads instruction can execute arbitrary inner instructions, so
admitting it admits far more than a Payment.

**Pre-funding the Privy wallet** keeps money outside the Account's threshold for
as long as it sits there, which is the exact exposure 0025 exists to remove, and
adds a sweep that can fail between the two halves of a Payment.

**Signing S1 on the backend** was the answer an earlier plan recorded, when
Privy was the only signer. Under 0025 it is unsafe: the backend already holds S3
sealed, so a standing grant over S1 would put two of three signers in one place.
`ProvisioningService` names this directly, that reaching threshold from the
backend alone "is the thing the whole 2-of-3 exists to prevent". The popup signs
instead, with the Consumer present.

## The above-limit path

A Payment over the band needs S2, which lives on the Consumer's phone. Both
Spend routes are synchronous, one transaction bound to one blockhash, so
Checkout cannot collect S1 now and have the phone add S2 later: the transaction
would die with its blockhash long before anyone reached their phone. **The phone
produces both signatures itself, in one transaction.**

Checkout stamps the intent with the Consumer it resolved and refuses. The intent
stays `created`, so nothing is authorized and it is still payable. The app lists
what is waiting, and prepares and submits it through the same authorize path
Checkout uses, so a Payment is authorized identically whichever surface finishes
it. On the phone this is a home banner ahead of every other notice, because
somebody who was told to open the app is standing at a till.

## What this does not solve

- **Activity.** A Payment's row is created by the reconciler watching the vault
  and then relabelled, so this had to move before Payments could appear in
  Activity at all. Whether they now do is unverified.
- **Latency.** The popup entry is 60.8 kB gzipped against a 75 kB budget, but the
  Privy chunk behind it is far larger and loads as soon as the payment screen
  mounts. The sub-second popup budget has not been measured since the real
  ceremony started shipping.
