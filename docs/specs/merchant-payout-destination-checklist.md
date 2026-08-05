# Merchant payout destination checklist (Blockradar naira leg)

Status: draft, pre-go-live
Author: Pay with Xend, 2026-07-12
Scope: the operational checklist for setting up the Blockradar relationship and the verified bank destination for a naira Merchant, plus the naira settlement end-to-end proof on a test bank account. This is the settlement-provider-stage compliance touchpoint (ADR 0019). It does NOT repeat KYB, which attaches at onboarding and gates live keys (Phase 6). It records only that each step happened and when; sensitive evidence lives outside the repo.

## 1. Precondition: live keys imply KYB cleared

The Merchant already holds live keys. Per the onboarding model, live keys are issued only after KYB (registration, beneficial ownership, sanctions) cleared at onboarding. This checklist confirms that precondition was met and records the date; it does not re-run KYB. Consumers are never KYC'd anywhere in Checkout (locked).

- [ ] Merchant holds live keys (KYB cleared at onboarding). Confirmed by: **\_\_** Date: **\_\_**

## 2. Blockradar relationship setup

- [ ] Solana master wallet created; its id recorded into `BLOCKRADAR_MASTER_WALLET_ID`.
- [ ] Webhook endpoint and secret configured; the secret recorded into `BLOCKRADAR_WEBHOOK_SECRET` (the off-ramp webhook is HMAC-SHA512 verified on `x-blockradar-signature`).
- [ ] A Solana child address provisioned for the Merchant under the master wallet, with auto-sweep confirmed.
- [ ] The three ADR 0019 confirmations rechecked at go-live and recorded as passed (Solana auto-sweep plus naira off-ramp maturity; direct per-Merchant bank payout; per-Merchant reverse). Until (a) passes, the naira leg stays disabled (`BLOCKRADAR_SOLANA_NATIVE_ENABLED=false`).
- [ ] `BLOCKRADAR_REFUND_SUPPORTED` set to match confirmation (c): true only if per-Merchant reverse is confirmed, else false (naira refunds stay manual-ops via Phase 6's capability gate).

## 3. Bank destination verification

- [ ] The Merchant's NGN bank account verified via Blockradar's verify-account (verify-institution-account) endpoint.
- [ ] The returned account name matched against the Merchant's registered business name. A mismatch is a STOP: do not proceed.
- [ ] The verified destination recorded into the settlement endpoint's `payoutConfig` (with `verified: true`) so `handleIncomingSettlement` will not off-ramp to an unverified destination (it raises `DESTINATION_UNVERIFIED` otherwise).

## 4. Completion procedure

- [ ] Reviewer named and sign-off recorded (who, when).
- [ ] Evidence (the raw verify-account response, the master wallet and child address ids) stored in the ops secret store OUTSIDE this repo. This checklist records only that verification happened and its date.

## 5. Naira settlement end-to-end (test bank account)

Run only if the ADR 0019 confirmations pass and the leg is enabled. This is a human-in-the-loop proof against Blockradar's test environment; record the outcome in the phase SUMMARY.md.

- [ ] Send test USDC to the Merchant's Solana child address; observe auto-sweep, naira conversion, and bank payout.
- [ ] The `offramp.success` webhook flips the off-ramp row to `paid` and calls Phase 4's `completeDeferredSettlement`, so the Payment reaches `succeeded` and `payment.succeeded` publishes (correlation id constant throughout); the `payout.completed` observability event fires.
- [ ] Replay the webhook delivery: the second delivery is a no-op (no duplicate `completeDeferredSettlement`, no duplicate event, row unchanged).
- [ ] Re-invoke `handleIncomingSettlement` with the same signature: no-op (no second convert-payout).
- [ ] Invoke `reverse()` (as Phase 6's refund API would) for the settled Payment: the naira to USDC to Consumer reversal runs and records a `reversing`/`reversed` off-ramp row (only when refund support is confirmed).
- [ ] Negative checks: an un-KYB'd merchant raises `MERCHANT_KYB_REQUIRED` with no convert-payout; a mismatched bank destination raises `DESTINATION_UNVERIFIED` before any convert-payout.

## 6. Scope notes

- Consumers are never KYC'd anywhere in Checkout (locked).
- KYB proper is owned by onboarding and gates live keys (Phase 6); this checklist does not repeat it.
- Convert-at-settlement means Blockradar owns the funds path: no merchant signer and no Xend-initiated debit. Note the transient-custody nuance from ADR 0019 confirmation (b): funds sit in Blockradar-custodied addresses until the platform-initiated payout, so Xend is briefly in the funds path.
- Refunds run reverse-through-provider (naira to USDC to the Consumer at the live rate), invoked by Phase 6's refund API, only when confirmation (c) is met; otherwise naira refunds are manual-ops.
