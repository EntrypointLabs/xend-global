# 0015: Settlement provider layer: a pluggable SettlementProvider interface with convert-at-settlement, single-root attribution, and refund-in-reverse

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Pay with Xend planning
**Tags:** backend, solana, pay, settlement

## Context and Problem Statement

A Payment moves USDC from a Consumer Account to a per-Merchant settlement destination. The destination is not one fixed thing: the pilot holds dollars (USDC settled directly), while the naira product converts USDC to NGN at settlement and pays out to a bank through a regulated partner (Blockradar). Earlier revisions hardcoded a single vehicle (first a Xend-authority `createAccountWithSeed` account, then a Merchant-controlled account with a Merchant signer), and each revision forced a schema and code rewrite when the model changed. The recurring lesson is that no single settlement vendor should be load-bearing, and merchants in this model hold no wallet and no signer.

We need a settlement layer that (a) lets a second destination type (naira via Blockradar) plug in later without reshaping the payment hot path, (b) keeps per-Merchant addresses attributable from a single Xend root so an indexer can compute per-Merchant volume without a hand-maintained list, and (c) keeps the inbound settlement a plain classic-SPL transfer so the fee-payer relayer's allowlist and destination checks stay valid unchanged.

## Decision Drivers

- No single vendor is load-bearing (the silent-discontinuation lesson); the same rule that isolates the wallet vendor behind WALLET_PROVIDER must isolate the settlement vendor.
- Merchants have no wallet and no signer under the current model; the chain is the source of truth and the off-chain table is a read model.
- Attribution must be enumerable from one Xend root (REQ-ATTRIBUTABLE).
- Inbound settlement must stay a plain classic-SPL USDC TransferChecked (REQ-PLAIN-SPL) so the Phase 3 relayer checks stay valid; Token-2022 transfer hooks are the future path that would break this.
- A second adapter (Blockradar, naira, convert-at-settlement) must not fight the abstraction, so the interface is defined from the domain's needs, not from any one provider's API.

## Considered Options

1. **Pluggable SettlementProvider layer** - an owned interface plus a router that selects an adapter by settlement currency or recorded provider; a trivial direct-USDC adapter now, Blockradar appended behind the same seam in Phase 8.
2. **Hardcoded Blockradar field** - store a single provider's reference directly on the Merchant record and call its API inline.
3. **Merchant-controlled account with a Merchant signer (v2)** - the Merchant holds the settlement account and signs refunds.
4. **Xend-authority `createAccountWithSeed` derivation (v1)** - deterministic per-Merchant derivation from an authority seed.

## Decision Outcome

Chosen option: **"Pluggable SettlementProvider layer"**, because it isolates every settlement vendor behind a single adapter (the no-load-bearing-vendor rule), lets the naira path plug in later without touching the payment hot path, and keeps attribution and the plain-SPL invariant independent of which provider is registered.

The model:

- A `SettlementProvider` interface bound behind the `SETTLEMENT_PROVIDERS` DI token (a NestJS multi-provider array), and a `SettlementRouter` that selects an adapter by settlement currency (`forCurrency`, at provisioning) or by the recorded provider name (`forProvider`, at settlement, confirmation, and refund). The interface is defined from the domain's needs: `provision`, `handleIncomingSettlement`, `reverse`, `report`, plus advertised `capabilities`. Phase 8 registers Blockradar by appending its adapter to the factory's returned array, not by adding a new token.
- The internal Merchant record references a polymorphic settlement endpoint on the `settlement_accounts` row: `provider`, `currency`, `provider_reference`, `payout_config`, `address`, and `authority_address` as the attribution root. The table is explicitly a read model; a Merchant's owed balance is their on-chain USDC balance, there is no pooled ledger, and Xend holds no standing merchant float on the naira path (the regulated conversion and payout are the partner's).
- Attribution via a single Xend Solana root (REQ-ATTRIBUTABLE): for Blockradar these are child addresses under Xend's Solana master wallet; for the direct-USDC pilot each Merchant gets a distinct Xend-authority-owned USDC token account, one address per Merchant, enumerable from the authority root. A recorded merchant-own address is the null-attribution variant.
- Convert-at-settlement completion semantics: for direct-USDC, "settled" means USDC confirmed. For Blockradar, "paid" may mean naira-landed, which is a Phase 6 webhook-semantics decision, so the payment lifecycle keys off the provider's completion signal (`handleIncomingSettlement` returns `complete` or `pending`), not solely the USDC confirmation. Direct-USDC returns `complete` synchronously; the deferred completion path is a seam, not built at pilot.
- Refund-in-reverse: `SettlementProvider.reverse()` is the refund seam. The direct-USDC adapter sends USDC back to the Consumer, authority-signed; Blockradar reverses naira to USDC in Phase 8. Refunds are ops-initiated, partial-capable, at the live rate at refund time; the `payments.refund_of_payment_id` linkage records them. No Merchant signer exists.
- REQ-PLAIN-SPL: inbound settlement is always a plain classic-SPL USDC TransferChecked into the endpoint's token account, so the Phase 3 relayer allowlist, fee-payer, and destination checks stay valid. A Blockradar child token account is exactly a classic-SPL account; Token-2022 transfer hooks are the future path that would break this.

### Consequences

- Good: a second settlement destination type (naira via Blockradar) plugs in behind the same seam without reshaping the payment hot path or the schema.
- Good: attribution and the plain-SPL invariant hold regardless of which provider is registered; the relayer checks stay valid.
- Good: no single settlement vendor is load-bearing, matching the wallet-vendor isolation rule.
- Bad: for the direct-USDC hold-dollars pilot, Xend is briefly in the funds path via the authority-owned account (the honest trade-off). The naira default via Blockradar is what keeps Xend fully out of custody, and the direct-USDC pilot is the interim path.
- Bad: the polymorphic reference adds indirection compared with a single hardcoded field; provider selection is a runtime lookup rather than a compile-time reference.

## Pros and Cons of the Options

### Pluggable SettlementProvider layer

- Good: isolates every vendor behind one adapter; the naira path plugs in later.
- Good: attribution and plain-SPL invariants are provider-independent.
- Bad: indirection and a runtime router lookup.

### Hardcoded Blockradar field

- Good: least code today.
- Bad: single-vendor load-bearing; a vendor change or a second destination type forces a rewrite (the exact failure this layer avoids).

### Merchant-controlled account with a Merchant signer (v2)

- Superseded. The current model removes Merchant custody, so there is no Merchant signer and no provisioning vehicle. Refunds run in reverse through the provider instead of being Merchant-signed.

### Xend-authority `createAccountWithSeed` derivation (v1)

- Superseded. Attribution is now via a provider root (Blockradar master wallet, or the direct-USDC authority), not deterministic seed derivation.

## More Information

- Plan: `.claude/plans/pay-with-xend/phases/04-settlement-leg/PLAN.md`
- Frozen contract: `.claude/plans/pay-with-xend/CONTRACTS.md` (SettlementProvider interface + settlement_accounts v3 shape)
- Related: [ADR-0010](./0010-no-load-bearing-provider.md) (owned interfaces per provider category), [ADR-0012](./0012-pay-platform-topology.md) (topology + event catalog), [ADR-0020](./0020-solana-sdk-coexistence.md) (kit/web3.js coexistence)
- Source: `apps/backend/src/settlement/settlement-provider.interface.ts`, `apps/backend/src/settlement/settlement-router.ts`, `apps/backend/src/settlement/providers/direct-usdc.provider.ts`
