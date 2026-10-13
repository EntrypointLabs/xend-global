# Xend to Prydd: Step 1 findings

Written 2026-10-11 against `main` at `0c39b9f`, in response to Step 1 of `REBRAND.md`. Nothing has been renamed yet. This file is the audit: what has to change, what would be good to change, what must not be touched without a migration, and what to borrow from the three design references (Wise, Fuse, Plasma One).

Paths are relative to the repo root. Counts come from `git grep -i xend` (1,241 matches in 288 tracked files).

## 1. The short version

1. **The rename is the small part.** About 110 user-visible strings, 5 logo files, 10 icon and store images and roughly 20 living docs carry the name. That is a few days of mechanical work once the naming decisions in section 9 are made.
2. **The repositioning is the large part.** Prydd is described as a neobank with a naira account, fiat-funded crypto purchase and cards. On `main` today none of those three exist in the app: no fiat account, no on-ramp, no card. The current brand documents also forbid the positioning in writing ("Not another crypto neobank", `docs/xend-master-context.md:62`) and ban the words the new brief uses ("wallet", "deposit", "top up", "add cash").
3. **Nine identifiers must not be find-and-replaced.** Renaming them strands device keys, passkeys or merchant integrations. They are listed in section 4. The safe default is to leave them as they are and rename only what users and developers can see.
4. **Mobbin does not carry Plasma One.** Every "Plasma One" query resolves to "One", the Walmart-backed US fintech, and an exact-name flow search returns nothing. The Plasma One notes in section 7 come from its App Store listing, plasma.org and Privy's case study instead. Wise is on Mobbin and was researched there. Fuse is covered by the 11 screenshots already in `docs/design/references/fuse/`.

## 2. Where the name lives

| Area                          | Matches   | Files | What it mostly is                                                |
| ----------------------------- | --------- | ----- | ---------------------------------------------------------------- |
| `apps/backend`                | 203       | 79    | Email and push copy, `@xend/*` imports, metrics, a few constants |
| `packages/checkout-core`      | 179       | 22    | Public SDK symbols, CSS prefix, button label, tests              |
| `apps/mobile`                 | 126       | 55    | UI copy, app identity, key aliases, logo paths                   |
| `docs/specs`                  | 125       | 17    | Specs, four with the name in the filename                        |
| `docs/adr`                    | 113       | 27    | Accepted decision records                                        |
| `apps/checkout`               | 86        | 26    | Wordmark, copy, session keys, dev hosts                          |
| `docs/xend-master-context.md` | 47        | 1     | The brand briefing itself                                        |
| `packages/checkout-react`     | 42        | 6     | `XendPayButton` and its README                                   |
| `packages/checkout-protocol`  | 38        | 7     | postMessage envelope and types                                   |
| `apps/merchant`               | 30        | 17    | Portal copy, wordmark, pilot harness                             |
| Everything else               | about 130 | 31    | Root config, scripts, CI, lockfile                               |

Two other names survive in the repo and are worth clearing in the same pass:

- **`giftedborg`** is the reverse-DNS prefix of the bundle id, the native module package and the hardware key alias (16 hits). A rename that only touches "xend" still ships `com.giftedborg.*`.
- **`fuse`** is the local Postgres database name (`docker-compose.yml:96,105,109`, `apps/backend/.env.example:12`, `README.md:92`) and ADR 0000 still calls the repo `fuse-android`.

## 3. Rename freely

These change together with their references and have no effect outside the repo.

**App shell and copy**

- Display name `apps/mobile/app.json:3`, Face ID string `:92`, "Unlock Xend" (`contexts/AppLockContext.tsx:123`), the four biometric prompts in `modules/hardware-key/src/index.ts:99-117`.
- About 40 strings across onboarding, home, settings, modals and feature previews in `apps/mobile`.
- Checkout: `<title>`, wordmark text (`PaymentSheet.tsx:18`, `StatusSheet.tsx:9`), "Open Xend", "Add Cash in the Xend app".
- Merchant portal: title, entry screen, wordmark, webhook help text.
- Backend: 10 email subjects and their bodies plus 9 push bodies in `src/notifications/security-notice.service.ts`, five OTP emails in `src/recovery/recovery-challenge.service.ts:104-137`, two client-facing errors (`auth.service.ts:169`, `checkout.controller.ts:304`).
- Operator surfaces: "Xend Console", "Xend Test Dashboard".

**Assets**

- `apps/mobile/assets/images/logo/xend*.png` (5 files, 2 of them unreferenced), plus `icon.png`, `adaptive-icon.png`, `splash-icon.png`, `favicon.png`, `notification-icon.png`, `app-icon.png`.
- Store art in `assets/dapp-store/`.
- The inline SVG mark in `packages/checkout-core/src/button.ts:99`.
- `apps/checkout` and `apps/merchant` have no favicon or OG image at all. Worth adding with the new mark.

**Internal names**

- CI and test database names (`xend_ci`, `xend_test`), log paths, the six `XEND_*` dev-script env vars, the compose project name `xend-local` (renaming it orphans each developer's local Postgres volume), Kafka client id, Turnkey resource name prefixes, Basic-auth realm, CSRF cookie.

**Tests that assert brand copy** will fail and need updating in the same change: `packages/checkout-core/src/__tests__/*` (6 files), `XendPayButton.test.tsx`, `apps/checkout/src/screens/Result.test.tsx`, `apps/merchant/src/MerchantSessionBoundary.test.tsx`, and three backend specs (security notices, console auth, webhook delivery).

## 4. Do not rename without a migration

Each of these is a string that something outside the repo, or something already on a device, is bound to.

| #   | Identifier                                                                                                                                       | Where                                                                                                            | What breaks                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Hardware key alias `com.giftedborg.xend.approval-signer`                                                                                         | `modules/hardware-key/ios/HardwareKeyModule.swift:27`, `.../HardwareKeyModule.kt:48`                             | The Secure Enclave or StrongBox key is no longer found. It is the device signer in the 2-of-3 set and cannot be restored without the other two.                                                                                                                                                                                                                                            |
| 2   | Bundle id and Android package `com.giftedborg.xend`                                                                                              | `apps/mobile/app.json:30,56`                                                                                     | A new app as far as the stores and the OS are concerned. All keychain and keystore data is lost. Backend attestation fails through the hardcoded `ANDROID_PACKAGE_NAME` (`apps/backend/src/attestation/key-attestation.verifier.ts:19`) and `IOS_APP_ATTEST_APP_ID`. `google-services.json`, Privy allowed identifiers and the hosted `assetlinks.json` and AASA files all have to follow. |
| 3   | Passkey relying party `xend.global`                                                                                                              | `hooks/usePasskey.ts:72`, `hooks/usePasskeyLogin.ts:20`, `app.json:27-28`, `apps/checkout/src/lib/config.ts:6-7` | WebAuthn credentials are bound to the rp.id. Every enrolled passkey stops resolving. `docs/specs/well-known-webauthn-related-origins.md` covers the related-origins route, which is the way to add a Prydd domain without changing the rp.id.                                                                                                                                              |
| 4   | Presence-proof domain `xend:spend-presence:v1`                                                                                                   | `apps/backend/src/transfer/presence-proof.ts:34`, `modules/hardware-key/src/presence.ts:26`                      | App and backend hash this into what the device signs. A mismatch fails every under-limit spend.                                                                                                                                                                                                                                                                                            |
| 5   | Merchant wire contract: `Xend-Signature`, `Xend-Event-Id`, return params `xend_*`, postMessage envelope `xend: 'checkout'` and `xend.checkout.*` | `webhook-delivery.service.ts:96-97`, `return-url.ts:40-43`, `packages/checkout-protocol/src/build.ts`            | SDK, hosted checkout and backend silently stop understanding each other, and any pilot merchant reading the old header fails verification.                                                                                                                                                                                                                                                 |
| 6   | Checkout session carriers: `xend.checkout.session`, `x-xend-checkout-session`, `xend_checkout_session`                                           | `apps/checkout/src/lib/api.ts:10-11`, `config.module.ts:298`                                                     | Active checkout sessions drop. Minor: the shopper signs in again.                                                                                                                                                                                                                                                                                                                          |
| 7   | Pending payment keys `xend.pending_payment_*`                                                                                                    | `apps/mobile/utils/pendingPaymentSubmissions.ts:12-13`                                                           | A signed but unsubmitted payment is orphaned on the device.                                                                                                                                                                                                                                                                                                                                |
| 8   | Metrics `xend_*`, OTEL service `xend-backend`, span attribute `xend.correlation_id`                                                              | `apps/backend/src/metrics/metrics.ts`, `tracing/`                                                                | External dashboards and alerts lose their series.                                                                                                                                                                                                                                                                                                                                          |
| 9   | Firebase project `xend-fe388`                                                                                                                    | `apps/mobile/google-services.json`                                                                               | Cannot be renamed in place. Needs a new project.                                                                                                                                                                                                                                                                                                                                           |

Recommendation: leave 1, 3, 4, 7 and 9 exactly as they are. They are invisible to users. Items 2, 5, 6 and 8 are a decision (section 9, questions 4 and 5), and the cost of each depends on whether any build is in users' hands and whether any merchant is live, which the repo cannot tell me.

**One window that is closing.** `@xend/checkout-core` and `@xend/checkout-react` are not on npm yet (both return 404, versions are `0.0.0`). `.changeset/tender-otters-smile.md` queues their first public release and `.github/workflows/sdk-release.yml` publishes on push to `main`. The scope, `XendPayButton`, `mountXendButton`, `window.XendCheckout`, the `xend-pay-` CSS prefix, `xend-checkout.iife.js` and the wire contract in item 5 are all free to change today and become a breaking change the moment that changeset lands. If the SDK is going to carry the Prydd name, hold the release until it does.

## 5. Coordinated renames

Safe, but several places move together.

- **Workspace scope `@xend/*`**: 12 packages, 161 references. Root scripts (`package.json:7,16,17,20`), `.changeset/config.json:9-12`, CI turbo filter (`.github/workflows/ci.yml:69`), `apps/backend/Dockerfile:16,21,24`, the mobile alias triple (`tsconfig.json:8`, jest mapper `package.json:25`, `metro.config.js:31`), six tsconfig `extends`, six eslint configs, about 20 backend imports, then regenerate `package-lock.json`. Per the Metro trap already in project memory, boot the simulator afterwards: `tsc` and jest will pass while the app fails to bundle.
- **Native module package** `com.giftedborg.xend.hardwarekey`: directory path, `package` line, gradle namespace and `expo-module.config.json:7` together. Independent of the application id.
- **Expo slug `xend`** and **URL scheme `xend`** (`app.json:4,8,21,48`): tied to the EAS project id, the Sentry release name (`app/_layout.tsx:105`) and Privy's allowed schemes. No `xend://` literal exists in code.
- **Domains**: hardcoded links to `xend.global/app` (two checkout screens), `xend.global/legal/*` and `twitter.com/xend_global` (`settings/index.tsx:27-29`), mail sender `security@xend.global` (needs sender verification on a new domain), CORS default `pay.xend.global`, dev TLS hostnames in `apps/checkout/vite.config.ts` and `scripts/dev.mjs`.
- **Migration file** `apps/backend/drizzle/0001_xend_migration.sql` and its tag in `meta/_journal.json:16`. Not worth renaming. An unjournalled migration is skipped silently, and there is nothing user-visible to gain.

## 6. Positioning: what the brief says versus what exists

### 6.1 Product pillars on `main`

| Pillar in `REBRAND.md`                 | State                       | Evidence                                                                                                                                                                                                                                                      |
| -------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create an account, get a Solana wallet | Present                     | `app/add-email.tsx`, `AccountSetupModal.tsx`, `hooks/useProvisionAccount.ts`. The Account is a Squads 2-of-3 smart account.                                                                                                                                   |
| Fiat account (NGN)                     | Absent                      | Interface only: `apps/backend/src/virtual-account/virtual-account-provider.interface.ts`, no adapter, module or controller. ADR 0010 defers it. In the app it is one bullet in the Plus preview. `NGN` exists only as a display symbol (`utils/money.ts:11`). |
| KYC (required for a naira account)     | Backend only                | Sumsub adapter with no controller and no screen.                                                                                                                                                                                                              |
| Buy crypto with fiat                   | Absent on `main`            | No on-ramp code. Uncommitted work exists in the main checkout on `codex/fiat-integration` (`apps/backend/src/buy/` with a MoonPay provider, `apps/mobile/app/buy/`). It was not audited here because it is not committed.                                     |
| Cards                                  | Preview only                | `app/card/index.tsx` is a 15-line preview. The home tile says "Get your free Card" with nothing behind it.                                                                                                                                                    |
| Send and receive                       | Present, crypto rails only  | In: "Share your address or QR code". Out: "Send to a Solana address or .sol name".                                                                                                                                                                            |
| Bank send                              | Dead stub                   | `app/(send)/fiatamount.tsx` is a US-shaped form (routing number, "Austin", "TX") ending in a "coming soon" toast, with no navigation to it.                                                                                                                   |
| Swap, Earn, Investments                | Present, partial, read-only | Earn deposits are flag-gated off.                                                                                                                                                                                                                             |

So the neobank description is a roadmap, not a description of the current build. The rebrand can ship before those features do, but the copy has to be honest about which is which. Three promises already overreach under the old name: "Get your free Card" (`(tabs)/index.tsx:120`), the "Virtual bank account" Plus bullet (`constants/FeaturePreviews.ts:27`), and "Add Cash in the Xend app" on the checkout's insufficient-balance screen, where the app has no Add Cash action.

### 6.2 Documents that contradict the brief

- `docs/xend-master-context.md:62`: "Not another crypto neobank."
- `:63`: "Not a wallet. The word is banned outright, in copy and in code."
- `:64`: a visitor should not leave knowing which chain is used.
- `:27-30`: the merchant checkout "is the actual business" and the consumer app "is the demo". The Prydd brief leads with the consumer account.
- `:17,19`: brand phrase "Money, but faster." and strapline "A checking account for the internet, built for everyday life."
- `:134`: the mark is "a four-point X". It is derived from the old name.
- `CONTEXT.md:9-11`: "Xend: The product... Avoid: wallet, app".
- `CONTEXT.md:20,46,129`: exactly one Account and one Balance per Consumer. A naira account next to a dollar balance breaks this model.
- `CONTEXT.md:73-75`: Receive deliberately replaces "top up, deposit, fund, add cash". The brief's "create a fiat account" and "purchase crypto with fiat" need those words back, or new ones.
- `docs/xend-master-context.md:498` records an outstanding Nigerian securities-law opinion and says not to publish regulatory claims. Calling the product a bank or neobank is such a claim.

### 6.3 Voice today

The app's copy is already close to a bank register and is good: plain, second person, short sentences, no exclamation marks, and errors that say what did not happen ("The network is busy. Nothing has been sent."). The rebrand should keep this and change the name, not rewrite the voice. `REBRAND.md` says the tone changes but does not yet say to what, so this is question 2 in section 9.

What does not fit a neobank, whatever the new tone is:

- **Chain vocabulary on consumer surfaces**: "Send to a Solana address or .sol name" (`SendModal.tsx:32`), "Only send Solana assets to this address" (`QRCodeModal.tsx:60`), "Onchain transaction" and "Onchain fees" (`TransactionDetailModal.tsx:178,199,270`), "Explorer", "Routed to Kamino" (`earn/index.tsx:76`), "NFTs" in settings, default swap token "SOL".
- **"Wallet" leaking past the glossary**: "Secure my wallet" (`AccountSetupModal.tsx:98`, under a title that says Account), "Wallet name", "Renamed Wallet", "Hide My Wallet", "Recover with wallet".
- **Key management presented as the security model**: Device Key, Recovery Key, Active Keys, "Both keys on this phone approve".
- **Developer strings reaching users**: "USDC mint not configured" (`(send)/confirm.tsx:178`).
- **Old generic register**: "Invalid OTP. Please try again." and friends (`utils/errors.ts:40-72`), "All done!" (`success.tsx:36`), "Oops!" (`+not-found.tsx:11`).

### 6.4 Brand system drift already present

`REBRAND.md` says the colour scheme stays. Worth knowing that the written scheme and the shipped one already disagree:

- Spec says Geist. Code ships Inter everywhere (`apps/mobile/tailwind.config.js:29-39`, `packages/checkout-core/src/brand.ts:20`, `apps/checkout/src/index.css:17`).
- Spec says strictly monochrome, no gradients. Onboarding uses cyan `#8FE5F6` and blue blur gradients (`(auth)/login.tsx:43`, `recover.tsx:85-100`), the word wheel uses five colours, home tiles are coloured.
- Spec says the starburst is retired. `app/success.tsx:5` still imports it, and eight starburst assets remain in `assets/images/`.
- There is no brand or design-system document in this repo. The only written spec is `docs/xend-master-context.md:111-155`, which cites an external `xend-assets` repo that was not audited.

"The colour scheme stays" therefore needs one clarification: the written monochrome one, or what is on screen.

## 7. Design references

### 7.1 Plasma One

Sources: App Store listing and its six screenshots, plasma.org/personal, and Privy's write-up of the build. Not on Mobbin.

What it does:

- **Three tabs: Home, Earn, Tier.** No Activity tab and no Settings tab. Transactions sit on Home, and the profile is an avatar at top left.
- **Home is one column**: the label "Spendable", the balance in very large type, a small pill underneath with the total balance, two buttons ("Add funds" filled, "Send" outlined), the card rendered at near full width with its own balance and last four digits, then transactions.
- **Each transaction row shows the reward under the amount** ("-$38.19" with "+$1.42" beneath). The benefit is taught on every row.
- **Monochrome with one material.** White app surface, near-black ink, and a single brushed dark-green card that carries all the visual interest. Marketing shots are dark and photographic with the phone in a hand.
- **The card is the hero of the product.** Three of six store screenshots are the card. Tiers (Lite, Core, Platinum) are a segmented control over a carousel of card designs, each with three headline numbers and a short benefit list, and a single pinned button.
- **Vocabulary**: account, card, dollars, balance, add funds, send, earn, cashback. "Stablecoin" appears in marketing headlines. "Wallet" appears once, in the custody explanation.
- **Onboarding**: email plus basic profile, wallet created invisibly (Privy, no seed phrase), funded in minutes. KYC is Sumsub, and it is the subject of most one-star reviews (a locked address field, no human support).
- **Site headlines are claims with a number**: "up to 4% Cashback", "up to 6% Yield", "$0 transfers", "Add local currency. Get dollars. Withdraw any time." The FAQ opens with "Is Plasma One a bank?" and answers it.

### 7.2 Wise (Mobbin)

Screens: [home](https://mobbin.com/screens/84b0e0a3-8666-402d-9726-ee539d6ef407), [home, balances hidden](https://mobbin.com/screens/f1c8f9a2-3a9c-48ff-8e2c-51c0d8b03850), [adding money flow](https://mobbin.com/flows/f901aa7f-1c2c-4102-9d70-e04fa7096dee), [cards](https://mobbin.com/screens/d1c95e26-f355-47e5-9f08-cdf4bfb44ee8), [fee breakdown](https://mobbin.com/screens/df705b5e-b692-4e71-8788-3b535ea181e7), [account details](https://mobbin.com/screens/d3ec2182-0a47-45d7-a002-f35a6744036a).

What it does:

- **Home**: "Total balance" in one display currency, three pill actions (Send, Add money, Request), then a horizontal row of currency cards. Each card shows a flag, the currency code, the last digits of that currency's bank details and its balance. An eye icon hides every amount on the screen.
- **Four tabs**: Home, Card, Recipients, Payments.
- **Add money is one screen with four rows**: "You add" (amount), "Paying in" (currency, with Change), "Paying with" (method, with Change), "You pay" ("Total, no fees to pay" or "Total with fees" with the fee underneath), "Arrives" ("Today, in seconds"). The live rate sits in a lock pill at the top.
- **Fees are a bottom sheet** with Breakdown and Comparison tabs.
- **After paying, a transfer tracker**: a dated vertical timeline ("You set up your transfer", "We received your SGD", "Your money's being processed") with a Details tab and a PDF receipt.
- **Account details screen**: "Receive SGD", every field on its own row with a copy button, a hint under the fields that confuse people ("Only used for domestic transfers"), a Share button, and "Quick facts" chips for Speed, Fees and Limits.
- **Card tab**: a carousel of cards, three round actions (Show PIN, Card details, Freeze card), "Add to Apple Wallet", then a "Manage card" list. A frozen card is visibly frosted with a "Frozen" label on it.

### 7.3 Fuse (on disk)

`docs/design/references/fuse/`, 11 screenshots. The current app is closest to this one, and the home screen is nearly a copy of `home-with-chart.png`: total balance with a dimmed decimal, a 2 by 2 grid of Cash, Investments, Earn and Card, a three-icon tab bar and a floating plus button. Fuse's weaknesses carry over with it: `cash-zero-balance.png` meets a new user with "Get USDC to start earning", which is an asset ticker and a yield pitch before the user has any money in.

### 7.4 What I would take, in order

1. **Make the naira account a first-class object on Home (Wise).** Replace the single "Cash" tile with a row of balance cards: a Naira card showing the bank name and last digits of the virtual account, and a Dollar card. This is the one change that makes the app read as a bank on first open. It also forces the Account and Balance model decision in question 3.
2. **Add an account details screen (Wise).** Bank name, account number, account name, each with a copy button, plus Share and the three quick facts (speed, fees, limits). In Nigeria the account number is the product, since paying in means a bank transfer to it. There is no equivalent screen today.
3. **Put "Add money" and "Send" directly under the balance (Plasma One, Wise).** Today both live behind the floating plus button, which hides the two things a bank app is for. Keep at most three actions.
4. **One-screen quote for buying dollars with naira (Wise).** You pay, you get, paying with (naira account by default, "Change" for an external account, which is the brief's exact requirement), total with fees, arrives. Fees open as a sheet. The existing swap and the uncommitted buy flow should both use this shape.
5. **A transfer tracker for anything not instant (Wise).** Bank deposits and KYC both take time. The current copy style ("Nothing has been sent") suits a timeline well.
6. **Collapse the security surface (Plasma One).** Plasma shows none of its key model. Prydd's 2-of-3 design is a real advantage, but thirteen settings routes about keys read as a wallet. Suggest one "Security" entry with plain outcomes ("This phone", "Your passkey", "Recovery") and the mechanism one level down.
7. **Show the card on Home once it exists (Plasma One), and not before.** Until then, the Card tile should say it is coming, not "Get your free Card".
8. **Hide-balance toggle (Wise).** Small, expected in this market, and cheap.
9. **Rewards on the row (Plasma One).** The "Xend⁺" fee-covered badge in transaction details is the same idea, but buried. If Plus survives the rebrand, show the covered fee on the Activity row.
10. **A written answer to "Is Prydd a bank?" (Plasma One).** In the app and on the site, before launch.

What I would not take:

- **Plasma's Tier tab and token-locked tiers.** They are built around its own token and would import exactly the crypto register the product has avoided.
- **Wise's saturated green and heavy display type.** The brief keeps the colour scheme.
- **Plasma's KYC flow.** Its reviews are a list of what goes wrong: locked fields, no manual override, no human support. KYC is new surface for Prydd and deserves its own design pass, with a way to correct a submission and a visible status.
- **Fuse's "Get USDC" empty state.** Lead with the naira account and "Add money".

## 8. Documents

| Document                                                                                                                                                                                                                                  | Action                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/xend-master-context.md`                                                                                                                                                                                                             | Rewrite and rename. Sections 1, 2.2, 2.4, 2.5 (the mark), 4, 7, 9 and 10 all change. Inbound links: `CLAUDE.md:15`, `README.md:191`, `apps/mobile/example.env:54`.                                                                                                                    |
| `CONTEXT.md`                                                                                                                                                                                                                              | Rewrite the product entry, Account, Cash, Balance and Receive once questions 2 and 3 are answered. New terms are needed for the naira account, the dollar balance, add money and buy.                                                                                                 |
| `README.md`, `CLAUDE.md`, `docs/adr/README.md`, per-app and package READMEs                                                                                                                                                               | Find and replace after the scope decision. `apps/backend/README.md:3` is already stale (it still describes the Squads Grid SDK).                                                                                                                                                      |
| `docs/specs/pay-with-xend-integration-quickstart.md`, `pay-with-xend-usdc-pilot.md`, `merchant-onboarding-model.md`, `merchant-payout-destination-checklist.md`, `multisig-credentials-runbook.md`, `account-security-model-decisions.md` | Living documents. Update after the compound-name decision.                                                                                                                                                                                                                            |
| `docs/specs/dapp-store-resubmission.md`                                                                                                                                                                                                   | The store listing copy at `:144,215` needs rewriting.                                                                                                                                                                                                                                 |
| `docs/adr/0010` to `0036` (26 files)                                                                                                                                                                                                      | Leave. They are accepted records of decisions made under the old name. Add one line to `docs/adr/README.md` saying the product was called Xend before this date. ADRs 0016 and 0017 define the wire contract, so if section 4 item 5 changes they get a superseding ADR, not an edit. |
| Closed and dated specs (8 files)                                                                                                                                                                                                          | Leave.                                                                                                                                                                                                                                                                                |
| `.changeset/tender-otters-smile.md`                                                                                                                                                                                                       | Unreleased, so not yet history. Reword before the first publish.                                                                                                                                                                                                                      |
| New ADRs needed                                                                                                                                                                                                                           | None exists for a consumer fiat account, a consumer on-ramp, card issuing, or the rename itself. ADR 0019 locks "No consumer KYC anywhere in Checkout", which still holds but now sits beside an app that will require KYC.                                                           |

## 9. Decisions needed before any renaming starts

These are product calls. I have not made them.

1. **Compound names.** What replaces "Pay with Xend", "Xend Checkout", "Xend Card", "Xend Plus" and "Xend⁺", and "Xend for Merchants"? Is the merchant product still under the same name as the consumer app?
2. **Tone.** `REBRAND.md` says the tone changes but does not describe the new one. What is the new voice, and do the existing rules carry over (no em dashes, no filler, headlines as claims, no emoji)?
3. **Vocabulary and model.** Are "wallet", "deposit", "top up" and "add money" now allowed? What are the user-facing names for the naira account and the dollar side? Does "one Account, one Balance" become several balances under one account?
4. **How deep does the rename go?** Display name only (keep bundle id, scheme, rp.id, key aliases), or a new app identity? The second option is a migration project for every existing user. This depends on whether any build is in users' hands.
5. **SDK and wire contract.** Rename the npm scope, public symbols, headers and message types before the first publish, or ship under the old names? Is any pilot merchant already integrated?
6. **Domains and handles.** What is the Prydd domain, and does `xend.global` stay as the passkey relying party with the new domain added as a related origin?
7. **Is the chain visible now?** The brief says users get "a Solana wallet". The current rule is that nobody should be able to tell which chain is used.
8. **Which comes first, consumer or merchant?** The current briefing says the checkout is the business and the app is the demo.
9. **Colour scheme.** The written monochrome system, or what is on screen today (section 6.4)? And is the type Geist or Inter?
10. **The mark.** The X is name-derived. Is there a Prydd logo yet, and where do the files come from?
11. **"Neobank" as a public claim.** Does it need legal sign-off given the open securities-law opinion?
12. **Unbuilt features in the copy.** How should the card, the naira account and Plus read until they exist?
13. **Housekeeping.** Rename the Linear team (`XEND`, key `XEN`), the GitHub repo, the EAS project and the Sentry projects, or leave them?

### Answers received (from the Q&A block in `REBRAND.md`, 2026-10-12)

| #   | Answer                                                                       | Effect                                                                           |
| --- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | Everything Xend becomes Prydd, including Pay and Card                        | Pay with Prydd, Prydd Checkout, Prydd Card, Prydd Plus, Prydd for Merchants      |
| 2   | Same tone                                                                    | No copy rewrite beyond the name                                                  |
| 3   | Vocabulary and model unchanged                                               | `CONTEXT.md` terms stand. "Wallet" stays banned on consumer surfaces             |
| 4   | Rename all the way through. Xend no longer exists                            | Identifiers, storage keys, key aliases and signing domains are renamed too       |
| 5   | Rename scope, symbols, headers and message types. No real users or merchants | Section 4 items 1, 4, 5, 6, 7 and 8 are safe to rename                           |
| 6   | No Prydd domain yet. `xend.global` stays as the passkey relying party        | Every `*.xend.global` host, the mail sender address and `@xend_global` stay      |
| 7   | The chain is not visible                                                     | The chain-vocabulary leaks in section 6.3 are defects to fix                     |
| 8   | Checkout is the business, but the consumer app comes first                   | Master context order of emphasis changes, not its thesis                         |
| 9   | Not answered                                                                 | Monochrome spec versus what is on screen, and Geist versus Inter, are still open |
| 10  | No logo yet                                                                  | The X mark stays on screen until one exists                                      |
| 11  | "Neobank" is a public claim                                                  | Master context section 2.2 ("Not another crypto neobank") is retired             |
| 12  | Unbuilt-feature copy stays as it is                                          | "Get your free Card" and the Plus bullets are left alone                         |
| 13  | Linear, EAS and Sentry are left. GitHub repo later                           | `CLAUDE.md` Linear lines, the Expo slug and Sentry slugs are untouched           |

Still bound to registrations outside the repo, so not renamed in code: the app id `com.giftedborg.xend` (Apple App ID and App Attest, Firebase `google-services.json`, Privy allowed identifiers, `assetlinks.json`), the Expo slug and the `xend` URL scheme. Changing those is a console job first and a code change second.

## 10. Suggested order once those are answered

1. Hold the SDK release (the pending changeset) until question 5 is settled.
2. Rewrite `CONTEXT.md` and the master context first. Every later copy change is checked against them.
3. Swap logo, icons, splash and store art. Add favicons to checkout and merchant.
4. Rename user-visible copy across mobile, checkout, merchant, emails and push, and update the tests that assert it.
5. Rename the workspace scope and internal names in one change, then boot the app.
6. Clean up what the audit found on the way: the dead US bank form, the "wallet" leaks, the old-register error strings, the starburst assets, the three overreaching promises.
7. UI changes from section 7.4, each as its own piece of work, starting with Home and the account details screen.
8. Leave section 4 alone unless question 4 says otherwise.

## 11. Making Prydd stop looking like Fuse (and like Xend)

Observed on 2026-10-12 with the app running from this branch in demo mode on the iPhone 17 Pro Max simulator. Home and the Card preview were compared against `docs/design/references/fuse/home-with-chart.png`.

Today the Home screen is the Fuse Home screen with different numbers. A rename does not change that. Seven things carry the resemblance, listed by how much each one contributes.

| #   | What makes it read as Fuse                                                                          | Where                                  | What to do instead                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The 2 by 2 tile grid: Cash, Investments, Earn, Card, in the same order                              | `app/(tabs)/index.tsx:92-127`          | Remove the grid. Use a horizontal row of balance cards (Naira, Dollars) and put Earn, Investments and Card in a plain list below. This is the single biggest change. |
| 2   | The balance chart placeholder and the 1D / 1W / 1M / 6M / 1Y range chips                            | Home, under the balance                | Remove both. A cash balance does not need a price chart. Put Add money and Send in that space.                                                                       |
| 3   | "Total Balance" with the cents dimmed to grey                                                       | Home, Cash tile, Fuse Card tile        | Set the whole amount in one weight. Add a currency switch (naira or dollars) and a hide-balance toggle, which Fuse has neither of.                                   |
| 4   | Glossy gradient app-icon squircles on each tile (blue dollar, orange grid, purple bars, black Visa) | Tile icons                             | One-weight line icons in ink. This is also what the written monochrome spec asks for.                                                                                |
| 5   | Dashed outlines on tiles the user has not set up                                                    | Investments, Earn, Card tiles          | Drop the dashed state. An unused feature is a list row with a short prompt.                                                                                          |
| 6   | Three unlabelled tab icons on the left and a black floating plus button on the right                | `components/ui/organisms/CustomTabBar` | A labelled tab bar across the full width (Home, Card, Activity, Account) and no floating button. The actions behind the plus move under the balance.                 |
| 7   | White screen, single name-style header at top left, nothing else in the header                      | Home                                   | Avatar at top left, hide-balance and help at top right.                                                                                                              |

Beyond Home:

- **Onboarding.** The word wheel over a blue gradient with "Your money, upgraded" is the one screen that does not look like Fuse, but it contradicts the monochrome spec and says nothing a bank would say. Suggest a monochrome first screen whose visual is the product: a naira account number card. Headline as a claim, per the existing tone rules.
- **Card coming-soon screen.** The reference in `REBRAND.md` (`Downloads/IMG_4484.PNG`, Wise's "Our cards aren't available in Nigeria") is: full-bleed dark screen, one illustrated object in the centre, a two-line heavy uppercase headline, one sentence, one full-width primary button ("Join the waitlist") and a text link ("Learn more"). The current Prydd Card screen is a small icon, a title and a faded benefit list in a grey box, with no action at all. Rebuild it on the reference's structure in Prydd's own ink and paper, with a card as the object. It needs one decision first: is there a waitlist to join, and where does it go?
- **Keys and recovery.** The explainer screens follow Fuse's (device key, cloud key, recovery key) closely, down to the framing. Grouping them under one "Security" entry with outcome names ("This phone", "Your passkey", "Recovery") separates the two products and suits a bank.
- **A signature of its own.** Fuse's identity is the tile grid and the dimmed decimal. Prydd needs one thing that is recognisably its own on every screen. Three candidates, in order of preference:
  1. The account number as an object: a card showing bank name, number and a copy button, reused on Home, Receive, onboarding and share sheets.
  2. Numerals: set every amount in Geist Mono (the spec's own type choice, never shipped) so money reads differently from everything else.
  3. A motif from the new logo, once there is one. Nothing can be done here until question 10 is answered.

Suggested order: 1 and 2 together (they are the same screen and remove most of the resemblance), then 6, then the Card screen, then 3 to 5, then onboarding.
