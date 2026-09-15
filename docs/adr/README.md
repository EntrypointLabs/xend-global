# Architectural Decision Records

This directory contains Architectural Decision Records (ADRs) for the `xend` monorepo.

## What is an ADR?

> An Architectural Decision Record captures a single architectural decision and its rationale. Together, the collection of ADRs creates a decision log that documents the architecturally significant choices made during the project's lifetime.

ADRs answer the question **"why is the code shaped this way?"** so future contributors (and future-you) don't have to spelunk through git history or reverse-engineer intent.

## Format

We use **[MADR](https://adr.github.io/madr/) 3.0** (Markdown Any Decision Record). Every ADR has these sections:

| Section                       | Purpose                                                           |
| ----------------------------- | ----------------------------------------------------------------- |
| Status                        | `Proposed` / `Accepted` / `Deprecated` / `Superseded by ADR-NNNN` |
| Context and Problem Statement | What forced a decision? What's the constraint?                    |
| Decision Drivers              | Bullets: what mattered when choosing                              |
| Considered Options            | The alternatives we evaluated                                     |
| Decision Outcome              | Which option won, and why                                         |
| Consequences                  | Good and bad outcomes (be honest about the bad)                   |
| Pros and Cons of the Options  | (optional) Per-option scoring                                     |
| More Information              | Links to PRs, issues, plans, source files                         |

Use [`TEMPLATE.md`](./TEMPLATE.md) as the starting point.

## When to write an ADR

Write one when a decision is:

1. **Hard to reverse**: changing it later requires touching many files or coordinating with other teams.
2. **Surprising**: a future reader would ask "wait, why?"
3. **Cross-cutting**: affects more than one app/package or more than one layer.
4. **Contested**: there are reasonable alternatives that someone could later prefer.

You do **not** need an ADR for routine choices like file naming, single-feature implementation details, or library versions that follow obvious upgrade paths.

## Conventions

- **Filename:** `NNNN-kebab-case-title.md` where `NNNN` is a zero-padded four-digit sequence number (e.g. `0001-record-architectural-decisions.md`).
- **Numbering:** Sequential across the whole repo. Never renumber existing ADRs — supersede them instead.
- **Immutable history:** Once an ADR is `Accepted`, edits are limited to (a) fixing typos, (b) adding clarifying notes under a `## Update YYYY-MM-DD` heading, (c) flipping status to `Deprecated` or `Superseded`.
- **Superseding:** When a new ADR supersedes an old one, the new ADR cites the old one and the old one's status becomes `Superseded by NNNN`.
- **Linking:** Reference other ADRs with `[ADR-NNNN](./NNNN-kebab-case-title.md)`. Reference plan documents under `.claude/plans/<slug>/` for ADRs born from a planning workflow.

## Index

| #                                                                        | Title                                                                                                                               | Status                               | Domain                   |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------ |
| [0000](./0000-record-architectural-decisions.md)                         | Record architectural decisions                                                                                                      | Accepted                             | Meta                     |
| [0001](./0001-consolidate-on-nativewind-styling.md)                      | Consolidate on NativeWind 4 + CSS-variable tokens as the sole styling system                                                        | Accepted                             | Mobile / Styling         |
| [0002](./0002-darkmode-class-strategy.md)                                | `darkMode: "class"` strategy with `useColorScheme` from nativewind                                                                  | Accepted                             | Mobile / Styling         |
| [0003](./0003-semantic-token-taxonomy.md)                                | Semantic token taxonomy: HSL CSS vars, incremental minimal set                                                                      | Accepted                             | Mobile / Styling         |
| [0004](./0004-inline-style-exceptions.md)                                | Five documented inline-style exception comments                                                                                     | Accepted                             | Mobile / Styling         |
| [0005](./0005-typography-canonical-text-api.md)                          | `Typography` is the canonical text component; deprecate `ThemedText`                                                                | Accepted                             | Mobile / Components      |
| [0006](./0006-lint-enforcement-policy.md)                                | Lint enforcement: `error` in reachable, `warn` elsewhere                                                                            | Accepted                             | Mobile / Quality         |
| [0007](./0007-defer-screentheme-context-removal.md)                      | Defer `ScreenThemeContext` removal to a follow-up PR                                                                                | Accepted                             | Mobile / Components      |
| [0008](./0008-style-cleanup-dependency-policy.md)                        | Style-cleanup dependency policy: pin `tailwind-merge` to `^2.6.0`, no new deps                                                      | Accepted                             | Mobile / Dependencies    |
| [0009](./0009-visual-regression-strategy.md)                             | Visual-regression check: manual iOS + Android screenshots, no automated harness (this PR)                                           | Accepted                             | Mobile / Quality         |
| [0010](./0010-no-load-bearing-provider.md)                               | No load-bearing external provider: owned interfaces per provider category                                                           | Accepted                             | Backend / Providers      |
| [0011](./0011-expo-56-upgrade.md)                                        | Upgrade Expo SDK from 54 to 56 for Privy compatibility                                                                              | Accepted                             | Mobile / Expo            |
| [0012](./0012-pay-platform-topology.md)                                  | Pay platform topology: managed Kafka + Redis, extracted fee-payer relayer, modular core                                             | Accepted                             | Backend / Infrastructure |
| [0013](./0013-session-model.md)                                          | Merchant-scoped Sessions: opaque server-side tokens with rotation and velocity caps                                                 | Accepted                             | Backend / Security       |
| [0015](./0015-settlement-provider-layer.md)                              | Settlement provider layer: pluggable SettlementProvider, single-root attribution, refund-in-reverse                                 | Accepted                             | Backend / Pay            |
| [0016](./0016-checkout-postmessage-protocol.md)                          | Checkout result transport: versioned postMessage protocol and surface security posture                                              | Accepted                             | Frontend / Checkout      |
| [0017](./0017-webhook-contract.md)                                       | Outbound merchant webhook contract: HMAC t/v1 signing, event schema, and delivery semantics                                         | Accepted                             | Backend / Security       |
| [0018](./0018-sdk-publishing.md)                                         | Pay with Xend SDK publishing, MIT licensing, and the fulfillment-hostile result contract                                            | Accepted                             | SDK / Packaging          |
| [0019](./0019-blockradar-settlement-provider-adapter.md)                 | Blockradar as the first SettlementProvider adapter (convert-at-settlement for naira), gated on three Solana confirmations           | Accepted                             | Backend / Pay            |
| [0020](./0020-solana-sdk-coexistence.md)                                 | Two Solana toolchains: @solana/kit for new money-moving code, web3.js retained                                                      | Accepted                             | Backend / Solana         |
| [0021](./0021-web-styling.md)                                            | Web styling: Tailwind v4 CSS-first for web surfaces, NativeWind stays mobile-only                                                   | Accepted                             | Frontend / Styling       |
| [0022](./0022-internal-console-auth-boundary.md)                         | Internal tool auth boundary: server-rendered console behind a Basic Auth guard                                                      | Accepted                             | Backend / Security       |
| [0023](./0023-fx-offramp-quote.md)                                       | NGN pricing via an executable off-ramp quote behind an owned FX provider seam                                                       | Accepted                             | Backend / Pay            |
| [0024](./0024-privy-adoption.md)                                         | Privy adopted as the consumer-side signing vendor                                                                                   | Accepted, superseded in part by 0025 | Backend / Wallet         |
| [0025](./0025-account-multisig-signer-set.md)                            | The Account becomes a Squads smart account with a 2-of-3 signer set                                                                 | Accepted                             | Mobile / Wallet          |
| [0026](./0026-checkout-settles-from-the-account.md)                      | A Payment settles out of the Consumer's Account, fee-paid by the settlement authority                                               | Accepted                             | Backend / Pay            |
| [0027](./0027-email-is-an-entry-point-not-a-login-method.md)             | Email is an entry point that unlocks S3, never a login method that returns S1                                                       | Accepted                             | Mobile / Security        |
| [0028](./0028-entry-sessions-and-session-tiers.md)                       | Entry sessions: an emailed code opens a second, server-enforced session tier                                                        | Accepted                             | Backend / Security       |
| [0029](./0029-push-is-the-load-bearing-channel-for-staged-changes.md)    | Push is the load-bearing channel for a staged change; email is the durable record                                                   | Accepted                             | Backend / Security       |
| [0030](./0030-support-freeze-of-recovery-signer-release.md)              | Support can freeze the release of the recovery signer, and can do nothing else                                                      | Accepted                             | Backend / Security       |
| [0031](./0031-lost-passkey-primary-rotation.md)                          | A lost passkey is replaced by rotating S1, approved by the phone and the recovery signer                                            | Accepted                             | Mobile / Wallet          |
| [0032](./0032-daily-spending-ceiling.md)                                 | Every Account is provisioned with a US $100 daily one-signature ceiling                                                             | Accepted                             | Backend / Wallet         |
| [0033](./0033-provisioning-idempotency-and-prepared-transaction-pins.md) | Provisioning derives its step from chain state, pins prepared transactions in a shared store, one-transaction shortcut at lock zero | Accepted                             | Backend / Wallet         |

> 0014 is reserved for a conditional relayer decision (a Kora reversal, see the 0012 update) and remains an intentional gap. The next free number is 0034.

## Generating new ADR numbers

```bash
# Find the next available number
ls docs/adr/*.md | grep -oE '^docs/adr/[0-9]{4}' | sort | tail -n 1
```

Or simply increment from the largest existing number in the index above.

## Related plans

ADRs born from a structured planning workflow link to their parent plan under `.claude/plans/<slug>/`. For example, ADRs 0001-0009 originated from the `style-cleanup` plan: `.claude/plans/style-cleanup/PROJECT.md`.
