# B4 — Real on-chain devnet settlement: implementation plan

Status: Proposal for review (uncommitted)
Goal: one real devnet USDC payment, end to end, through the co-signed transfer
ceremony — no dev short-circuit. Complements `pay-with-xend-preview-and-production-gaps.md`.

> Headline from the settlement audit: the real settlement ceremony
> (`SettlementService.buildSettlement` / `submitSettlement`) is fully built and
> unit-tested but has **zero production callers**. The dev short-circuit is the
> only thing currently driving a payment to `succeeded`. B4 is therefore a
> **build** (wire the ceremony) plus **funding/config**, not just a deletion.

---

## 1. How real settlement works (fixed constraints)

A co-signed SPL `TransferChecked`, 6-decimal USDC, exactly two signers:

- **Source + authority** = the consumer's embedded Solana wallet. **The consumer
  signs client-side** — the backend deliberately refuses (`PrivyAdapter.signTransaction`
  is `NotImplemented`).
- **Fee payer + co-signer** = the relayer (`RELAYER_FEE_PAYER_*`), which pays SOL
  gas, validates + simulates, signs last, and broadcasts. It is the only broadcaster.
- **Destination** = the merchant's provisioned settlement token account (authority-owned).
- The settlement **authority** key is NOT on the payment hot path (provisioning + refunds only).

```
authorize ─▶ backend builds unsigned TransferChecked (pins message on the attempt)
          ─▶ CLIENT signs with the Privy embedded Solana wallet        ← the new piece
          ─▶ backend submit ─▶ relayer co-signs + pays gas + broadcasts
          ─▶ confirm poll (8s budget) ─▶ succeeded ─▶ payment.succeeded
```

## 2. Target request shape

Split today's single `POST /checkout/authorize` (which auth's + dev-settles) into
**authorize+build** and **submit**, with the client signing in between:

1. `POST /checkout/authorize { reference, providerToken? }`
   → resolve consumer, real capacity+balance check, `created→authorized`, insert
   attempt, **`buildSettlement`** (pins message) →
   returns `{ status: "awaiting_signature", unsignedTransaction, expiresAt }` + session cookie.
2. **[client]** deserialize `unsignedTransaction` → `useSignTransaction().signTransaction({ transaction, wallet })`
   with the embedded wallet from `useWallets()` → `signedTransaction`.
3. `POST /checkout/submit { reference, signedTransaction }` (session-cookie auth)
   → **`submitSettlement`** (byte-match the pinned message → relayer cosign → broadcast → `settling`)
   → `awaitConfirmation` → `pollUntilTerminal` → returns terminal status + signed return URL.

One-tap (returning session) still runs build+sign+submit — every payment needs a
fresh, unique signature; the session only skips the passkey re-prompt.

## 3. Backend changes

- `checkout/checkout.controller.ts`
  - `authorize()`: drop the dev short-circuit; after the authorized attempt, call
    `settlement.buildSettlement(reference)`; return the unsigned tx (base64) as
    `awaiting_signature` instead of polling to terminal.
  - add `submit()` (`@Post('submit')`): session-authenticated; `settlement.submitSettlement(reference, signedTx)`;
    then `pollUntilTerminal` → terminal + return URL.
  - swap the injected `SettlementConfirmationService` (dev-only) for `SettlementService`.
- `checkout/checkout.module.ts`: import the settlement providers the real path needs
  (ensure `SettlementService` is exported from `SettlementModule`).
- `capability/capacity.service.ts`: remove `devSkipBalance` — the **real live-USDC
  balance gate must apply**, else we authorize an unfunded transfer that fails on-chain.
- `capability/identity.service.ts`: remove `devProvisionConsumer` (real consumer must
  map to a real embedded wallet, provisioned by mobile onboarding — B1).
- `wallet/privy.adapter.ts`: remove `DEV_PLACEHOLDER_SOLANA_ADDRESS` + the dev
  email/wallet fallbacks (placeholder holds no USDC and can't sign). `signTransaction`
  stays a stub (consumer signs client-side).
- One-time ops: provision the merchant settlement token account
  (`SettlementProvisioningService.provisionOrLink`, authority-signed) so
  `getSettlementAddressForSettlement` returns a destination. Small script/endpoint.
- Config (verified locally 2026-07-27, no change needed): the relayer's `.env` sets
  `PORT=8080`, the backend's `RELAYER_URL=http://localhost:8080`, and
  `RELAYER_FEE_PAYER_ADDRESS` already equals the relayer's live signer
  (`GVnNLrPYcQtbiafn7fX2yQSyJmDuhpZJeMNi57vcZSsF`) — so URL + co-signer align. The
  earlier "`:8080`→`:8787`" note was a wrong port assumption; drop it.
- RPC key is dead: the relayer's Helius devnet RPC returns **401 Unauthorized**
  (`relayer.rpc.getBalance primary failed ... HTTP 401`), so it falls back to public
  devnet RPC. Replace `HELIUS_RPC_URL` with a live devnet key before B4 — on-chain
  reads/confirmation on the public endpoint are rate-limited and flaky for settlement.
- Fee payer is unfunded (`relayer.balance.alert level=low balance_lamports=0`); fund
  `GVnNLr…` with devnet SOL (see the funding table in §6).

## 4. Checkout client changes

- `checkout/src/lib/api.ts`: `authorize()` now returns `{ status, unsignedTransaction, ... }`;
  add `submit(reference, signedTransaction)`.
- PrivyProvider config: add the Solana embedded-wallet config so `useWallets()` (from
  `@privy-io/react-auth/solana`) surfaces the consumer's wallet and signing works
  (closes gaps-doc §3 "no Solana connectors passed").
- Signing step: after `authorize` returns the unsigned tx, get the embedded wallet
  from `useWallets()`, sign via `useSignTransaction()`, POST `submit`, then show result.
  Prefer headless signing (`uiOptions`) so no extra Privy modal interrupts the
  Apple-Pay-style flow.
- This signing UI is where **B4 meets B5**: for B4 we can wire it into the existing
  `Ceremony` screen; B5 later moves the whole ceremony into the glass-modal iframe.

## 5. Spike FIRST (de-risk the architecture) 🚩

**Before any wiring, verify a mobile-created embedded Solana wallet is accessible and
signable on web** via `@privy-io/react-auth/solana` `useWallets()` + `useSignTransaction()`
after passkey auth, for the same Privy app.

- If **yes** → the web-signs-directly design above stands.
- If **no** (embedded wallet not reachable cross-client) → we must sign **on the phone**
  (cross-device / QR-to-phone), which is a much larger build (B3 scope). This single
  answer decides B4's whole shape, so it is worth a 30-minute spike against a real
  onboarded consumer.

## 6. Funding + run + human gates

| Account                                                   | SOL                | USDC                             | Why                                   |
| --------------------------------------------------------- | ------------------ | -------------------------------- | ------------------------------------- |
| Relayer fee payer (`RELAYER_FEE_PAYER_*`)                 | **Yes**, keep ≥0.1 | No                               | pays gas, co-signs, broadcasts        |
| Consumer embedded wallet (`smart_accounts.walletAddress`) | No                 | **Yes** ≥ amount, ATA must exist | transfer source + authority           |
| Settlement authority (`SETTLEMENT_AUTHORITY_SECRET_KEY`)  | **Yes**, small     | No                               | provisions merchant account + refunds |
| Merchant settlement account (destination)                 | No                 | receives                         | must be provisioned first             |

- Devnet USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (must match backend + relayer).
- Human-only: generate the two keypairs; SOL faucet → fee payer + authority; Circle
  devnet USDC faucet → consumer wallet; a real Privy identity with an embedded Solana
  wallet (B1). Run: relayer + Postgres + Redis + Kafka; `NODE_ENV` ≠ `development`.

## 7. Build order (once the spike is green)

1. Spike: web-sign a mobile embedded wallet (§5).
2. Provision merchant settlement account (one-time) + fund keys.
3. Backend: authorize+build / submit endpoints; remove dev scaffold + balance bypass; config fix.
4. Checkout: Privy Solana config; authorize→sign→submit flow in the Ceremony screen.
5. End-to-end real devnet payment; confirm `payment.succeeded` fires from the real path.
6. (B5) move the ceremony into the glass-modal iframe.

## Open questions for you

- **A.** Signing UX: is a brief Privy signing confirmation acceptable, or must it be
  fully headless (Apple-Pay-silent)?
- **B.** Do we wire B4's signing into the current `Ceremony` screen first (simplest), or
  jump straight to the B5 glass-modal iframe?
- **C.** Merchant provisioning: a one-off script now, or a small authority-signed admin
  endpoint we keep?
