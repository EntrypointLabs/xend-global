# Xend — Project Overview

A working dump of everything currently understood about Xend, assembled from a domain-grilling session plus codebase exploration. Sections marked **[confirmed]** were resolved with the maintainer. **[inferred]** is read off the code. **[unknown]** is flagged for follow-up.

---

## 1. What Xend is

**[confirmed]** A mobile payments app for everyday consumers. Tagline: _"spend money as you would, but faster."_ P2P payments to friends are the dominant case; merchant payment rides the same rails as a secondary capability.

The crypto rails underneath (Solana, USDC, Squads Grid smart accounts, passkey auth) are intentionally invisible to the user. The product framing is consumer fintech, not crypto wallet.

## 2. Who it's for

**[confirmed]** Everyday consumers. Not crypto-native. The mental model the product should serve is "spending money," not "moving tokens."

## 3. Domain glossary

Canonical vocabulary. Single source of truth is `/CONTEXT.md`; this is a snapshot.

### Product

- **Xend** — the product (proper noun, always capitalized). _Avoid_: wallet, app.
- **Consumer** — an everyday person using Xend. _Avoid_: user, trader, holder, wallet user.

### Identity

- **Account** — the Consumer's Squads Grid smart account on Solana. Holds their Cash. Exactly one per Consumer. _Avoid_: wallet, smart account (in copy), profile.
- **Passkey** — the platform-keychain-stored auth primitive paired with the Consumer's email. Not device-bound; synced via iCloud Keychain / Google Password Manager. iPhone + iPad on same Apple ID share the same Passkey.
- **Recovery Email** — additional email(s) attached to the Account for use during Recover. A Consumer can have several. The signup email itself also acts as a recovery channel.
- **Recover** — the action a Consumer takes to regain access on a new keychain. Driven entirely by email — no recovery codes, no mnemonics, no social recovery. Permanent lockout only possible by explicitly deleting the Account.
  - **[mismatch]** The `(auth)` route file is `restore-account.tsx` and the UI label is presumably "Restore Account." Canonical verb is **Recover** — one of these should change.

### Money

- **Cash** — the feature area / surface covering everything about the Consumer's money (the screen, the actions, the value). "Cash" is the surface; **Balance** is the number on it.
- **Balance** — the numeric amount of Cash in an Account, in the Consumer's native currency (e.g. `$42.17`). Backed 1:1 by USDC on Solana today; multi-stablecoin support planned. When multi-balance lands, the headline figure becomes a **Total Balance** summed across them.

### Movement

- **Spend** — umbrella concept for _any_ outflow from an Account (P2P or merchant). The sender's intent. Headline marketing verb, but **not** the in-app button label.
- **Send** — the in-app action verb for executing a Spend (button label, route name `(send)`, the natural verb when narrating).
- **Sending** — the verb form shown while a Spend is in flight (spinner + "Sending…"). Conceptual state is **Pending**, but that word is not shown to the Consumer.
- **Spend Status** — three values surfaced to the Consumer (no Solana commitment-level nuance):
  - **Pending** — in flight (shown as "Sending…")
  - **Sent** — confirmed on-chain
  - **Failed** — confirmed-failed on-chain (no human-friendly reason today; just "Failed")
- **Receive** — umbrella concept for any inflow to an Account, from any source (another Consumer, on-ramp, bank deposit, external wallet). One word covers all sources.
- **Spending Limit** — self-imposed cap a Consumer sets on outflow per period, enforced before a Spend executes.

**[confirmed]** Balance is **not optimistic** — it only updates when the change occurs on-chain. While Pending, the Activity is visible but Balance hasn't moved.

### Timeline

- **Activity** — a single event in an Account's timeline. Covers Spends (Pending/Sent/Failed), Receives, and non-money events (saved a Contact, set a Spending Limit, etc.).
- **Activities** — the plural; the unified, reverse-chronological feed. Per-Account, even when multi-balance lands.
  - **[mismatch]** Code names: file `history.tsx`, type `History`, screen `HistoryScreen`. UI label `"Activity"`, component `ActivityList`. The "History" naming is legacy and should align.

### Destinations

- **Address** — canonical destination of a Spend: a Solana public key.
- **SNS Name** — a `*.sol` Solana Name Service name; resolves to an Address at Spend time. Input convenience, not a stored identity.
- **Contact** — a saved Address + label in the Consumer's address book. Not a social graph; not a directory; purely a personal shortcut for frequent destinations. Stored as `address + label` only.

## 4. Relationships

- A **Consumer** has exactly one **Account**
- A **Consumer** authenticates with an email + **Passkey** to unlock their **Account**
- A **Consumer** may attach one or more **Recovery Emails**; any can drive **Recover**
- An **Account** holds **Cash**, whose value is shown as a **Balance**
- A **Spend** is an outflow from the Account; **Send** is the in-app action for executing one
- A **Receive** is an inflow to the Account from any source
- A **Consumer** has an address book of **Contacts** (saved Addresses with labels)
- A **Spend** targets an **Address** — specified directly, via an **SNS Name**, or by picking a **Contact**
- A **Spending Limit** is checked before a **Spend** executes
- Every Spend, Receive, and non-money event produces an **Activity** in the Account's **Activities** feed

## 5. Open / unresolved concepts (uncovered in grilling, surfaced by code)

These are **[inferred]** from filenames and need a maintainer pass before going into `CONTEXT.md`.

- **KYC** — `app/(modals)/kyc.tsx`, `api/kyc+api.ts`, `api/kyc-status+api.ts`. Compliance flow; presumably gates higher-value Spends or fiat on-/off-ramps. What's the user-facing language?
- **Virtual Account** — `api/get-virtual-accounts+api.ts`, `api/open-virtual-account+api.ts`. Looks like a per-Consumer bank account number that routes deposits into the Account (classic on-ramp pattern, likely Bridge.xyz or similar). Is "Virtual Account" the user-facing term, or is this hidden behind Receive?
- **Bank Details** — `app/(modals)/bankdetails.tsx`. Probably bank-account collection for off-ramp / cash-out. No off-ramp verb defined yet — is it "Withdraw"? "Cash out"? "Send to bank"?
- **Payment Intent** — `api/prepare-payment-intent+api.ts`. Stripe-flavored. Probably card-based on-ramp. Maybe a sub-mechanism of Receive.
- **OTP** — `api/verify-otp+api.ts`, `api/verify-otp-and-create-account+api.ts`. Email OTP for signup/login. Part of the Passkey enrollment dance — needs a clean explanation of how OTP, email, and Passkey fit together.
- **Face ID** — `app/(auth)/faceid.tsx`. Biometric unlock on top of the Passkey? Or just the OS-mediated Passkey UX?
- **Fiat vs. crypto-denominated send** — the `(send)` flow has both `amount.tsx`/`confirm.tsx` _and_ `fiatamount.tsx`/`fiatconfirm.tsx`. Two distinct flows? What's the user-meaningful difference if Balance is already fiat-denominated?
- **Multi-balance future** — confirmed planned; the data model (per-Account, single Balance today, multiple later) needs more grilling before it lands.
- **Spend-by-email** — explicitly TBD. Email is auth-only today; no Consumer-to-Consumer Spend by email.

## 6. Architecture

### Monorepo layout

```
/
├── apps/
│   ├── mobile/      # @xend/mobile  — Expo React Native (Android/iOS/Web)
│   └── backend/     # @xend/backend — NestJS server (Drizzle ORM)
├── packages/
│   ├── ui/                  # shared React component library
│   ├── eslint-config/       # shared lint config
│   └── typescript-config/   # shared tsconfig
├── docs/
│   ├── adr/        # 10 ADRs to date — all styling/quality (no domain ADRs)
│   └── agents/     # agent-skill configuration (this skill)
└── CONTEXT.md      # domain glossary
```

Turborepo + npm workspaces. Repo name is `fuse-android` but all packages and the Linear team are `xend` / `XEND` / `XEN`.

### Mobile app structure

```
apps/mobile/
├── app/                # expo-router file-based routes
│   ├── (auth)/         # start, login, email-login, faceid, restore-account
│   ├── (modals)/       # kyc, bankdetails
│   ├── (send)/         # recipient, amount/confirm, fiatamount/fiatconfirm
│   ├── (tabs)/         # index (home), history, settings/*
│   ├── cash/           # dedicated Cash screen (separate from tabs home)
│   ├── api/            # expo-router server routes (BFF)
│   ├── passkey-callback.tsx
│   └── success.tsx
├── components/
│   ├── BalanceView.tsx
│   └── ui/             # atoms / molecules / organisms / layout
├── contexts/           # AuthContext, ModalFlowContext, ScreenThemeContext, ToastContext
├── utils/              # apiClient, auth, smartAccount, solana, storage, toast, ...
├── hooks/
├── types/              # History (legacy name) and others
├── docs/               # mobile-app-specific docs (DEAD-CODE.md, STYLE.md, etc.)
└── tailwind.config.js  # NativeWind + CSS-variable tokens
```

### Backend

`apps/backend` — NestJS, Drizzle ORM (postgres-flavored migrations in `drizzle/`). Default dev port 8000. Domain split with mobile not yet grilled.

### Mobile → Backend boundary

The mobile app has `app/api/*+api.ts` files — those are **expo-router server routes** running inside Expo, not the NestJS backend. They appear to act as a BFF in front of the real backend:

- `auth+api.ts`, `register+api.ts`, `verify-otp*`
- `create-smart-account+api.ts`
- `balance+api.ts`, `get-transfers+api.ts`
- `kyc+api.ts`, `kyc-status+api.ts`
- `open-virtual-account+api.ts`, `get-virtual-accounts+api.ts`
- `prepare-payment-intent+api.ts`, `confirm+api.ts`
- `sentry+api.ts`

The relationship between these BFF routes and `apps/backend/` is **[unknown]** — needs a grilling pass.

## 7. Tech stack

### Mobile

- Expo SDK ~54 + React Native 0.81 + React 19.1
- expo-router (file-based)
- NativeWind 4 + Tailwind 3.4 (ADR-0001: sole styling system, CSS-variable tokens)
- React Query (`@tanstack/react-query`)
- `@gorhom/bottom-sheet` for sheet UI
- React Navigation 7 (under expo-router)
- Sentry RN for error reporting
- Zod for validation
- date-fns

### Crypto / wallet stack

- `@solana/web3.js`, `@solana/spl-token`
- `@sqds/grid`, `@sqds/grid-react-native` — Squads Grid (embedded smart accounts)
- `@bonfida/spl-name-service` — SNS Name resolution
- `ethers` — present, purpose unclear in a Solana-first app
- `@hpke/core`, `@hpke/chacha20poly1305`, `@noble/ciphers`, `@noble/curves`, `@stablelib/*` — HPKE & primitive crypto (Passkey-derived encryption?)
- `expo-secure-store`, `react-native-get-random-values`

### Auth / device

- Passkeys (via Squads Grid + platform keychain)
- `expo-camera` (QR scan)
- `expo-haptics`, `expo-image`, `expo-blur`, etc.

### Backend

- NestJS, Drizzle ORM
- Pure ESM, TS tooling

### Tooling

- Turborepo, npm workspaces, Prettier, ESLint, Husky + lint-staged

## 8. Architectural decisions on record (ADRs)

All current ADRs are mobile/styling/quality (none domain-level yet):

| #    | Title                                                             |
| ---- | ----------------------------------------------------------------- |
| 0001 | Consolidate on NativeWind 4 + CSS-variable tokens                 |
| 0002 | `darkMode: "class"` + `useColorScheme` from nativewind            |
| 0003 | Semantic token taxonomy (HSL CSS vars, incremental minimal)       |
| 0004 | Five documented inline-style exception comments                   |
| 0005 | `Typography` is canonical text component (deprecate `ThemedText`) |
| 0006 | Lint enforcement: `error` in reachable, `warn` elsewhere          |
| 0007 | Defer `ScreenThemeContext` removal to a follow-up PR              |
| 0008 | Pin `tailwind-merge` to `^2.6.0`, no new style-cleanup deps       |
| 0009 | Visual regression: manual iOS + Android screenshots only          |

### ADR candidates from this session

Worth writing up before they get forgotten:

1. **Balance is non-optimistic; updates only on on-chain confirmation.** Hard to reverse (changes UX trust model). Surprising — most consumer payments apps go optimistic for snappiness. Real trade-off: accuracy & trust vs. perceived speed.
2. **Recovery is email-only; no recovery codes, mnemonics, or social recovery.** Hard to reverse (rebuilding around mnemonics later is invasive). Surprising for a non-custodial product (which usually pushes mnemonics). Real trade-off: consumer UX vs. self-custody purity.
3. **Activities feed includes non-money events** (Contact saved, Spending Limit changed). Easier to reverse; possibly not ADR-worthy alone, but documents the design intent.

## 9. Open questions to grill on next

In rough priority order:

1. **KYC** — where does it gate, what's the language, how does the Consumer experience it?
2. **Virtual Account** — what's the user-facing term, when does a Consumer get one, what role does Bridge (or equivalent) play?
3. **Off-ramp / withdraw to bank** — what's the verb? "Withdraw"? "Cash out"? "Send to bank"?
4. **Send flow's fiat vs crypto split** — what's the meaningful difference between `amount/confirm` and `fiatamount/fiatconfirm`?
5. **OTP + Passkey enrollment** — what's the exact dance during signup? When does OTP get used after signup (Recover)?
6. **Face ID** — is this a separate concept from Passkey or just OS-mediated Passkey UX?
7. **Mobile BFF (`app/api/*+api.ts`) vs `apps/backend/`** — what's each layer responsible for? Is the BFF a temporary shim or permanent design?
8. **Permanent lockout via Account deletion** — what does "delete Account" mean for residual on-chain Cash and Activities?
9. **Receive UX** — QR Code / Payment Request concept worth naming?
10. **Settings inventory** — what besides Spending Limits and Address Book lives there?

## 10. Naming cleanup queue (legacy ↔ canonical mismatches)

- `apps/mobile/app/(tabs)/history.tsx` → could be `activities.tsx` (or `activity.tsx`)
- `apps/mobile/types/History.ts` → `Activity.ts`, type `History` → `Activity`
- `HistoryScreen` function name → `ActivityScreen`
- `(auth)/restore-account.tsx` and any "Restore Account" copy → align with canonical verb **Recover**
- Spending Limits help text mentions "your wallet" — should be "your Account"
- Any user-facing copy using "balance" should distinguish: surface is **Cash**, number is **Balance**

## 11. Things I'm still uncertain about

- Whether `ethers` is actually used or a leftover dep — Solana stack dominates
- Whether HPKE / noble / stablelib are used for Passkey-derived envelope encryption of something (recovery payloads? local secret storage?) or are leftover from earlier crypto choices
- Whether `mockDatabase.ts` in `utils/` is a build-time mock or runtime fallback
- Where the canonical state for Activities lives — local (SQLite/AsyncStorage?), backend, or derived from on-chain history
