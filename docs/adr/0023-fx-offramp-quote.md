# 0023: NGN pricing via an executable off-ramp quote behind an owned FX provider seam

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Pay with Xend
**Tags:** backend, pay, vendor

## Context and Problem Statement

Merchants price in naira, but Consumers pay in USDC and merchants settle without holding a USDC balance. The checkout needs a naira to USDC number that is defensible (an executable rate, not a market-data reference), pinned at intent creation so the shopper's charge does not drift, and produced through an owned seam so no single quote vendor becomes load-bearing. The actual naira conversion is performed by the settlement provider at settlement (convert-at-settlement), so the pinned quote must drive only what USDC the Consumer is charged, never the merchant's naira proceeds.

## Decision Drivers

- REQ-FX-PINNED: pin an executable quote at creation; fail loud rather than misprice on a stale rate.
- The no-load-bearing-provider rule (ADR 0010): a new vendor category (the off-ramp quote API) goes behind an owned Symbol token and interface, with a single adapter as the only vendor toucher.
- Convert-at-settlement (HANDOFF v3): the merchant receives naira, holds no USDC, and carries no FX exposure; the realized spread is revenue, not merchant cost.
- One rounding rule (PITFALLS 3.5): a single BigInt half-up function converts NGN to USDC, nowhere else.
- Never expose the rate on a shopper-visible surface (PITFALLS 6.2).

## Considered Options

1. **Convert-at-settlement via an off-ramp provider with a pinned checkout quote** — pin an executable quote at creation to size the USDC charge; the provider converts to naira at settlement.
2. **Market-data / exchange feed** — price off a public rate feed.
3. **A Xend-side spread on a held USDC balance** — the v2 model where the merchant absorbs the spread on settled USDC.
4. **Manual pilot rate** — an operator sets a fixed rate.

## Decision Outcome

Chosen option: **"Convert-at-settlement via an off-ramp provider with a pinned checkout quote"**, because it gives a defensible executable rate at checkout while keeping the merchant in naira with no USD exposure, and it isolates the vendor behind an owned seam.

`FX_QUOTE_PROVIDER` (a Symbol token) is the CHECKOUT-QUOTE source for naira to USDC only. The partner adapter is the only vendor toucher and falls back to a pilot static rate for devnet determinism. The quote is pinned at intent creation (`fx_rate`, `fx_source`, `fx_quoted_at` persisted on the intent) and drives ONLY the USDC the Consumer is charged. The ACTUAL naira conversion happens at settlement and is the settlement provider's (Blockradar convert-at-settlement), so the merchant receives naira, never holds a USDC balance, and carries no FX exposure. This SUPERSEDES the v2 "merchant absorbs the spread on a USDC balance" framing.

The FX spread at pilot is the per-Merchant config field `fx_spread_bps` only (alongside `flat_fee_bps`, both zero at pilot; whether both stack on one naira Payment is an open commercial call). `SettlementProvider.report()` returns `{ balanceRaw, providerReference }` and does NOT carry a realized spread (CONTRACTS.md); the realized naira-conversion detail (`ngnSettledMinor`, `completedAt`, `providerTxRef`) arrives later via the extended `SettlementCompletion` optionals on the naira/deferred path, not via `report()`. Refunds use the provider's live rate at refund time, never the pinned quote or a stored pair.

A cached fallback is bounded by a staleness cap; beyond it, intent creation fails loudly rather than pricing the charge on a stale or guessed rate. The checkout-charge conversion happens in one BigInt half-up function (`ngnMinorToUsdcRaw`). The shopper-visible sheet shows only NGN, never the rate.

### Consequences

- ✅ **Good:** Executable, defensible rate pinned at creation; the shopper's charge cannot drift mid-checkout.
- ✅ **Good:** The merchant stays in naira with zero FX exposure; the spread is clean per-settlement revenue.
- ✅ **Good:** The vendor is swappable behind one adapter; devnet stays deterministic via the static rate.
- ⚠️ **Bad:** FX rate-source reliability is now on the critical path of every naira Payment; an outage past the staleness cap blocks naira intent creation (by design, to avoid mispricing).
- ⚠️ **Bad:** The realized naira detail is not known at charge time; it arrives asynchronously on the deferred settlement path.

## Pros and Cons of the Options

### Convert-at-settlement via an off-ramp provider with a pinned checkout quote

- ✅ Executable rate, not a reference feed.
- ✅ Merchant holds no USDC and carries no FX exposure.
- ✅ Vendor isolated behind an owned seam.
- ❌ Adds a live dependency to naira intent creation.

### Market-data / exchange feed

- ✅ Simple to source.
- ❌ Not executable; a displayed rate you cannot transact at is a Binance-precedent exposure.

### A Xend-side spread on a held USDC balance (v2)

- ✅ Conceptually simple margin capture.
- ❌ Superseded: under convert-at-settlement merchants do not hold USDC, so there is no balance to absorb a spread on.

### Manual pilot rate

- ✅ No vendor dependency.
- ❌ Drifts from the market and is ops toil; misprices as the naira moves.

## More Information

- ADR 0010 (no load-bearing provider) for the seam shape; ADR 0015 (settlement provider layer) for convert-at-settlement.
- CONTRACTS.md: SettlementProvider.report() / SettlementCompletion shapes.
- Source: `apps/backend/src/fx/fx-quote-provider.interface.ts`, `apps/backend/src/fx/cached-fx-quote.provider.ts`, `apps/backend/src/fx/fx-math.ts`.
