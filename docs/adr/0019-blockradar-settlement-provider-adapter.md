# 0019: Blockradar as the first SettlementProvider adapter (convert-at-settlement for naira), gated on three Solana confirmations

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Pay with Xend platform team
**Tags:** backend, pay, settlement, compliance

## Context and Problem Statement

The naira settlement leg ships as the first concrete implementation of Phase 4's frozen `SettlementProvider` interface (ADR 0015), not as a standalone payout system. The Blockradar adapter matches that interface exactly and is registered by APPENDING it to the `SETTLEMENT_PROVIDERS` factory array in `settlement.module.ts` (not a new DI token, not `router.register`); the `SettlementRouter` selects it for NGN by `capabilities.currencies`. Convert-at-settlement means the Consumer's USDC lands at a Blockradar-managed Solana child address under Xend's master wallet, Blockradar auto-converts to naira and settles to the Merchant bank, and "paid" means naira landed (the webhook drives completion through Phase 4's `completeDeferredSettlement`). The regulated crypto-to-fiat activity is Blockradar's. The pilot is USDC-settled via Phase 4's direct-USDC adapter and has no Blockradar dependency, so it proceeds regardless. The compliance touchpoint at this stage is the verified bank destination; KYB proper attaches at onboarding and gates live keys (Phase 6).

Platform-level Solana support at Blockradar is settled (each chain gets its own master wallet). Three narrower items remained open and had to be confirmed against the vendor docs before the adapter could be treated as real: (a) whether the full auto-sweep-plus-naira-off-ramp pipeline runs on a Solana master wallet specifically or is currently EVM-first; (b) whether each Merchant can get a direct per-Merchant bank payout on their child address; (c) whether the provider supports a reverse flow for refunds per Merchant. This ADR records those confirmations and the resulting route.

## Decision Drivers

- One-merchant pilot, Nigeria-first, USDC-settled today; the naira leg is additive and independently cuttable.
- No consumer KYC anywhere in Checkout (locked).
- Non-custodial posture is preferred, but the funds path is Blockradar's for the naira leg (see the custody nuance below).
- Solana-only guardrail (ADR 0010 lineage): no cross-chain bridging.
- Fail-safe: an unconfirmed leg must not silently move money or advertise a capability it cannot honor.

## The three confirmations (checked 2026-07-12 against docs.blockradar.co)

Stated as facts from the vendor docs, not inferences. All three are UNCONFIRMED for Solana at pilot; the documented API surface is nonetheless real and was coded against, then gated OFF.

- **(a) Solana auto-sweep plus naira off-ramp maturity: UNCONFIRMED (likely EVM-first).** The off-ramp (`withdraw-fiat`) and auto-settlements are demonstrated on EVM (Base) only; no Solana source asset appears in the `get-supported-assets` examples. Solana IS supported for deposits, address generation, and auto-sweep primitives (mainnet and devnet), and each chain needs its own master wallet. The documented off-ramp surface is real and adaptable: `get-supported-assets`, `get-currencies` (NGN, KES, and others), `get-exchange-rates`, `get-institutions`, `verify-institution-account`, `get-quote`, `execute`; plus `offramp.processing`/`offramp.success`/`offramp.failed` webhooks signed HMAC-SHA512 on the `x-blockradar-signature` header. Whether a Solana USDC asset is off-rampable must be confirmed at runtime via `get-supported-assets` plus Blockradar support.
- **(b) Direct per-Merchant bank payout: NOT auto or pre-bound.** Each child address CAN be off-ramped to an arbitrary bank via a per-call `execute` (institution and account in the request body), but bank details are not stored on the address, beneficiaries are crypto-only, and auto-settlements cannot target a bank. So payout is platform-initiated per call and funds sit in Blockradar-custodied addresses until then. Xend is therefore NOT structurally out of the funds path. This transient-custody nuance is recorded for the compliance and mainnet decision.
- **(c) Reverse flow for refunds (naira back to USDC to a Consumer): NO first-class primitive.** Only an NGN to cNGN on-ramp exists (Virtual Accounts, mainnet, cNGN only, no Solana or USDC). A reverse would have to be composed (on-ramp plus swap) and is not turnkey. The v3 refund model (`SettlementProvider.reverse()` for the naira leg) is therefore correctly capability-gated OFF for Blockradar until confirmed; the direct-USDC adapter's `reverse()` works natively (USDC back to the Consumer on Solana).

## Considered Options

1. **Blockradar convert-at-settlement adapter behind Phase 4's seam** (chosen; built against the documented `withdraw-fiat` surface with the Solana-native paths stubbed behind a flag).
2. **CCTP-bridge-then-off-ramp fallback for (a)** (rejected: cross-chain, violates the Solana-only guardrail; not built).
3. **A different off-ramp partner as a future SettlementProvider adapter** (deferred: a human decision if (a) stays failed).

## Decision Outcome

Chosen option: **"Blockradar convert-at-settlement adapter behind Phase 4's seam,"** built now but shipped STUBBED OFF because none of the three Solana confirmations passed. Concretely:

- The adapter implements the frozen interface exactly: `capabilities = { provider: 'blockradar', currencies: ['NGN'], refundSupport: <config>, settlementLatency: 'deferred' }`, appended to the `SETTLEMENT_PROVIDERS` factory array. `handleIncomingSettlement` is idempotent per signature (a partial-unique `settlement_offramps_signature_idx`) and returns `{ status: 'pending' }`; the off-ramp webhook drives completion through Phase 4's `completeDeferredSettlement` and never transitions the intent itself. Blockradar is the sole vendor importer (ADR 0010 Grid rule): raw `fetch` stays inside `blockradar-settlement.provider.ts`.
- The documented `withdraw-fiat` API surface is coded and unit-tested (fetch mocked). The Solana-native money-moving paths (the convert-payout in `handleIncomingSettlement` and `reverse`) are gated behind `BLOCKRADAR_SOLANA_NATIVE_ENABLED` (default false). The credentials stay optional at boot and the adapter fails loud only when the flag is on, so requiring them would not break the USDC-only pilot.
- `BLOCKRADAR_REFUND_SUPPORTED` defaults false (confirmation (c) failed), so `capabilities.refundSupport` is false and Phase 6's capability gate keeps naira refunds at `REFUND_NOT_SUPPORTED` (manual-ops). Direct-USDC refunds work now.
- No CCTP or cross-chain bridge is built. If (a) stays failed, the naira production path is NOT resolvable by bridging within the Solana-only guardrail; it needs a human decision (a Solana-native off-ramp vendor, Blockradar shipping Solana off-ramp, or an explicit guardrail exception). This is a blocking item for naira go-live, tracked as a human gate; the USDC pilot is unaffected.

### Consequences

- Good: the frozen interface, the registration seam, the idempotent off-ramp read model, the deferred-completion wiring, and the raw-body HMAC webhook all exist and are tested, so turning the leg on later is a config flip plus a runtime confirmation, not a rebuild.
- Good: the USDC pilot ships unblocked; the naira leg advertises no capability it cannot honor (refundSupport false, native path off).
- Good: no code moves naira for real until a human confirms the Solana off-ramp, so an unconfirmed pipeline cannot silently mis-settle.
- Bad: the naira leg is not functional at pilot; a real naira go-live is blocked on a human decision about the Solana off-ramp gap.
- Bad: even once (a) is confirmed, the transient-custody nuance from (b) means Xend is briefly in the funds path via Blockradar-custodied addresses; this must be disclosed for compliance.
- Bad: naira refunds are manual-ops until (c) is confirmed.

## Pros and Cons of the Options

### Blockradar convert-at-settlement adapter (chosen)

- Reuses Phase 4's frozen seam; one vendor confined to one adapter.
- Ships the full mechanism (idempotency, deferred completion, webhook) ready to enable.
- Cannot settle naira for real until the Solana off-ramp is confirmed.

### CCTP-bridge-then-off-ramp fallback

- Would route around a Solana off-ramp gap using Blockradar's mature EVM off-ramp.
- Rejected: cross-chain, violates the Solana-only guardrail; adds a bridge fee, latency, and operational surface. Not built.

### A different off-ramp partner

- Could offer a native Solana off-ramp.
- Deferred: a research and commercial decision for a human if (a) stays failed at Blockradar.

## More Information

- Plan: `.claude/plans/pay-with-xend/phases/08-p2-surfaces/PLAN.md` (tasks 8.4, 8.5, 8.6)
- Findings ledger: `.claude/plans/pay-with-xend/PROGRESS.md` (Flags #2 and #3)
- Source: `apps/backend/src/settlement/providers/blockradar/` (provider, webhook controller, errors, module), `apps/backend/src/settlement/settlement.module.ts` (factory-array append), `apps/backend/drizzle/0009_settlement_offramps.sql`
- Contract: `.claude/plans/pay-with-xend/CONTRACTS.md` (SettlementProvider layer), `apps/backend/src/settlement/settlement-provider.interface.ts`
- Related: [ADR-0010](./0010-no-load-bearing-provider.md) (owned-interface Grid rule), [ADR-0015](./0015-settlement-provider-layer.md) (the settlement provider layer), [ADR-0023](./0023-fx-offramp-quote.md) (FX quote seam)
- Destination checklist: `docs/specs/merchant-payout-destination-checklist.md`
