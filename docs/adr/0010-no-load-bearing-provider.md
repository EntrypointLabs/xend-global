# 0010: No Load-Bearing External Provider

**Status:** Accepted
**Date:** 2026-05-30
**Deciders:** Xend engineering, in concert with the Grid migration plan
**Tags:** architecture, backend, providers, anti-lock-in, migration

## Context and Problem Statement

Xend was originally built on Squads Grid, which bundled wallet creation, OTP, signing, balance reads, transfers, KYC, and virtual accounts behind one vendor relationship. Grid was silently wound down by its vendor. The forced migration off Grid surfaces a structural problem worth fixing in the same pass: if a single external provider can take Xend offline by disappearing, the architecture has a load-bearing dependency on something we do not control.

The current state compounds the risk: the expo-router BFF (`apps/mobile/app/api/*+api.ts`) ships `GRID_API_KEY` into the Expo runtime, and SNS resolution in `apps/mobile/utils/solana.ts` hardcodes a Helius URL with the API key in source. Provider keys leaking into the device runtime and provider relationships hidden inside ad-hoc call sites are the same lock-in problem in two shapes.

The migration is the cheapest moment in Xend's life to put an anti-lock-in architecture in place before launch.

## Decision Drivers

- **Survival of the product**: Grid going dark cannot kill Xend. The same must be true for every replacement.
- **Migration cost amortisation**: we are touching every wallet, signing, KYC, and RPC call site anyway. Adding a thin internal interface during the rewrite costs near-zero; retrofitting one later would force a second rewrite.
- **Device-side secret hygiene**: no provider API key may live in the Expo runtime, ever. The BFF deletion already addresses this; the principle generalises it.
- **Future swap precedent**: Privy is Solana-secondary (Ethereum-first historically). We may want to swap to Turnkey or Crossmint without rewriting business logic.
- **Single source of read-side truth**: the non-optimistic Balance invariant (PROJECT.md) requires that no provider can lie to us about balance state. This is enforced architecturally by the interface boundary, not by review.

## Considered Options

1. **Direct provider SDKs in business logic** — call `privy.verifyIdToken(...)`, `helius.getTokenAccountsByOwner(...)` etc. directly from the modules that need them.
2. **Anti-corruption layer per provider, scoped to its single caller** — wrap each provider in a thin client used by exactly one module, but no shared interface across providers in the same category.
3. **Owned interfaces per provider category, multiple adapters allowed** — define `WalletProvider`, `SolanaRpc`, `KycProvider`, `VirtualAccountProvider` as interfaces in our codebase; concrete adapters (`PrivyAdapter`, `HeliusAdapter`, `PublicMainnetAdapter`, `SumsubAdapter`) implement them; business modules depend on the interface via DI, never on the adapter.

## Decision Outcome

Chosen option: **"Owned interfaces per provider category"**, because it is the only option that lets us swap a single concrete provider without touching any business module. Options 1 and 2 collapse on the first swap.

Concretely, this ADR ratifies the four interfaces created in Phase 0 of the Grid migration (task 0.1) and the principle they enforce:

- `apps/backend/src/wallet/wallet-provider.interface.ts` — `WalletProvider`, bound to `PrivyAdapter` in v1.
- `apps/backend/src/solana/solana-rpc.interface.ts` — `SolanaRpc`, bound to `FailoverSolanaRpc` (which composes `HeliusAdapter` primary + `PublicMainnetAdapter` fallback) in v1.
- `apps/backend/src/kyc/kyc-provider.interface.ts` — `KycProvider`, bound to `SumsubAdapter` in v1.
- `apps/backend/src/virtual-account/virtual-account-provider.interface.ts` — `VirtualAccountProvider`, interface only in v1 (fiat-funded virtual accounts are deferred to a follow-up spec; the interface ships now so the eventual adapter slots in cleanly).

Each provider category gets a DI symbol (`WALLET_PROVIDER`, `SOLANA_RPC`, `KYC_PROVIDER`) injected by NestJS module. Business modules (`wallet`, `auth`, `transfer`, `activity`, `kyc`) depend on the symbol, never on the adapter class.

The principle generalises beyond v1: any future external provider that touches identity, balance, signing, RPC, KYC, fiat on-ramps, or any other persistent capability MUST sit behind an owned interface before its second caller lands. The first caller may inline a thin client; the second caller forces the interface.

### Consequences

- **Good:** A vendor going dark is a single-adapter swap, not a rewrite. Provable: the spec's success criteria require that "the next engineer who reads STATE.md can implement a TurnkeyAdapter for WalletProvider without touching the wallet, transfer, activity, or kyc modules" (PROJECT.md Definition of Done).
- **Good:** No provider API key in the Expo runtime, enforced by the device only ever knowing the Privy app ID (a public identifier) and the backend URL. Every other provider key lives server-side behind these interfaces.
- **Good:** Failover composition becomes natural. `FailoverSolanaRpc` is a `SolanaRpc` that delegates to two underlying `SolanaRpc`s; consumers cannot accidentally bypass it.
- **Good:** Test seams. Each adapter is mockable per-call via a stub `WalletProvider` / `SolanaRpc` / `KycProvider`.
- **Bad:** A second layer of indirection. New engineers reading `transfer.service.ts` must hop through `SOLANA_RPC` to find the Helius call. Mitigation: the DI symbol naming is opinionated (one symbol per category) and the interface files document where the seam exists.
- **Bad:** Some provider features do not fit cleanly into a category-shaped interface — e.g. Privy's silent passkey re-auth is wallet-shaped but lives in the mobile SDK, not the backend. The backend interface stays minimal; mobile keeps Privy-specific code in one place (`apps/mobile/` Privy SDK call sites).
- **Bad:** The interfaces accumulate the union of every adapter's capabilities. If Turnkey adds server-side signing later, `WalletProvider.signTransaction` (already declared optional today) becomes mandatory for that adapter and a no-op for others. Tracked per adapter, not per interface.

## Pros and Cons of the Options

### Direct provider SDKs in business logic

- ✅ Lowest line count today.
- ❌ A vendor swap touches every module that uses the provider. Grid taught us this.
- ❌ Provider response shapes leak into business logic. The mobile codebase today reads `response.data.tos_status` (a Bridge-shaped field surfaced through Grid) directly from KYC results; this is exactly the coupling the migration is removing.

### Anti-corruption layer per provider, scoped to its single caller

- ✅ Slightly better than option 1: at least one wrapper per provider.
- ❌ No shared interface across providers in the same category. Swapping Helius for Triton requires writing a new wrapper from scratch instead of dropping in an adapter for an existing interface.
- ❌ Encourages divergence: each wrapper grows its own shape, and after a year there is no consistent provider API surface to reason about.

### Owned interfaces per provider category (chosen)

- ✅ Single boundary per category. Adapters slot in; consumers do not change.
- ✅ Failover and composition fall out for free (one `SolanaRpc` wrapping two others).
- ✅ Makes "no load-bearing provider" verifiable in code review: any new external SDK call site outside an adapter is a red flag.
- ❌ Costs one indirection layer and one interface file per category up front.

## More Information

- PROJECT.md ("Core Essence" section) for the canonical statement of the principle.
- Spec: `docs/specs/migration-already-built-features.md` §6 (interfaces) and §1, §4 (rationale, target architecture).
- Phase 0 plan: `.claude/plans/xend-grid-migration/phases/phase-0-scaffolding/PLAN.md`.
- Interface files added in Phase 0 task 0.1:
  - `apps/backend/src/wallet/wallet-provider.interface.ts`
  - `apps/backend/src/solana/solana-rpc.interface.ts`
  - `apps/backend/src/kyc/kyc-provider.interface.ts`
  - `apps/backend/src/virtual-account/virtual-account-provider.interface.ts`
- Stub adapters and modules added in Phase 0 task 0.2:
  - `apps/backend/src/wallet/privy.adapter.ts`, `wallet.module.ts`
  - `apps/backend/src/solana/helius.adapter.ts`, `public-mainnet.adapter.ts`, `failover-solana-rpc.ts`, `solana.module.ts`
  - `apps/backend/src/kyc/sumsub.adapter.ts`, `kyc.module.ts`
