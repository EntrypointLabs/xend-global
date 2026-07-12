# Privy configuration verification (Phase 5)

Status: Verified
Author: Pay with Xend build
Scope: Phase 5 Privy configuration verification: custom RP ID on the registrable root xend.global, session-signer flow on a Xend-hosted domain, and key exportability. Records the confirmed configuration that the checkout ceremony (task 5.3b) builds against.

## Why this exists

Privy is the adopted consumer-side signing vendor (ADR 0024): the earlier Squads Grid work was ported to it and the vendor race is closed. This is therefore a configuration verification with a written outcome, not a pass/fail gate with a fallback. There is no Turnkey or Crossmint contingency in scope and no re-enrollment plan. Privy is reached only through the `WALLET_PROVIDER` adapter (`apps/backend/src/wallet/wallet-provider.interface.ts:16`); nothing here selects or swaps a vendor.

The whole cross-subdomain Checkout hinges on one fact: that Privy can be configured with a custom RP ID of the registrable root xend.global, so passkeys enrolled by the mobile app (`apps/mobile/hooks/usePasskey.ts:42`, `relyingParty: "https://xend.global"`) are usable on pay.xend.global.

## Verification items

Doc-level items (a) to (d) were confirmed against Privy's current documentation (docs.privy.io, 2026-07-12). The on-device latency and consent-UX items (e), and the on-real-TLS round trips for (b) and (c), are the human device matrix and are tracked as pending under "Device matrix results" below (this run gates on automated checks; the real device matrix is the human gate).

### (a) Custom RP ID on the registrable root

- **Result: Confirmed.** Privy accepts a developer-supplied `relyingParty` parameter on both the web SDK (`@privy-io/react-auth`) and the mobile enrollment path (`@privy-io/expo`). Setting `relyingParty: "https://xend.global"` makes Privy derive the WebAuthn rp.id from the registrable root xend.global (not a subdomain, not a Privy-owned domain). A passkey enrolled by the app under that rp.id resolves on pay.xend.global by same eTLD+1 WebAuthn scoping. Related Origins is not required and is not on the assertion path, so no `/.well-known/webauthn` lookup sits on the hot path. This matches the constant already shipped at `apps/mobile/hooks/usePasskey.ts:42`.
- Highest-priority confirmation; the cross-subdomain Checkout depends on it.

### (b) Web assertion on pay.xend.global

- **Result: Confirmed at the configuration level.** `@privy-io/react-auth` `loginWithPasskey` accepts the same explicit `relyingParty` value, so a page served at pay.xend.global calling `loginWithPasskey({ relyingParty: "https://xend.global" })` presents an assertion whose rp.id resolves to xend.global against the credential enrolled via the mobile path. The end-to-end assertion against a real credential on real TLS is a device-matrix item (below).

### (c) Session signer (offline server-side signing)

- **Result: Confirmed.** Privy supports Solana `signTransaction` and `signAndSendTransaction` through its server SDK / REST surface. A session signer granted once (a single consent grant) lets the backend sign later transactions offline, with the popup closed and the Consumer offline, and with no per-action prompt. Signing is server-side and therefore independent of the checkout domain. This is what makes the one-tap repeat path work within a recognized Session. The devnet USDC round trip on real infrastructure is a device-matrix item (below).

### (d) Key exportability

- **Result: Confirmed.** Privy exports the raw Solana private key client-side. Seed-phrase export is not supported; private-key export is. This keeps the adapter seam's exit path real.

### (e) Latency and consent UX

- **Result: Pending (human device matrix, task 5.5 / PROGRESS Flag #12).** Popup-interactive p95 with the Privy SDK included, on a throttled 4G profile on a mid-range Android phone, and the consent-UX screenshots for brand review, are measured on-device by a human. Mitigation already built into the surface: the Privy web SDK is code-split into the single ceremony module and lazy-imported off the first-paint path, so the LoadingShell first paint does not pay the vendor cost, and the challenge is prefetched so `loginWithPasskey` runs inside the click handler stack.

## Outcome

The confirmed Privy configuration that task 5.3b builds against: set `relyingParty: "https://xend.global"` explicitly on every credential ceremony call (web `loginWithPasskey` and the mobile enrollment path alike), so the WebAuthn rp.id resolves to the registrable root xend.global and app-enrolled passkeys work on pay.xend.global by same eTLD+1 scoping, with Related Origins not required. Session signers provide offline server-side Solana signing within a one-time consent grant (no per-action prompt), which backs the one-tap repeat path, and the raw Solana private key is exportable client-side.

Doc gaps and caveats carried to the ceremony task and to the mainnet gate:

- The exact Solana policy-engine granularity (program / instruction allowlists) is not fully pinned in the docs. This is routed around by design: policy and tier limits are first-class in the Identity and Capability API, not the wallet layer, and gas is handled by the Xend relayer regardless.
- Smart wallets and batching are EVM-only and unused here.
- On-device latency, the real-credential web assertion, and the live session-signer round trip on real TLS are the human device matrix (task 5.5), not part of this automated run.

Sources: docs.privy.io passkey, allowed-domains, session-signer, and Solana key-export pages (reviewed 2026-07-12); repo `apps/mobile/hooks/usePasskey.ts:42`.

## Device matrix results

**Status: Pending (human gate, task 5.5 / PROGRESS Flag #12).** Per this run's rule (automated gate only, no reviewer or browser agents), the real device matrix is a human gate and is not run by an agent. To be measured and recorded here by a human before mainnet go-live, against live Privy and the Phase 6 endpoints:

- Android mid-range on 4G: popup interactive under 1s p95 (target budget), first payment completed with one explicit passkey tap.
- Repeat payment is one confirm tap on a recognized Session; a revoked Session forces the full ceremony again.
- iOS Safari: tap-triggered ceremony works, no auto-fire, no rate-limit lockout.
- Cancel affordance delivers a canceled result; an expired intent link shows the terminal state.
- A COOP-hostile merchant page (Cross-Origin-Opener-Policy: same-origin) launched in redirect mode completes via the signed return URL without hanging.
- Measured p95 numbers, device and browser matrix, screenshots, and a pass or fail per criterion.
