# Merchant onboarding model

**Status:** Accepted
**Author:** Pay with Xend
**Scope:** The single four-stage Merchant onboarding model, executed manually at pilot and as software later. One model, two levels of automation.

## Why one model

Merchant onboarding is specified once here so the manual pilot sequence and the future self-serve portal at merchants.xend.global execute the exact same four stages. The manual pilot runs this model at automation level zero (the `scripts/issue-merchant-key.ts` ops script); the portal runs the same stages as software over this phase's keys, payments, and webhook-delivery surfaces. There is no separate portal specification to drift from.

A guiding rule threads all four stages: KYB gates real money, never developer experience. Test-mode keys are instant and ungated; only live-mode keys wait on verification. The Merchant's integration code never changes between test and live. Only the key does.

Consumer KYC appears at no stage. Compliance attaches to the Merchant (KYB) and to the fiat boundary, never to a Consumer inside a checkout path.

## The four stages

### Stage 1 — Profile creation, instant test keys

Creating a Merchant profile immediately yields test-mode API keys with no verification gate. A new Merchant starts with `kyb_status = 'pending'`. Test keys are devnet-backed end to end, so a developer can build and test the full checkout flow before any verification exists.

### Stage 2 — Lightweight KYB

Xend performs lightweight KYB on the Merchant (business registration, beneficial ownership, sanctions screening). Xend is the verifier; the Merchant is the subject. The outcome is recorded on the Merchant record as `kyb_status` and `kyb_verified_at`. At pilot this is the ops script's `--mark-kyb-verified <merchant-id>` action, run after the off-system checks complete.

### Stage 3 — Settlement destination (via the provider layer)

Xend provisions a provider settlement ENDPOINT through Phase 4's `SettlementProvider` layer and records its reference on the Merchant's internal account (`settlement_accounts.provider_reference`). For a naira Merchant this is a Blockradar Solana child address under Xend's single master wallet plus a bank payout config (convert-at-settlement); for a USDC Merchant it is the direct-USDC destination.

Merchants have NO wallet and NO signer. There is no merchant-signing tangle: refunds run in reverse through the provider (see the refunds API), not as a merchant-signed reversal. A naira Merchant's verified Blockradar bank details are captured at this stage; the naira payout leg itself remains gated at Phase 8.

### Stage 4 — Live keys unlock

Live-mode keys issue only when both gates pass, enforced mechanically by `KeyIssuanceService` (and the ops script through the same `assertLiveKeyEligible` function): `kyb_status = 'verified'` AND a provisioned provider settlement endpoint reference is present. Checking provider-reference-complete, not a bare row, closes the window where a crash between row upsert and provider confirmation would otherwise let a live key issue against an unprovisioned endpoint.

## Pricing configuration

Each Merchant carries two independent, first-class basis-point fields, both zero at pilot:

- `flat_fee_bps` — a flat basis-point fee.
- `fx_spread_bps` — the spread booked on the naira conversion at settlement.

Both are computed and recorded at settlement. Whether both stack on one naira Payment, or the spread replaces the flat fee on the naira leg, is an open commercial call carried as configuration, not code.

## Convert-at-settlement

A naira Merchant prices in naira. Checkout pins an executable naira to USDC quote at intent creation and charges the Consumer the USDC equivalent. The USDC lands at the provider settlement endpoint, and the provider (Blockradar) converts to naira at settlement and pays the bank. The Merchant receives naira, never holds a USDC balance, and carries no FX exposure. The realized spread is the `fx_spread_bps` revenue field.

## Automation levels

- **Level zero (pilot):** `scripts/issue-merchant-key.ts` is this model run by hand. It creates the profile, stamps KYB with `--mark-kyb-verified`, and issues keys through the shared live-key gate. No portal UI ships in v1.
- **Level one (fast-follow):** merchants.xend.global executes the same four stages as software (profile and keys, Payments and Payouts views, refund approval, metrics) over the surfaces this phase builds. It is a named fast-follow, not a pilot dependency.
