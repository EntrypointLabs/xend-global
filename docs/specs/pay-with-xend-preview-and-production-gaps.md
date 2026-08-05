# Pay with Xend — preview findings & production gaps

Status: Living log
Scope: Everything we hit while running the checkout locally and driving a **real** Privy passkey on devnet. Each item records what happened, the current state (fixed / worked-around / open), and the production fix owed. Complements the `PROGRESS.md` "Flags for human decision" (#1-#16); this is the hands-on-testing companion.

> TL;DR: the payment tech is proven end-to-end; the open items are (1) an app-owned identity/onboarding model, (2) deploying the checkout at a Privy-registered domain, (3) a few fragile SDK build patches, and (4) funded settlement + consumer provisioning on the backend.

---

## 1. Identity & onboarding — DECISION (highest priority)

**The checkout must authenticate existing Xend identities, never create them.**

- Calling Privy `signupWithPasskey` from the checkout mints a **brand-new identity with only a passkey and no email**, orphaned from the person's real account. When they later open the Xend app and sign up with email, they get a _second_ identity — and their checkout payment lives on the first one, invisible in the app. That is a data/UX mess.
- **Model:** identity (email + passkey) is created **once, in the mobile Xend app**. The checkout only runs `loginWithPasskey` to authenticate an existing consumer. One identity per person.
- **DECIDED: the consumer app stays mobile-only. No desktop app.** A payment method must work wherever commerce happens (incl. desktop), but that is solved by **passkeys**, not a desktop app: (1) **synced passkeys** (iCloud Keychain / Google Password Manager) let a desktop shopper authenticate natively with Face ID on their own machine; (2) **cross-device / QR-to-phone hybrid** (Apple-Pay-web / WhatsApp-Web pattern) covers any other desktop. The phone stays the source of truth. The only genuine gap is a **brand-new user on desktop with no app** — handled by "get the app" or, if conversion data later warrants, a **minimal hosted signup page** (not an app). Do NOT build a desktop consumer app.

**ACTIONS**

- [ ] Remove or dev-gate the "First time? Create a passkey" button in `apps/checkout/src/screens/Ceremony.tsx` (it is a **test-only** affordance added to validate the chain on devnet).
- [ ] Checkout supports **synced passkey + QR-to-phone cross-device** auth for desktop shoppers.
- [ ] Decide the new-user-on-desktop path ("get the app" vs a minimal hosted signup) from conversion data — not day one.

---

## 2. Privy is domain-bound — a real passkey needs a Privy-registered domain over TLS

`localhost` **cannot** run the real ceremony. Four separate Privy/WebAuthn layers each require a `xend.global` origin on the standard port:

| Layer                                  | Symptom on the wrong origin                                     | Requirement                                                         |
| -------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------- |
| Cloudflare Turnstile (Privy bot-check) | `Error: 600010` retry loop forever                              | hostname must be a Privy-trusted `xend.global` domain               |
| WebAuthn `rp.id` (`xend.global`)       | passkey rejected / not offered                                  | origin must be an eTLD+1 match of `xend.global`                     |
| Privy `frame-ancestors` CSP            | `Framing 'https://auth.privy.io/' violates ... frame-ancestors` | embedding origin must be a **registered** domain, **no port** (443) |
| Privy passkey-origin check             | `POST /passkeys/authenticate/init 403`                          | origin must be registered for the app                               |

- The frame-ancestors allowlist we observed was `'self' https://xend.global https://www.xend.global https://auth.privy.io` — **production domains only**, no `pay.xend.global`, no ports.
- Automated browsers (our verifier agents) always trip Turnstile by design, so **only a real human browser can validate the ceremony** — this is `PROGRESS.md` Flag #12, the device-matrix human gate.

**ACTIONS**

- [ ] Deploy the checkout at the real **`pay.xend.global`** with real TLS, and register `https://pay.xend.global` in Privy's allowed origins/domains (this is what drives frame-ancestors + Turnstile + passkey-origin). Confirm the ceremony there.
- [ ] Note: Privy's domain model is **port-less** (443). Never rely on a non-443 port for a Privy-facing origin.

**Local test hack used (dev-only, reversible — NOT a production artifact):** served the checkout at **`www.xend.global:443`** (already in Privy's allowlist) via an `/etc/hosts` entry + an mkcert-trusted cert + running vite with sudo on 443. Undo: remove the `/etc/hosts` line, drop `apps/checkout/certs/`, revert `apps/checkout/vite.config.ts`.

---

## 3. Privy SDK build issues (fixed, but fragile)

- **`@solana/kit` skew (`PROGRESS.md` Flag #12).** Privy transitively pulls `@solana-program/token@0.14`, which imports `getMinimumBalanceForRentExemption` from `@solana/kit` — but kit 7 dropped that export, so the module fails to load and the real ceremony never bundles. **Fixed** with a patch-package shim: `patches/@solana+kit+7.0.0.patch` (re-adds the pure rent computation). **Fragile** — re-verify on any Privy/`@solana/kit` version bump.
- **Duplicate React → "Invalid hook call" → blank crash.** Privy's dep graph resolved a second React copy. **Fixed** with `resolve.dedupe: ['react','react-dom']` in `apps/checkout/vite.config.ts`.
- **`App configuration has Solana wallet login enabled, but no Solana wallet connectors have been passed to Privy`.** The checkout's `PrivyProvider` gets only `appId`, no `config`. Privy then tries to provision a Solana embedded wallet the checkout does not need. **Open** — pass an explicit Privy `config` (embedded-wallets / Solana connectors, or disable wallet provisioning for the ceremony path) so the console is clean and nothing hangs.

---

## 4. Backend gaps for a real end-to-end payment (devnet)

The passkey ceremony now issues a real token that reaches `/checkout/authorize`. From there, `resolveByProviderToken` (identity.service) runs this chain, and each link is a gap for a fresh consumer:

- **Token type mismatch (FIXED in checkout).** The backend verifies the Privy **identity** token (`client.getUser({ idToken })`), but the checkout was sending `getAccessToken()` (the _access_ token) -> `INVALID_PRIVY_TOKEN` / 500. Fixed: `apps/checkout/src/ceremony/passkey.ts` now sends `useIdentityToken().identityToken`. **Requires "identity tokens" enabled on the Privy app** (dashboard) or the token is null.
- **No embedded wallet.** The checkout's `PrivyProvider` gets only `appId`, so a passkey signup creates a user with **no Solana wallet / address**. Consumers need a wallet for a settlement destination. **Open** — configure Privy embedded-wallet creation (`embeddedWallets`), or rely on the app to create it.
- **Consumer must have a linked email (CONFIRMED by the live test).** After the token verifies, `userToProviderUser` throws `PrivyUserShapeError: ... has no linked email; email login required` (`PRIVY_USER_SHAPE_INVALID`). A **passkey-only** identity (what the checkout `signupWithPasskey` mints) is **not a valid consumer** — the Xend model is email + passkey. This is the backend enforcing §1: **onboarding (email + passkey + wallet) is app-owned; the checkout only authenticates a fully-onboarded consumer.** The live devnet test walked straight into this, which validates the decision.
- **No consumer account (`smart_accounts`).** Even with an email, `resolveByProviderToken` requires a `smart_accounts` row linking the Privy `providerUserId` -> a `users` row + address, created by the app's **`/auth/exchange`** onboarding, not the checkout. A checkout-only person has none -> `UnknownConsumerError: no Account for provider user`. **Open** — for tests, run `/auth/exchange` (or seed the account) for the identity first; in production the app owns this.
- **Capacity / tier.** After the account resolves, the payment is checked against the consumer's tier caps. A fresh consumer needs a tier assigned.
- **Settlement is not funded (`PROGRESS.md` Flag #11).** Even past all the above, the real `authorize` waits for on-chain settlement; with no funded `SETTLEMENT_AUTHORITY` + relayer fee-payer it times out to `PAYMENT_PROCESSING`. **Open** — fund devnet keys (Circle faucet) for a true settle, or add a test-mode short-circuit so authorize resolves `succeeded` after the passkey without real settlement.
- **`return_url` must be https** (SSRF guard) — http localhost return URLs are rejected. Fine, just a testing gotcha.

---

## 5. Checkout / SDK architecture

- **Glass modal vs. iframe (locked UX + its constraint).** The frosted-glass-over-merchant look must render in the merchant DOM (a Shadow-DOM overlay); a cross-origin iframe is opaque and cannot blur the page. The **passkey ceremony must run in an isolated iframe on the checkout origin** (rp.id + credential isolation). So the production shape is: **glass confirm in-page (SDK) + ceremony in a checkout-origin iframe**. Tamper-proof amount display + credential isolation are the **mainnet-hardening** items.
- **SDK modal still simulates authorize.** `packages/checkout-core` modal mode uses `devSimulateAuthorize` for the pilot. **Open** — wire the real ceremony iframe + real authorize into the modal (task #36).
- **Dev conveniences to keep in mind:** the SDK's `http://localhost` origin carve-out (committed, legitimate); the local `merchant-demo.html` embeds a **test API key client-side** — local only, never production (there `createIntent` runs on the merchant's server).

---

## 6. Merchant onboarding surface

- The **merchant dashboard** we built (`/test-dashboard`) is **dev-gated and test-only** (mints test keys without auth when `NODE_ENV=development`). Production needs the real self-serve `merchants.xend.global` portal with proper merchant auth + KYB — a deferred fast-follow, not v1 (ADR 0022 / Phase 8 scope).

---

## What IS proven (so we do not re-litigate it)

- The `@xend/checkout-core` SDK, the adaptive translucent glass modal (desktop + mobile), and the merchant round-trip (`onResult`).
- The backend API: intent creation, **FX pinned at creation** (naira shown, no FX at the sheet), the public checkout summary, the ops console, the relayer anti-drain (live 403), and the Phase-6 webhook/idempotency E2E.
- The real Privy ceremony **renders and reaches a genuine WebAuthn passkey prompt** on a Privy-registered domain over TLS — the piece everyone flagged as the human gate.
