# Relayer: Kora adopt-vs-build

Status: Decided
Author: Pay with Xend planning session, 2026-07-12
Scope: Phase 3 fee-payer relayer (REQ-RELAYER-ISOLATED, REQ-ANTI-DRAIN)

## Summary

Decision: **build a thin NestJS relayer** that ports Kora's validation checklist, running in the operator's existing Node stack, with Kora recorded as the documented alternative. The one deciding factor is solo-operator ops burden: a standalone audited Rust service earns its keep at scale, but at one-merchant pilot scale it adds a second runtime, a second on-call surface, and a second upgrade cadence for a co-signer whose entire job is a few hundred lines of transaction validation the operator already knows how to run in NestJS. Every abuse-control knob is expressed as one typed config object (`apps/relayer/src/relayer-config.ts`) whose fields map one-to-one onto Kora's config, so if the ops calculus flips later, adopting Kora reuses this design and swaps only the co-sign implementation. See "Decision" and "Why the build tasks are safe either way" below.

This is a written decision, not code. The provenance of the Kora facts below is the phase research (`.claude/plans/pay-with-xend/research/ARCHITECTURE.md` section 5.1 and `research/STACK.md` section 3), which verified them against the two primary sources cited under "Sources" on 2026-07-11 at HIGH confidence.

## What Kora is

Kora is the Solana Foundation's fee-payer relayer: a standalone Rust JSON-RPC server that co-signs and sponsors transaction fees so end users never need to hold SOL. It has been audited by Runtime Verification, ships a TypeScript SDK, and supports pluggable signer backends including raw key, Turnkey, Privy, and Vault. It is the canonical reference implementation for gasless Solana payments, and its validation checklist is the checklist regardless of whether Xend adopts it or builds its own: program allowlist, token and mint restriction, `max_allowed_lamports` fee caps, per-account spend caps, global and per-account rate limits, disallowed-account lists, a fee-payer policy that governs which instruction shapes the sponsor will co-sign, and priority-fee estimation with a configurable margin. Xend's relayer, built or adopted, enforces the same set.

## Exit criteria

Each criterion is scored with a confidence level and the rationale for that level. These are the load-bearing part of this decision: the criteria, not the conclusion, are what a reader should re-run if the pilot assumptions change.

### 1. Solo-operator ops burden (primary swing factor)

Score: **favors build (thin NestJS).** Confidence: **HIGH.**

Running, upgrading, monitoring, and being on-call for a standalone Rust service is a genuinely different operational class from a NestJS service the operator already runs (`apps/backend`). Adopting Kora adds a second language runtime, a second container image and release cadence, a second set of health and metrics wiring, and a second thing to wake up for at 3am, all for a co-signer whose logic surface is small and well understood. A thin NestJS relayer lives in the same monorepo, the same turbo pipeline, the same Joi-env and structured-logging conventions, and the same deploy story the operator already has. At one-merchant pilot scale with one person on-call, this is decisive. Confidence is HIGH because it rests on the operator's own stack, not on unverified vendor behavior.

### 2. Validation coverage

Score: **favors build; Kora needs a shim either way.** Confidence: **HIGH** that a shim is required, **MEDIUM** on the exact shim surface.

Kora's static config validates transaction structure, but three of Xend's needs are dynamic and per-request, which Kora's TOML cannot express on its own:

- **Byte-pinned message equality.** The strongest anti-drain guarantee is that the relayer co-signs only a message the platform itself compiled and pinned (see PITFALLS.md 4.2). Kora validates that a transaction looks like an allowed shape; it does not validate that the transaction byte-equals a specific message our backend pinned for this intent. A shim in front of Kora would have to hold the pinned message and reject on any divergence before Kora is invoked.
- **Destination equals a per-request expected settlement account.** The USDC `TransferChecked` destination must equal the settlement account supplied for this specific request (in v3, a Blockradar child token account resolved per merchant), not a member of a static allowlist. Kora's disallowed-account and allowlist config is static; a per-request expected destination is dynamic input.
- **Per-Consumer and per-merchant caps keyed on domain identifiers.** These caps require `consumerId` and `merchantId` passed at call time. Kora's per-account rate limits key on chain accounts, not on Xend domain identities, so the domain-scoped caps have to live in the shim (they are also enforced upstream in the Identity and Capability API; the relayer's own are defense-in-depth).

Where Kora is fully sufficient: the program allowlist, the USDC mint restriction, the `max_allowed_lamports` and compute-price ceilings, and the fee-payer-not-writable policy. These map cleanly onto Kora config. The gap is the dynamic, domain-aware half, which under an adopt-Kora outcome becomes "stand up Kora plus a thin internal-auth and pinned-message and expected-destination and domain-caps shim." A thin NestJS relayer folds that shim and the static checks into one small in-process codebase.

### 3. Latency

Score: **favors build, marginally.** Confidence: **MEDIUM.**

The PROJECT.md budget is approval-to-result under 5s p95, which includes Solana confirmation. Kora as an adopted service sits behind the required pinned-message shim, so the request path is caller to shim to Kora to RPC, one extra network hop versus the thin-NestJS in-process path of caller to relayer to RPC. At pilot volumes both comfortably fit the budget; the co-sign and broadcast are dominated by RPC round trips and on-chain confirmation, not by the co-signer's own compute. The marginal edge goes to build (one fewer hop, no cross-process serialization of the pinned message), but this is not the deciding factor. Confidence is MEDIUM because it is a structural argument, not a measured p95 on this exact deployment.

### 4. Signer backend fit

Score: **favors adopt, but not enough to swing it.** Confidence: **HIGH.**

Kora has native Turnkey, Privy, Vault, and KMS signer backends; a thin NestJS relayer must define its own signer seam. This is a real point in Kora's favor and dovetails with the wallet-vendor work. It is mitigated cheaply: the built relayer exposes a `FeePayerSigner` interface (Symbol DI token plus adapter, the repo's institutionalized anti-lock-in pattern) with an env-key implementation at the pilot floor, so dropping in a Turnkey or KMS signer later is a single module change and does not touch co-sign code. The seam captures most of Kora's signer-backend value without adopting the Rust service. Confidence is HIGH because both the Kora backends and the seam pattern are documented and proven.

### 5. Key custody

Score: **tie; both satisfy REQ-RELAYER-ISOLATED.** Confidence: **HIGH.**

Both options keep the fee-payer key out of `apps/backend`: Kora runs as its own service with its own signer config, and the thin NestJS relayer is its own deployable with its own env schema and its own secret store. The order of custody preference is identical either way: a Turnkey or KMS-backed signer first, a cloud-KMS-wrapped key in the relayer's own store next, and a raw `RELAYER_FEE_PAYER_SECRET_KEY` env var as the pilot floor. Neither option requires the key to touch the backend. This criterion does not discriminate.

## Decision

**Build a thin NestJS relayer** (Kora's validation checklist, ported and enforced in-process on the operator's existing Node stack), with Kora named as the documented alternative for the day scale or signer-custody needs justify the Rust ops burden.

Deciding factor, one sentence: at one-merchant pilot scale with a single operator, the standalone-Rust-service ops burden (criterion 1) is not justified for a co-signer whose validation surface is small and whose dynamic, domain-aware checks (criterion 2) would require a NestJS shim in front of Kora anyway.

If a future evaluation instead favors adopting Kora (for example, a signer-pool need at scale, or Kora's native remote-signer backends becoming a hard requirement), that reverses the assumed thin-NestJS relayer recorded in ADR 0012, and a new ADR (ADR 0014, since 0013 is claimed by Phase 2's session model) must record the reversal. Under that outcome, tasks 3.2a, 3.2b, and 3.3 become "stand up Kora plus a thin internal-auth and pinned-message and expected-destination and domain-caps shim," reusing the same `RelayerConfig` object and the same caps design described below.

## Why the build tasks are safe either way

The allowlist, caps, and fee-ceiling design in tasks 3.2a through 3.3 is expressed as one typed config object, `apps/relayer/src/relayer-config.ts` (`RelayerConfig`), whose fields map one-to-one onto Kora's config. That mapping is the insurance that this phase's build work transfers to Kora with no redesign:

| `RelayerConfig` field                                      | Kora config equivalent                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| `programAllowlist`                                         | program allowlist                                               |
| `usdcMint`                                                 | token / mint restriction                                        |
| `maxFeeLamportsPerTx`                                      | `max_allowed_lamports` fee cap                                  |
| `maxComputeUnitPrice`, `maxComputeUnits`                   | fee-payer policy compute ceilings / priority-fee margin ceiling |
| `perConsumerPaymentsPerHour`, `perMerchantPaymentsPerHour` | per-account rate limits                                         |
| `perConsumerFeeLamportsPerDay`, `globalFeeLamportsPerDay`  | per-account and global spend caps                               |
| `feePayerAddress` (never a writable non-fee account)       | fee-payer policy                                                |
| `minFeePayerBalanceLamports`                               | operational monitoring threshold (alerting, not a Kora knob)    |

Because these are one object assembled once at boot from env, an adopt-Kora outcome moves the static fields into Kora's TOML and keeps only the pinned-message, expected-destination, and domain-caps shim, which is exactly the NestJS surface built here. The co-sign implementation is the only thing that would be swapped; the design survives.

## Sources

- Kora relayer (Solana Foundation, architecture, validation config, signer backends, audit): https://github.com/solana-foundation/kora
- Kora guide (config knobs: program allowlist, token/mint restriction, `max_allowed_lamports`, per-account spend caps, rate limits, fee-payer policy, priority-fee margin, signer backends): https://www.quicknode.com/guides/solana-development/transactions/kora
- Phase research grounding these facts (verified against the two sources above on 2026-07-11): `.claude/plans/pay-with-xend/research/ARCHITECTURE.md` section 5.1, `research/STACK.md` section 3, `research/PITFALLS.md` section 4.2.
- Platform topology and the assumed thin-NestJS relayer this decision confirms: `docs/adr/0012-pay-platform-topology.md`.
