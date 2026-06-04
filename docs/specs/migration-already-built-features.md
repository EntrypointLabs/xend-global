# Migration: Already-Built Features off Squads Grid

Status: draft, pre-implementation
Author: discovery + spec pass, 2026-05-30
Scope: only the features that work end-to-end on Grid today. Card issuance, yield, swaps, confidential transfers, and the fiat-funded virtual account on-ramp are explicitly out of scope. The virtual account work has its own spec slot reserved; this document mentions it only where it shapes interface boundaries we need to leave room for.

## 1. Summary

Squads Grid was silently wound down by its vendor. Grid is currently load-bearing in three places: identity and OTP (Grid hosts the email OTP), the on-chain smart account and its signer (Grid wraps Turnkey MPC under a Squads multisig), and KYC plus virtual accounts (Grid wraps Bridge.xyz). The expo-router BFF in `apps/mobile/app/api/*+api.ts` ships the Grid API key inside the Expo process and is the path that handles money operations today. That is the surface we are removing.

**One-line principle**: no single external provider may be load-bearing in a way that kills Xend if it disappears. Every layer sits behind an internal interface we own, and every internal call goes through our NestJS backend, never through a runtime that ships provider keys to the device.

**Hard invariant preserved**: Balance is non-optimistic. It updates only when the change confirms on-chain. The migration does not introduce optimistic balance updates anywhere.

Outcome of this migration:

- Privy replaces Grid for wallet creation, passkey-based authentication, and signing. Choice closed in section 9, with a `WalletProvider` interface so we can swap later.
- NestJS becomes the only server. The expo-router BFF (`apps/mobile/app/api/*+api.ts`) is deleted. Mobile talks to a single backend over HTTPS, JWT-authenticated.
- Solana access is direct: Helius RPC primary, public mainnet RPC as a fallback, behind a `SolanaRpc` interface. SNS resolution stays on the client.
- Sumsub replaces Grid plus Bridge for KYC. KYC link ID moves off the device and into Postgres.
- Activity history goes hybrid: outbound transfers are written to our `transactions` table on submit and finalized on chain-confirmation; inbound transfers are reconciled from on-chain reads.
- Greenfield user model. The product has not gone live and no Consumer has funds in any existing Grid smart account, so there is no balance drain, no account handoff, and no key export from Grid. Existing local state in SecureStore is wiped on first run.

## 2. Current state (per feature, with file references)

The Grid integration is split across two server processes. The mobile app picks which one to call per endpoint:

| Feature                          | Mobile caller     | Server route                            | Server module                            | Grid SDK calls                                                  |
| -------------------------------- | ----------------- | --------------------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| Register, OTP send               | `apiClient`       | NestJS `POST /register`                 | `apps/backend/src/auth/auth.service.ts`  | `client.createAccount({ email })`                               |
| Login, OTP send                  | `apiClient`       | NestJS `POST /auth`                     | `auth.service.ts`                        | `client.initAuth({ email })`                                    |
| Verify OTP + create account      | `apiClient`       | NestJS `POST /verify-otp-and-create-account` | `auth.service.ts`                   | `client.completeAuthAndCreateAccount(...)`                      |
| Verify OTP (login)               | `apiClient`       | NestJS `POST /verify-otp`               | `auth.service.ts`                        | `client.completeAuth(...)`                                      |
| Passkey check                    | `apiClient`       | NestJS `POST /passkeys/check`           | `auth.service.ts`                        | `client.getPasskeys(addr)`                                      |
| Passkey enroll session           | `apiClient`       | NestJS `POST /passkeys/session`         | `auth.service.ts`                        | `client.generateSessionSecrets()` + `client.createPasskeySession(...)` (returns Grid-hosted WebAuthn URL) |
| Balance                          | `EasClient`       | BFF `app/api/balance+api.ts`            | `apps/mobile/grid/sdkClient.ts`          | `client.getAccountBalances(addr)`                               |
| Transfers history                | `EasClient`       | BFF `app/api/get-transfers+api.ts`      | `sdkClient.ts`                           | `client.getTransfers(addr)`                                     |
| Send: prepare                    | `EasClient`       | BFF `app/api/prepare-payment-intent+api.ts` | `sdkClient.ts`                       | `client.createPaymentIntent(addr, payload)`                     |
| Send: sign (in app)              | direct            | n/a (mobile-only)                       | `apps/mobile/app/(send)/confirm.tsx`     | `gridClient.sign({ sessionSecrets, session, transactionPayload })` |
| Send: submit                     | `EasClient`       | BFF `app/api/confirm+api.ts`            | `sdkClient.ts`                           | `client.send({ signedTransactionPayload, address })`            |
| KYC link                         | `EasClient`       | BFF `app/api/kyc+api.ts`                | `sdkClient.ts`                           | `client.requestKycLink(addr, { type: 'individual', endorsements: [] })` |
| KYC status                       | `EasClient`       | BFF `app/api/kyc-status+api.ts`         | `sdkClient.ts`                           | `client.getKycStatus(addr, kycId)`                              |
| Virtual account (out of v1)      | `EasClient`       | BFF `app/api/open-virtual-account+api.ts`, `get-virtual-accounts+api.ts` | `sdkClient.ts` | `client.requestVirtualAccount(...)`, `client.getVirtualAccounts(...)` |

Important runtime facts surfaced by reading the code:

- The expo-router BFF ships `GRID_API_KEY` to the Expo runtime, validated in `apps/mobile/grid/sdkClient.ts`. This is the largest single security and migration concern in the codebase.
- The NestJS backend already has `WalletsController` (`GET /wallets/me`, `/wallets/me/balances`) and `TransactionsController` (`POST /transactions/send`, `GET /transactions`), both JWT-guarded, but the mobile app never calls them. They are correct in shape and become the new home for balance, transfers, and send after the BFF is deleted. They are not dormant by design; mobile was never wired to them.
- The smart account is a Squads multisig: in `apps/mobile/utils/smartAccount.ts` we send `policies = { authorities: [{ address: <signer pubkey>, permissions: ['CAN_INITIATE', 'CAN_VOTE', 'CAN_EXECUTE'] }], threshold: 1, admin_address: null, timelock: null }`. The signer pubkey is Turnkey-MPC-held, supplied by Grid as `MpcProviderInfo.Turnkey = { primary_id, wallet_id, wallet_address }`.
- Per-send signing is short-lived. The client calls `gridClient.generateSessionSecrets()`, Grid mints a 15-minute Turnkey API key (`getSessionKeyObject(pub, '900')` in `auth.service.ts:230`), and the client signs locally with `sessionSecrets + session.authentication`. The "session expired" path in `confirm+api.ts:26-47` translates Turnkey's `API_KEY_EXPIRED` into our `SESSION_EXPIRED` and forces logout. The 15-minute window comes from Grid; we never set it.
- Passkey enrollment is a Grid-hosted WebAuthn page. Backend returns a URL, mobile opens it with `expo-web-browser.openAuthSessionAsync` using a `passkey-callback` deep link. Nothing WebAuthn-related runs in-app.
- Balance and transfers are read from Grid, not from chain. The mobile app caches `CACHED_BALANCE` in SecureStore but always re-fetches from Grid. The non-optimistic invariant is satisfied passively: Grid only reflects on-chain reality, and we never write balance state ourselves.
- The BFF `confirm+api.ts` does not write to Postgres. The persisted `transactions` table is written only by the NestJS `/transactions/send` path that nothing calls. Today, transaction history is Grid-derived. Post-migration that changes (section 5).
- KYC and Bridge are coupled inside Grid: `requestKycLink` returns a Bridge-issued URL plus a TOS URL. KYC approval is the gate that lets us subsequently request a virtual account. In `apps/mobile/hooks/useKyc.ts:127-135`, KYC approval also triggers `fetchBankDetails`. The link ID lives only in the device-local `MockDatabase` (`apps/mobile/utils/mockDatabase.ts`).
- No webhooks exist. All state changes are pulled by the mobile app (KYC status polled, balance polled, transfers polled).
- SNS resolution lives in `apps/mobile/utils/solana.ts:5` against a hardcoded Helius mainnet URL with the API key checked into source. Only `@bonfida/spl-name-service` uses it. No other Solana RPC use anywhere.
- `apps/backend/.env` is committed and contains a live-looking `GRID_API_KEY` and `JWT_SECRET`. Rotation is forced anyway by leaving Grid; flagged here so it does not get forgotten.
- `@hpke/*`, `@noble/*`, `@stablelib/*`, `ethers`, and `@solana/spl-token` are in `apps/mobile/package.json` but no app code imports them. `@ethersproject/shims` is imported by `apps/mobile/entrypoint.js` as a polyfill and can go with `ethers`.

## 3. Grid dependency inventory

Everything that touches Grid, in one place. Migration is not done until every item here is addressed.

### Server packages
- `@sqds/grid` in `apps/backend/package.json` (used by `GridService`, `AuthService`)
- `@sqds/grid-react-native` in `apps/mobile/package.json` (used by `apps/mobile/grid/sdkClient.ts`, every `apps/mobile/app/api/*+api.ts`, `apps/mobile/app/(send)/confirm.tsx`, and assorted DTOs)

### Server runtime objects
- `GridClient` in `apps/backend/src/grid/grid.service.ts`
- `GridClient` (`SDKGridClient.getInstance`, `getFrontendClient`) in `apps/mobile/grid/sdkClient.ts`

### Env vars
- `GRID_API_KEY` (NestJS, validated in `apps/backend/src/config/config.module.ts`)
- `GRID_API_KEY` (mobile BFF, validated in `sdkClient.ts:6-11`)
- `EXPO_PUBLIC_GRID_ENDPOINT` (mobile)
- `EXPO_PUBLIC_GRID_ENV` (mobile; also branched on in `useKyc.ts:119` to fake-approve TOS in sandbox)

### Postgres columns
- `smart_accounts.grid_account_id` (text, unique, not null) — Grid smart account address, also embedded in every JWT payload as `gridAccountId`
- (transactively) `transactions.signature`, `from_address`, `to_address`, `status`, `slot`, `confirmed_at` are provider-neutral on the surface but today never written outside the unused `/transactions/send` path; they get a real owner only after migration

### JWT payload
- `JwtPayload = { sub: userId, gridAccountId }` in `apps/backend/src/auth/jwt.strategy.ts`. Every signed token embeds the Grid account address. Renaming required.

### Mobile SecureStore keys (`AUTH_STORAGE_KEYS` in `apps/mobile/utils/auth.ts`)

Grid-shaped or Grid-derived:
- `auth_grid_user_id`
- `auth_mpc_primary_id`
- `auth_smart_account_address`
- `auth_session_secrets` (the client-generated key bundle Grid `sign` consumes)
- `auth_credentials_bundle`, `auth_keypair` (legacy Turnkey envelope, likely already dead)
- `auth_bridge_kyc_link_id`
- `auth_kyc_link`
- `auth_kyc_status`

Provider-neutral, kept after migration:
- `auth_user`, `auth_email`, `auth_persistent_email`, `auth_is_authenticated`, `auth_token`, `auth_has_passkey`, `auth_cached_balance`, `wallet_name`, `address_book`

### Device-local data store
- `MockDatabase` in `apps/mobile/utils/mockDatabase.ts` (SecureStore JSON blob keyed by `mock_database`) stores `{ grid_user_id, email, kyc_link_id, created_at, updated_at }`. The only persistence of `kyc_link_id` anywhere. Deletion or device switch wipes it.

### Webhooks
- None. There is no webhook receiver in NestJS, no Sumsub webhook today, no Bridge webhook, no Grid webhook. The migration adds them; today there are zero.

### Hosted UI redirects
- Passkey ceremony: Grid-hosted page opened via `expo-web-browser` with the `passkey-callback` deep link, parsed in `apps/mobile/hooks/usePasskey.ts:48-98` and routed by `apps/mobile/app/passkey-callback.tsx`.
- KYC link: Bridge-hosted KYC page opened by `apps/mobile/app/(modals)/kyc.tsx`. TOS link comes in the same response.

### Grid identifier formats we depend on
- Smart account address (Solana pubkey, base58 string, stored as `grid_account_id`)
- KYC link ID (opaque Grid string, stored in `MockDatabase.kyc_link_id`)
- Grid user ID (opaque Grid string, stored as `auth_grid_user_id`; not present in DB schema)
- Turnkey primary ID, wallet ID, wallet address (held inside `MpcProviderInfo.Turnkey`; opaque under Grid)

### Codepaths to delete
- `apps/mobile/app/api/*+api.ts` (all 13 files except `sentry+api.ts` which is config delivery, not Grid-related)
- `apps/mobile/grid/sdkClient.ts`
- `apps/mobile/utils/easClient.ts` (the BFF client)
- `apps/mobile/utils/smartAccount.ts` (today's create-smart-account payload builder)
- `apps/mobile/utils/auth.ts` `registerUser`, `authenticateUser`, `verifyOtpCodeAndCreateAccount`, `verifyOtpCode` (BFF-shaped wrappers; replaced by `apiClient`)
- `apps/mobile/utils/mockDatabase.ts` (replaced by backend persistence)
- `apps/backend/src/grid/` (replaced by `wallet`, `solana`, `kyc` modules)

## 4. Target architecture

```
+--------------------------------+
| Expo / React Native (mobile)   |
| - Privy SDK (@privy-io/expo)   |   ← passkey, signing
| - React Query, Zod             |
| - NO provider API keys         |
+--------------------------------+
              |
              | HTTPS, JWT
              v
+--------------------------------------------------------------+
| NestJS backend (apps/backend) — single server, no BFF        |
|                                                              |
| Modules:                                                     |
|   auth        sessions, JWTs (now backed by Privy ID tokens) |
|   wallet      smart account create/read (provider-agnostic)  |
|   transfer    prepare, submit, status (formerly transactions)|
|   activity    unified feed (DB writes + on-chain reads)      |
|   kyc         Sumsub workflow + webhooks                     |
|   solana      RPC client, mint metadata, confirmation watch  |
|                                                              |
| Adapters (interfaces in section 6):                          |
|   WalletProvider     → PrivyAdapter (only one for now)       |
|   KycProvider        → SumsubAdapter                         |
|   SolanaRpc          → HeliusAdapter, PublicMainnetAdapter   |
|   VirtualAccountProvider  (interface only; impl in later spec)|
+--------------------------------------------------------------+
   |                                  |              |
   v                                  v              v
Postgres (system of record)    Redis (sessions,  Kafka (chain events,
- users                         rate limits)      KYC events)
- smart_accounts                                        |
- transfers                                             v
- kyc_records                                  Solana RPC tailer
- privy_links                                  (Helius primary,
                                                public mainnet fallback)
```

### BFF-vs-backend boundary, post-migration

There is no boundary. The expo-router `app/api/*+api.ts` directory is deleted in its entirety (except `sentry+api.ts`, which delivers Sentry DSN config and is not Grid-related). Every mobile call goes to `EXPO_PUBLIC_BACKEND_URL` against the NestJS server. The only mobile-resident provider SDK is Privy, which holds session keys in iOS Keychain / Android Keystore via Privy's own embedded wallet UX. No long-lived provider API key ever lives on the device.

### Old → new mapping

| Old (Grid)                                     | New                                                     |
| ---------------------------------------------- | ------------------------------------------------------- |
| `createAccount(email)` + email OTP             | Privy email OTP via Privy SDK in mobile; backend mints our JWT after verifying Privy ID token |
| `completeAuthAndCreateAccount`                 | Privy creates the embedded Solana wallet; backend records `smart_accounts` row keyed by Privy user ID |
| `getPasskeys`, `createPasskeySession`, hosted WebAuthn URL | Privy SDK in-app passkey ceremony (no hosted browser redirect) |
| `generateSessionSecrets`, `sign`, 15-min Turnkey API key | Privy session, signing via Privy SDK (`signAndSendTransaction`). Silent re-auth via passkey when the session expires; no force-logout. |
| `getAccountBalances(addr)`                     | `solana` module: `getTokenAccountsByOwner` via Helius, sum by mint, render whichever balances we recognize |
| `getTransfers(addr)`                           | `activity` module: union of `transfers` table (sends we wrote) and on-chain reads (Helius enhanced txs for receives) |
| `createPaymentIntent` + `sign` + `send`        | `transfer` module: build the SPL token transfer instruction server-side, return unsigned tx, mobile signs via Privy, mobile submits via backend, RPC tailer confirms |
| `requestKycLink(addr, ...)` + Bridge URL       | `kyc` module: Sumsub applicant + access token; mobile opens Sumsub SDK or web flow; Sumsub webhook updates `kyc_records.status` |
| `requestVirtualAccount`, `getVirtualAccounts`  | Out of v1. Interface stub only (`VirtualAccountProvider`); implementation lives in a separate spec |

## 5. Per-feature migration spec

For each feature: current flow, target flow, data model changes, API contract with Zod shape, on-chain handling, idempotency, and edge cases. Token references are polymorphic by mint; USDC is the primary stablecoin at launch, USDT is also receivable as Balance, other SPL tokens render under Investments (separate surface, out of scope here but the read path must already be polymorphic).

### 5.1 Authentication and onboarding

**Current flow.** Mobile collects email, `apiClient.register(email)` or `.authenticate(email)` hits NestJS, NestJS calls `grid.createAccount({ email })` or `grid.initAuth({ email })`, Grid sends an OTP to the email. User enters OTP. Mobile generates session secrets via `gridClient.generateSessionSecrets()`, sends `{ otpCode, sessionSecrets, user }` to NestJS, NestJS calls `grid.completeAuthAndCreateAccount` or `grid.completeAuth`, which creates (or fetches) the Squads smart account, returns `{ data: { address, authentication, ... }}`. NestJS inserts `users` + `smart_accounts(grid_account_id = address)`, returns the Grid response with an added `token` (our JWT).

**Target flow.** Mobile is the OTP UI but delegates the OTP to Privy via the Privy Expo SDK. Privy sends and verifies the OTP; on success the SDK returns a Privy ID token and creates (or fetches) the user's embedded Solana wallet. Mobile sends the Privy ID token to NestJS `POST /auth/exchange`, NestJS verifies the token against Privy's JWKS, upserts `users(privy_user_id, email)` and `smart_accounts(user_id, wallet_address, provider='privy', provider_user_id=privy_user_id)`, and returns our own JWT for subsequent API calls. The JWT payload drops `gridAccountId` and uses `walletAddress` instead.

**Data model changes.**

```ts
// drizzle schema diff
// users: unchanged on the surface, but now linked by privy_user_id
// smart_accounts: rename grid_account_id → wallet_address, add provider + provider_user_id

export const walletProviderEnum = pgEnum('wallet_provider', ['privy']);
// future-proof: keep enum, easy to add 'turnkey' / 'crossmint' later

export const smartAccounts = pgTable('smart_accounts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().unique().references(() => users.id),
  walletAddress: text('wallet_address').notNull().unique(), // Solana pubkey
  provider: walletProviderEnum('provider').notNull().default('privy'),
  providerUserId: text('provider_user_id').notNull().unique(), // Privy user ID
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

**Internal API contract.**

```ts
// POST /auth/exchange  (replaces /register, /auth, /verify-otp, /verify-otp-and-create-account)
const ExchangeRequest = z.object({
  privyIdToken: z.string().min(1),
});
const ExchangeResponse = z.object({
  token: z.string(),               // our JWT
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    walletAddress: z.string(),
    isNewUser: z.boolean(),
  }),
});

// Errors:
//   401 INVALID_PRIVY_TOKEN
//   422 EMAIL_MISMATCH       (Privy returns a different email than expected)
//   502 PRIVY_UNAVAILABLE
```

**On-chain confirmation handling.** None at this step. Privy's embedded wallet is a Solana keypair, not an on-chain smart account, so there is nothing to confirm on chain at signup. The wallet exists as a base58 pubkey from the moment Privy returns it. The first on-chain artifact appears only when the Consumer receives or sends.

**Idempotency.** `POST /auth/exchange` is idempotent on `privy_user_id`. Replaying with the same Privy ID token returns the same `users` row and the same JWT contents (the token itself may differ because of `iat`, but the embedded fields do not). `isNewUser` is true only on the row-insert path.

**Edge cases and failure modes.**

- Privy outage: `502 PRIVY_UNAVAILABLE`, mobile retries with backoff, no DB writes.
- Email mismatch between Privy and any client-supplied hint: trust Privy, drop the hint.
- Privy ID token replay across devices: allowed by design; Privy passkeys sync via iCloud Keychain / Google Password Manager, matching today's Recovery story.
- Concurrent first-login from two devices: row insert is `ON CONFLICT (privy_user_id) DO NOTHING RETURNING *`, then re-select.

### 5.2 Account creation

**Current flow.** Account creation is folded into OTP verification: Grid creates the Squads smart account during `completeAuthAndCreateAccount`. The standalone `POST /create-smart-account` BFF route exists but is dead in the live path; mobile sets it up only as a legacy fallback. The result is a Squads multisig with a Turnkey-MPC-held signer.

**Target flow.** Account creation is folded into Privy's wallet creation, which happens inside `POST /auth/exchange`. No standalone create-account endpoint. The "account" is a single Solana keypair held by Privy, exposed to the Consumer as their **Account** (`CONTEXT.md` term). No multisig, no separate signer abstraction. If we later want a multisig, the `WalletProvider` interface allows for it (`createAccount` returns `{ address, isMultisig: boolean }`); for Privy it is `false`.

**Data model changes.** Covered in 5.1. No standalone table for accounts beyond `smart_accounts` (kept for naming continuity with the codebase term, even though "smart" is now historical).

**Internal API contract.** No new endpoint. Result is included in `ExchangeResponse.user.walletAddress`.

**Edge cases.** Privy wallet creation failures are rare but possible. Surface as `502 PRIVY_WALLET_CREATE_FAILED`; do not insert `smart_accounts`; allow retry on next exchange.

### 5.3 USDC receipt (on-chain only in v1)

**Current flow.** Two paths exist on Grid: (a) the on-chain receive address is the Squads smart account pubkey, displayed in the Cash screen; receives show up in `getTransfers`. (b) virtual-account on-ramp via Bridge through `requestVirtualAccount` / `getVirtualAccounts`. Path (b) is out of v1 (see section 9 decision); path (a) stays.

**Target flow.** The receive address is the Privy wallet pubkey. Mobile fetches it via `GET /wallet/me`. Display + QR code use it directly; SPL token receives land in the associated token account (ATA) for each mint and are surfaced through the activity feed (5.6) and balance (5.5). The receiver does not need a pre-existing ATA: senders create it on first transfer, our send path does the same when sending out (5.4). No fiat path in v1.

**Internal API contract.**

```ts
// GET /wallet/me
const WalletResponse = z.object({
  walletAddress: z.string(),       // Solana pubkey (base58)
  provider: z.literal('privy'),    // hint, not required by client
});
```

**On-chain confirmation handling.** Inbound transfers are picked up by the RPC tailer (5.6); no synchronous confirmation in the receive path.

**Idempotency.** Trivially idempotent. Reads only.

**Edge cases.**

- SOL receipt (gas) versus SPL token receipt: both land at the wallet, but Balance only sums recognized stablecoin mints (USDC + USDT). Non-stablecoin SPL receives appear under the Investments tab (out of scope, but the activity feed records them).
- Sending to a Privy address that has no ATA for the mint: the sender's transfer instruction must include the create-ATA instruction. Out of scope as a *receive* concern; covered in 5.4.

### 5.4 Transfers (send)

**Current flow.** Mobile calls `EasClient.preparePaymentIntent(payload, addr, true)` against the BFF, which calls `grid.createPaymentIntent(addr, payload)`, returning a `transactionPayload`. Mobile signs locally with `gridClient.sign({ sessionSecrets, session: user.authentication, transactionPayload })`. Mobile calls `EasClient.confirmPaymentIntent({ signedTransactionPayload, address })` against the BFF, which calls `grid.send(...)` and returns a signature. Nothing is written to Postgres on this path. If the 15-minute Turnkey API key expired, `confirm+api.ts` maps `API_KEY_EXPIRED` to `SESSION_EXPIRED` and the mobile logs the Consumer out.

**Target flow.** The backend builds the SPL token transfer instruction (with create-ATA-if-needed for the recipient), assembles the unsigned transaction with a recent blockhash from Helius, and returns the serialized message plus a server-issued `intentId`. Mobile signs the message via Privy (`signTransaction` or `signAndSendTransaction`), returns the signature to the backend, the backend submits via Helius RPC `sendTransaction`, persists a `transfers` row in `PENDING` status keyed by the signature, returns. The RPC tailer confirms or fails it. Balance does not move until confirmation; the **Activity** row appears immediately as Pending and flips to Sent or Failed when the tailer lands.

If the Privy session has expired between prepare and submit, the SDK silently re-authenticates the Consumer via a passkey prompt (per section 9 decision; no force-logout). The backend never sees this; from its perspective the next `signTransaction` succeeds.

**Data model changes.** Rename `transactions` → `transfers` to match the domain language (Spend / Receive umbrella concepts collapse to a Transfer at the chain layer; the user-facing **Activity** is built on top). Add `intentId` to support idempotent prepare/submit pairing.

```ts
export const transferStatusEnum = pgEnum('transfer_status', [
  'PENDING', 'CONFIRMED', 'FAILED'
]);
export const transferDirectionEnum = pgEnum('transfer_direction', [
  'SEND', 'RECEIVE'
]);

export const transfers = pgTable('transfers', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  smartAccountId: text('smart_account_id').notNull().references(() => smartAccounts.id),
  intentId: text('intent_id').unique(),   // null for RECEIVE rows reconciled from chain
  signature: text('signature').unique(),  // present once submitted
  direction: transferDirectionEnum('direction').notNull(),
  mint: text('mint').notNull(),           // SPL mint address (USDC, USDT, etc.)
  amountRaw: text('amount_raw').notNull(),// integer string at mint decimals (no float)
  fromAddress: text('from_address').notNull(),
  toAddress: text('to_address').notNull(),
  status: transferStatusEnum('status').notNull().default('PENDING'),
  slot: bigint('slot', { mode: 'bigint' }),
  memo: text('memo'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  submittedAt: timestamp('submitted_at'),
  confirmedAt: timestamp('confirmed_at'),
  failureReason: text('failure_reason'),  // not surfaced to UI today, kept for ops
});
```

**Internal API contract.**

```ts
// POST /transfers/prepare
const PrepareRequest = z.object({
  toAddress: z.string(),                         // Solana pubkey or pre-resolved SNS owner
  mint: z.string(),                              // SPL mint address
  amountRaw: z.string().regex(/^\d+$/),          // integer at mint decimals
  memo: z.string().max(120).optional(),
});
const PrepareResponse = z.object({
  intentId: z.string(),
  unsignedTxBase64: z.string(),                  // serialized v0 message
  feeLamports: z.number().int().nonnegative(),
  expiresAt: z.string().datetime(),              // blockhash lifetime upper bound
});

// POST /transfers/submit
const SubmitRequest = z.object({
  intentId: z.string(),
  signedTxBase64: z.string(),                    // mobile-signed via Privy
});
const SubmitResponse = z.object({
  transferId: z.string(),
  signature: z.string(),
  status: z.literal('PENDING'),
});

// GET /transfers?cursor=<id>&limit=<n>
const TransferRow = z.object({
  id: z.string(),
  direction: z.enum(['SEND', 'RECEIVE']),
  mint: z.string(),
  amountRaw: z.string(),
  fromAddress: z.string(),
  toAddress: z.string(),
  status: z.enum(['PENDING', 'CONFIRMED', 'FAILED']),
  signature: z.string().nullable(),
  memo: z.string().nullable(),
  createdAt: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable(),
});

// Errors:
//   400 INVALID_RECIPIENT          (not a valid pubkey, or self-send)
//   400 UNSUPPORTED_MINT           (mint not in our known set for v1)
//   402 INSUFFICIENT_BALANCE
//   409 INTENT_ALREADY_SUBMITTED   (idempotency)
//   410 INTENT_EXPIRED             (blockhash past)
//   502 RPC_UNAVAILABLE
```

**On-chain confirmation handling.** The RPC tailer (a Kafka producer that consumes Helius webhooks for our wallet addresses, or polls `getSignatureStatuses` for outstanding signatures) updates `transfers.status`, `transfers.slot`, `transfers.confirmedAt` on `confirmed` commitment. We do not surface finalized commitment to the UI; the **Spend Status** model in `CONTEXT.md` collapses Solana's commitment levels into Pending / Sent / Failed. Confirmation is `confirmed`-level by default; this matches "fast enough for consumer UX without waiting for `finalized`" and is documented as a deliberate decision.

**Idempotency.**

- `prepare` is non-idempotent on its own (each call returns a fresh `intentId` and a fresh blockhash) but cheap.
- `submit` is idempotent on `intentId`: a duplicate submit returns the existing `transferId` and signature with the current status.
- `transfers.signature` has a unique index; double-submit at the RPC level coalesces.
- The tailer is idempotent: it transitions PENDING → CONFIRMED or PENDING → FAILED only, never the reverse.

**Edge cases and failure modes.**

- Blockhash expired before submit: backend returns `410 INTENT_EXPIRED`; mobile reissues `prepare`. UX shows "Try again" without leaving the confirm screen.
- Privy session expired between prepare and submit: handled in the SDK with a silent passkey prompt; backend never sees this. If the prompt fails (user cancels), mobile shows "Sign again" and does not return to login.
- RPC submit succeeds but our tailer never sees confirmation (network partition, dropped webhook): the next poll loop reads `getSignatureStatuses` for any PENDING transfer older than 30 seconds and reconciles.
- Recipient ATA missing for the mint: the prepare path inserts `createAssociatedTokenAccountInstruction` before the transfer instruction. The fee for ATA creation is paid by the sender (small SOL cost from the smart account; the Consumer is not told about this in copy because **Cash** is fiat-framed, but ops will see it in the slot data).
- SOL balance too low to pay fees: `402 INSUFFICIENT_BALANCE`. A future revision will fund the wallet with a small SOL airdrop on first receive; out of scope here.
- Spend Limit (`CONTEXT.md`) enforcement: checked in `transfers/prepare` before assembling the transaction; not chain-enforced. Out of explicit scope, but the prepare endpoint is the correct insertion point.

### 5.5 Balance

**Current flow.** Mobile calls `EasClient.getBalance({ smartAccountAddress })` against the BFF; BFF calls `grid.getAccountBalances(addr)`. Mobile filters `balances.tokens` by `EXPO_PUBLIC_USDC_MINT_ADDRESS` and renders the USDC amount. `CACHED_BALANCE` is kept in SecureStore for paint-before-fetch.

**Target flow.** Mobile calls `GET /wallet/me/balances`. Backend reads token accounts directly from Helius RPC (`getTokenAccountsByOwner`), filters to recognized stablecoin mints (USDC, USDT to start), returns balances at native decimals. Mobile sums into a single Balance figure for v1; when multi-balance lands, the headline becomes Total Balance per `CONTEXT.md`. The same endpoint returns all token balances (including non-stablecoin) so the Investments tab can render them; the spec freezes only the response shape, not which mints to render in Cash.

**Internal API contract.**

```ts
// GET /wallet/me/balances
const TokenBalance = z.object({
  mint: z.string(),
  amountRaw: z.string(),       // integer at mint decimals
  decimals: z.number().int(),
  symbol: z.string().nullable(),
});
const BalancesResponse = z.object({
  walletAddress: z.string(),
  tokens: z.array(TokenBalance),
  fetchedAtSlot: z.number().int(),
});
```

**On-chain confirmation handling.** Balance is read on demand from chain. Non-optimistic is preserved by construction: there is no write path to balance state on the backend, ever. The cached value on the device is paint-only and is replaced on first successful fetch.

**Idempotency.** Read-only.

**Edge cases.**

- Helius rate-limited or down: backend falls back to public mainnet RPC. If both fail, return `503 RPC_UNAVAILABLE` and the mobile shows the cached value with a "stale" badge (UX detail TBD with design).
- Token accounts not yet created for a recognized mint: treated as zero balance, no error.
- Slot reorg between read and use: irrelevant for display; the next fetch corrects.

### 5.6 Activity (transaction history)

This section is the **hybrid** approach you confirmed: backend's `transfers` table is canonical for sends we initiated; for receives we did not initiate, the RPC tailer indexes them into the same table on confirmation.

**Current flow.** Mobile calls `EasClient.getTransfers(addr)` against the BFF; BFF calls `grid.getTransfers(addr)`. The list is Grid-derived. Nothing is written to our DB on the live send path.

**Target flow.** Two writers feed the `transfers` table:

1. **Send path** (5.4): writes `transfers` row on `POST /transfers/submit` in PENDING.
2. **Receive path**: the Solana RPC tailer subscribes to our wallet addresses via Helius webhooks (or `logsSubscribe` over WebSocket as a fallback). On each confirmed token transfer where our wallet is the destination, the tailer inserts a row with `direction='RECEIVE'`, `status='CONFIRMED'`, the signature, and the slot. Idempotency is the unique index on `signature`.

The tailer also reconciles outbound: PENDING rows older than 30 seconds get polled via `getSignatureStatuses` and finalized or marked failed. This catches dropped webhooks.

The activity feed endpoint reads only from our `transfers` table. There is no live-read fallback to chain at request time; the tailer is the single source of read-side truth.

**Data model changes.** Already covered in 5.4.

**Internal API contract.** `GET /transfers?cursor=&limit=` returns `transfers` rows in reverse chronological order (mixing SEND and RECEIVE), paginated by `(createdAt, id)` cursor.

**On-chain confirmation handling.** All chain-derived state lives in the tailer. Mobile is never asked to verify a transaction on chain. Re-orgs at the `confirmed` level are vanishingly rare and we do not handle them in v1; the worst case is a row marked CONFIRMED that subsequently dropped, which the next reconciliation pass would re-mark FAILED. The risk is acknowledged and accepted.

**Idempotency.** Tailer writes are `ON CONFLICT (signature) DO UPDATE SET status, confirmedAt, slot` (status transitions guarded so we never go backwards from CONFIRMED/FAILED to PENDING). Receive-side `intent_id` is null and not constrained.

**Edge cases.**

- The same signature appearing as both a SEND we wrote and a RECEIVE the tailer indexes (self-send, currency conversion routed back to us): unique on `signature` collapses to one row. Self-sends are blocked at `prepare` (`INVALID_RECIPIENT`).
- Backfill on a fresh install: out of scope (greenfield, no users with history). When we have users with history later, an indexer backfill job seeded from `getSignaturesForAddress` is the seam.
- Tailer downtime: `getSignaturesForAddress` since the last indexed slot recovers everything on restart.

### 5.7 KYC

**Current flow.** Mobile calls `EasClient.getKYCLink(params)` against the BFF; BFF calls `grid.requestKycLink(addr, { type: 'individual', endorsements: [] })`. Grid returns a Bridge-hosted KYC URL + a TOS URL. Mobile opens the KYC URL, stores `kyc_link_id` in `MockDatabase` (device-local SecureStore), and polls `getKycStatus(addr, kycId)` for status. On approval, `useKyc.checkStatus` fires `fetchBankDetails`, which is the entry into the virtual account flow.

**Target flow.** Backend integrates Sumsub directly. `POST /kyc/start` creates a Sumsub applicant tied to the Consumer (using their email and any required identifying data), generates an access token, returns it to the mobile app. Mobile opens the Sumsub flow (SDK or web; Sumsub supports both, exact choice deferred to implementation). Sumsub posts state changes to a backend webhook at `POST /webhooks/sumsub`, signed with Sumsub's HMAC secret; backend updates `kyc_records.status`. Mobile polls `GET /kyc/me` for status. The "approval triggers virtual account" coupling is removed for v1 because virtual accounts are out of scope; the hook returns to be reintroduced when the virtual-account spec lands.

**Data model changes.**

```ts
export const kycStatusEnum = pgEnum('kyc_status', [
  'NOT_STARTED', 'IN_PROGRESS', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED'
]);

export const kycRecords = pgTable('kyc_records', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().unique().references(() => users.id),
  sumsubApplicantId: text('sumsub_applicant_id').notNull().unique(),
  status: kycStatusEnum('status').notNull().default('NOT_STARTED'),
  reviewResult: text('review_result'),   // raw Sumsub reasonCode for ops
  startedAt: timestamp('started_at'),
  decidedAt: timestamp('decided_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

The KYC link ID moves off the device. `MockDatabase` is deleted; the per-user Sumsub applicant ID lives in `kyc_records.sumsubApplicantId`.

**Internal API contract.**

```ts
// POST /kyc/start
const StartKycRequest = z.object({});  // user identified by JWT
const StartKycResponse = z.object({
  accessToken: z.string(),   // Sumsub WebSDK access token (short-lived)
  applicantId: z.string(),
  status: z.enum(['NOT_STARTED','IN_PROGRESS','UNDER_REVIEW','APPROVED','REJECTED','EXPIRED']),
});

// GET /kyc/me
const KycStatusResponse = z.object({
  status: z.enum(['NOT_STARTED','IN_PROGRESS','UNDER_REVIEW','APPROVED','REJECTED','EXPIRED']),
  decidedAt: z.string().datetime().nullable(),
});

// POST /webhooks/sumsub  (Sumsub-signed; not called by mobile)
//   signature header verified against SUMSUB_WEBHOOK_SECRET
//   maps reviewStatus + reviewResult into kyc_status enum

// Errors:
//   422 KYC_ALREADY_APPROVED      (client tried to restart after success)
//   502 KYC_PROVIDER_UNAVAILABLE
```

**On-chain confirmation handling.** Not applicable.

**Idempotency.** `POST /kyc/start` upserts on `(user_id)`. Repeating returns the same applicant with a fresh access token. Webhook is idempotent on the Sumsub event ID (which we also store, omitted from schema sketch above for brevity).

**Edge cases.**

- Webhook delayed / lost: mobile poll on `GET /kyc/me` reconciles by re-asking Sumsub `getApplicantStatus` if the cached state is stale (older than N seconds and the client thinks it should have a decision).
- User re-uploads after rejection: Sumsub handles, status returns to `IN_PROGRESS`.
- Sandbox vs production: `useKyc.ts` today fakes TOS approval in sandbox by hard-coding `'approved'`; we drop that hack since Sumsub has its own sandbox environment.

### 5.8 Virtual account (deferred)

Listed for completeness; implementation lives in a follow-up spec. The boundary the v1 spec must preserve:

- A `VirtualAccountProvider` interface exists in section 6 with `requestAccount`, `getAccounts`, `getAccount` methods, parameterized by currency and Consumer ID.
- The `kyc` module exposes a `subscribeToApproval(userId, callback)` seam so the eventual virtual-account creation can be triggered cleanly on approval without re-wiring KYC code.
- No `virtual_accounts` table is introduced in v1; the table shape belongs to that later spec.

## 6. Interfaces we own

These are the anti-lock-in seams. Method signatures only; implementations live in adapter packages.

```ts
// apps/backend/src/wallet/wallet-provider.interface.ts

export type WalletAddress = string;       // Solana pubkey (base58)
export type ProviderUserId = string;

export interface WalletProviderUser {
  providerUserId: ProviderUserId;
  email: string;
  walletAddress: WalletAddress;
}

export interface SignatureRequest {
  unsignedTxBase64: string;
  walletAddress: WalletAddress;
}

export interface WalletProvider {
  /** Verify a provider-issued ID token (e.g. Privy JWT) and return the user. */
  verifyIdToken(idToken: string): Promise<WalletProviderUser>;

  /** Read a user's current wallet (provider-side; may differ from our cache). */
  getUser(providerUserId: ProviderUserId): Promise<WalletProviderUser>;

  /**
   * Optional: server-side signing for non-passkey flows (e.g. system-initiated
   * batch transactions). Not used in v1; declared so adapters that support it
   * (Turnkey) can fulfil it later.
   */
  signTransaction?(req: SignatureRequest): Promise<string>;
}

// apps/backend/src/solana/solana-rpc.interface.ts

export interface TokenBalance {
  mint: string;
  amountRaw: bigint;
  decimals: number;
}

export interface SignatureStatus {
  signature: string;
  slot: bigint | null;
  confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
  err: unknown | null;
}

export interface SolanaRpc {
  getRecentBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  getTokenBalances(owner: WalletAddress): Promise<TokenBalance[]>;
  sendRawTransaction(signedTxBase64: string): Promise<string>;
  getSignatureStatuses(signatures: string[]): Promise<SignatureStatus[]>;
  /** Async iterator over confirmed transactions for an owner since a slot. */
  streamConfirmedTransfers(
    owner: WalletAddress,
    sinceSlot: bigint
  ): AsyncIterable<{
    signature: string;
    slot: bigint;
    mint: string;
    amountRaw: bigint;
    fromAddress: WalletAddress;
    toAddress: WalletAddress;
  }>;
}

// apps/backend/src/kyc/kyc-provider.interface.ts

export type ApplicantId = string;

export type KycStatus =
  | 'NOT_STARTED' | 'IN_PROGRESS' | 'UNDER_REVIEW'
  | 'APPROVED'    | 'REJECTED'    | 'EXPIRED';

export interface KycApplicant {
  applicantId: ApplicantId;
  status: KycStatus;
  reviewResult: string | null;
  decidedAt: Date | null;
}

export interface KycAccessToken {
  accessToken: string;
  expiresAt: Date;
}

export interface KycProvider {
  createApplicant(input: { userId: string; email: string }): Promise<KycApplicant>;
  getApplicant(applicantId: ApplicantId): Promise<KycApplicant>;
  issueAccessToken(applicantId: ApplicantId): Promise<KycAccessToken>;

  /** Verify a webhook signature; throws on mismatch. */
  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string>): void;

  /** Parse a verified webhook body into a status update. */
  parseWebhookEvent(rawBody: Buffer): {
    eventId: string;
    applicantId: ApplicantId;
    status: KycStatus;
    reviewResult: string | null;
    decidedAt: Date | null;
  };
}

// apps/backend/src/virtual-account/virtual-account-provider.interface.ts
// (interface only in v1; no implementation until the follow-up spec)

export interface VirtualAccount {
  id: string;
  currency: string;             // ISO-4217 (e.g. 'NGN', 'USD')
  accountNumber: string;
  bankName: string;
}

export interface VirtualAccountProvider {
  requestAccount(input: {
    userId: string;
    walletAddress: WalletAddress;
    currency: string;
  }): Promise<VirtualAccount>;

  getAccounts(walletAddress: WalletAddress): Promise<VirtualAccount[]>;
}
```

## 7. Existing-user / data migration

Greenfield. The product has not gone live and no Consumer has funds in any existing Grid smart account. Concretely:

- No on-chain balance migration is required. There is nothing to drain.
- No key handoff from Grid or Turnkey is required. We do not need Squads' cooperation.
- Postgres `smart_accounts` rows from any local development environments are dropped on the Drizzle migration that renames `grid_account_id` to `wallet_address` (the migration is intentionally non-reversible for this column to make the cutover obvious).
- Mobile SecureStore is wiped on first launch of the new build, gated by an `AUTH_STORAGE_KEYS.MIGRATION_DONE` marker. All Grid-shaped keys listed in section 3 are removed; provider-neutral keys (`auth_user`, `auth_email`, etc.) are also cleared since their values are now Grid-derived and meaningless. Result: first launch of the new app is identical to a fresh install.
- The `MockDatabase` SecureStore blob is removed entirely.
- The committed `apps/backend/.env` Grid API key is rotated by virtue of Grid being decommissioned; the JWT secret is rotated as part of the cutover (every existing token becomes invalid, which is fine because there are no existing users).

What this means for the spec: the migration is purely code-level. Sequencing in section 8 reflects this.

## 8. Sequencing

Each phase is independently shippable to dev / sandbox and reversible by code-level revert. Mainnet only happens at the end.

### Phase 0: scaffolding (no behaviour change)

- Create the interfaces in section 6 and stub adapters (e.g. `PrivyAdapter` that throws on every method).
- Add a feature flag in mobile (`EXPO_PUBLIC_USE_NEW_STACK`) defaulting off.
- Verifiable on devnet: nothing user-visible. Lint, type, and existing tests still pass.

### Phase 1: backend wallet plumbing (no mobile change yet)

- Implement `PrivyAdapter` against Privy's server SDK: `verifyIdToken`, `getUser`.
- Implement `HeliusAdapter` for `SolanaRpc.getRecentBlockhash`, `getTokenBalances`, `sendRawTransaction`, `getSignatureStatuses`. Implement `PublicMainnetAdapter` as fallback. Wire a small failover wrapper (`tryPrimaryThenFallback`).
- Add NestJS modules: `wallet`, `solana`, `transfer`. Implement `POST /auth/exchange`, `GET /wallet/me`, `GET /wallet/me/balances`, `POST /transfers/prepare`, `POST /transfers/submit`, `GET /transfers`.
- Drizzle migration: rename `grid_account_id` to `wallet_address` and add `provider`, `provider_user_id`; rename `transactions` to `transfers` and add `intent_id`, `direction`, `mint`, `amount_raw` (drop `amount`, `token`).
- Verifiable on devnet: cURL-driven end-to-end against a manually-created Privy test user. Send a USDC transfer, watch it confirm.

### Phase 2: Solana RPC tailer + activity reconciliation

- Stand up the tailer as a long-running Nest service or a separate small worker (decision: in-process is fine for v1; promote to a worker if it grows). Helius webhooks primary, `getSignaturesForAddress` poll fallback for missed events.
- Implement `transfers` write path from the tailer; verify outbound PENDING transfers transition to CONFIRMED; verify inbound RECEIVE rows appear after a devnet airdrop.
- Verifiable on devnet: induce a dropped webhook, confirm reconciliation picks it up within 30 seconds.

### Phase 3: KYC via Sumsub

- Implement `SumsubAdapter`. Add `kyc_records` table. Implement `POST /kyc/start`, `GET /kyc/me`, `POST /webhooks/sumsub`.
- Verifiable on Sumsub sandbox: walk a test applicant through the canned approval / rejection flows.

### Phase 4: mobile cutover (behind feature flag)

- Add `@privy-io/expo`. Wire signup / login screens to Privy; `POST /auth/exchange` to backend on success.
- Replace `EasClient` with a single `apiClient` covering every endpoint. Delete `easClient.ts`.
- Replace KYC and balance flows. Replace `useWalletData` to call backend, not BFF.
- Replace `(send)` flow to go `prepare` → Privy sign → `submit`.
- Wipe SecureStore on first launch under the flag.
- Verifiable on dev: full mobile flow against the dev backend, end to end.

### Phase 5: delete the BFF and the Grid SDK

- Delete `apps/mobile/app/api/` (keep `sentry+api.ts`).
- Delete `apps/mobile/grid/`.
- Remove `@sqds/grid` and `@sqds/grid-react-native` from both packages.
- Remove `GRID_API_KEY`, `EXPO_PUBLIC_GRID_ENDPOINT`, `EXPO_PUBLIC_GRID_ENV`. Remove the Grid env handling from `useKyc.ts`.
- Remove dead deps: `@hpke/*`, `@noble/*`, `@stablelib/*`, `ethers`, `@solana/spl-token`, `@ethersproject/shims` import in `entrypoint.js` (verify with one final grep before deleting).
- Delete `apps/mobile/utils/easClient.ts`, `apps/mobile/utils/smartAccount.ts`, `apps/mobile/utils/mockDatabase.ts`, Grid-shaped exports in `apps/mobile/utils/auth.ts`, and the Grid module under `apps/backend/src/grid/`.
- Verifiable: full mobile flow on devnet against the production backend stack. No `@sqds` import anywhere.

### Phase 6: mainnet cutover

- Flip `EXPO_PUBLIC_GRID_ENV` decommissioning is complete (env removed). Move Helius primary key out of source and into runtime config (this also closes the existing leak in `apps/mobile/utils/solana.ts`).
- Rotate `JWT_SECRET`. Rotate any other secrets in `apps/backend/.env`.
- Cut the release.

Reversibility note: phases 0-4 are reversible by reverting code. Phase 5 deletes load-bearing code; the safe rollback after phase 5 is "fix forward". Phase 6 is the point of no return on Grid.

## 9. Open decisions

Closed decisions are recorded here for traceability.

### Closed

| Decision                          | Resolution                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wallet provider                   | **Privy.** Trade-off accepted: Privy treats Solana as a secondary chain historically (Ethereum-first), so we monitor SDK feature parity. Mitigated by the `WalletProvider` interface; swapping to Turnkey or Crossmint later is a single adapter swap on the backend plus an SDK swap on the device. Turnkey would give us the most signing control if we later need server-initiated batch operations. |
| BFF vs backend boundary           | **Backend only.** The expo-router BFF is deleted entirely. Mobile talks to NestJS. Removes the `GRID_API_KEY`-on-device problem and matches "no single provider load-bearing in the app process".                                                                                                                                                                                                       |
| Existing user / data migration    | **Greenfield.** No live users, no balances, no key handoff.                                                                                                                                                                                                                                                                                                                                             |
| Activity feed source              | **Hybrid.** Our `transfers` table is canonical; RPC tailer fills RECEIVEs. Send path writes on submit, tailer confirms.                                                                                                                                                                                                                                                                                |
| Solana RPC strategy               | **Helius primary, public mainnet RPC fallback.** Both behind `SolanaRpc` interface. QuickNode / Triton can be added later as additional adapters.                                                                                                                                                                                                                                                       |
| Token scope                       | **Polymorphic by mint.** Balance for v1 sums recognized stablecoin mints (USDC, USDT). Non-stablecoin SPL tokens are visible under the Investments tab (out of v1 scope but data path is shared).                                                                                                                                                                                                       |
| Session lifetime / re-auth        | **Silent re-auth via Privy passkey prompt** when the session expires inside a flow. No force-logout. The current Grid behaviour (logout on `API_KEY_EXPIRED`) is dropped.                                                                                                                                                                                                                              |
| KYC link ID persistence           | **Backend (`kyc_records` table).** `MockDatabase` deleted.                                                                                                                                                                                                                                                                                                                                              |
| Virtual account                   | **Deferred to a follow-up spec.** Interface stub in section 6; v1 ships without it.                                                                                                                                                                                                                                                                                                                     |
| Whether `WalletsController` / `TransactionsController` are dormant scaffolding or real targets | **Real targets.** They are the intended endpoints; mobile being unwired to them is what the migration fixes. They get renamed / reshaped per sections 5.4-5.5 but the modules stay.                                                                                                                                                                                                            |

### Open (for later, not blocking v1)

| Decision                          | Notes                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Virtual account provider          | Iron preferred, BVNK alternative. Resolved in the follow-up spec.                                                                                              |
| Sumsub integration shape          | Native SDK vs WebSDK. Probably WebSDK for v1 simplicity, native SDK if the WebSDK UX feels poor in Expo's `expo-web-browser` shell.                            |
| Worker process for the RPC tailer | In-process Nest service for v1. Promote to a dedicated worker only if it grows beyond ~1000 wallets watched (Helius webhook limits and Postgres write load).   |
| Helius primary key hosting        | Out of source. Probably Doppler / AWS Secrets Manager; choice tracked separately from this spec.                                                               |

## 10. Risks

Ranked by what most threatens v1.

1. **Privy on Solana feature parity.** Privy is historically Ethereum-first. The SDK methods we depend on (`signTransaction`, `signAndSendTransaction`, Solana passkey ceremony) work as documented, but edge cases (versioned transactions, ATA creation in a sign-only flow, blockhash refresh inside a long passkey prompt) are not certain. **Prototype first**: a 1-day spike that prepares a USDC SPL transfer server-side, signs it via Privy in an Expo dev client, and submits via Helius on devnet. Verify ATA-creation-inside-the-instruction works. If it fails, the fallback is Turnkey, which would change the wallet creation flow (server-side wallet pre-creation) but not the rest of the architecture.

2. **RPC tailer reliability.** Helius webhooks are the planned primary signal; missed webhooks are common in practice. The 30-second `getSignatureStatuses` reconciliation is a safety net but adds load. **Prototype first**: run the tailer for 24 hours on devnet against a script that triggers 100 inbound transfers, measure the percentage that reach CONFIRMED only via reconciliation (target: under 5%; over 20% means the webhook path is unreliable and we either escalate with Helius or change strategy).

3. **Sumsub UX inside Expo.** Sumsub's WebSDK opened in `expo-web-browser` has been known to behave oddly with camera permissions on iOS. **Prototype first**: walk one applicant through document capture + selfie on a physical iPhone and a physical Android. If the WebSDK is broken in the in-app browser, fall back to Sumsub's native SDK (more work, no architectural change).

4. **Drizzle migration cuts existing dev databases.** The `grid_account_id` -> `wallet_address` rename plus the `transactions` -> `transfers` rename will break any non-empty local database. Mitigated by greenfield: no production data exists. Document the migration as destructive in the PR.

5. **Helius outage with public-RPC fallback.** Public mainnet RPC is rate-limited; under sustained load it will degrade. Read paths (balance, blockhash) survive degraded service; write paths (`sendTransaction`) may queue. **Mitigation, not prototype**: surface RPC degradation as a banner in the Activity view and disable Send while degraded. Detail belongs in an ops runbook, not in v1 product surface.

6. **Privy session refresh inside a sign flow.** If the SDK's silent passkey re-auth fails (Consumer cancels the prompt), the in-flight transfer cannot be signed. UX needs to recover cleanly without dropping back to login. **Verifiable in the Phase 4 mobile flow**: deliberately let the session expire mid-confirm, cancel the prompt, confirm the user lands back on the confirm screen with a clear retry path, not on `(auth)/login`.

7. **Hidden coupling to Grid response shapes in mobile.** The `EasClient`-side response handling is loose (`any` types, ad-hoc `response.data.tokens` access). Some screens may read fields like `response.data.tos_status` (see `useKyc.ts:120`) that have no Sumsub analogue. **Mitigation**: section 5 specifies Zod schemas for every backend response; mobile uses them, not raw `any`. Catch the surface during Phase 4 by typing every API call and letting TypeScript drive the audit.

8. **Hardcoded Helius URL with API key in source today.** Independent of migration but addressed by Phase 6: move out of source on the cutover.

## Appendix A: out-of-scope features found in the codebase

Per the prompt, the following exist as code or surface but are not part of this migration. They are noted here so they are not accidentally pulled in by anyone implementing this spec.

- **Card issuance**: no code yet, no routes, no schema. Out.
- **Yield**: no code. Out.
- **Swaps**: no code. Out.
- **Confidential transfers / privacy**: HPKE and noble crypto deps exist in `package.json` but no app code imports them. Deleting the deps is part of Phase 5; reintroducing them belongs to whichever future feature actually uses them.
- **Investments tab**: referenced in conversation as the destination for non-stablecoin SPL token balances. The data path (`SolanaRpc.getTokenBalances` returning all mints) is built in v1 to support it; the UI is out.
- **Virtual account on-ramp** (Iron / BVNK): explicitly deferred. Interface stub only.
- **Email / SNS as a send destination**: not in v1; today destinations are Address or SNS-resolved Address only.

## Appendix B: things I am uncertain about

Flagged honestly per the prompt's request.

- **Whether Privy's `signAndSendTransaction` returns control before or after broadcast.** The doc surface suggests it returns the signature after submission; the spec assumes we want to split sign and submit (mobile signs, backend submits via our chosen RPC). The Phase 1 prototype confirms this; if Privy insists on submitting via its own infrastructure, we either accept it (acceptable trade-off: Privy is a transient submission path, not a balance source, so it does not violate the non-optimistic invariant) or use `signTransaction` and ship the signed bytes to our backend.
- **Whether Sumsub's webhook signature verification gives us strong replay protection.** Sumsub provides HMAC signing but not nonce protection out of the box. The spec assumes we store seen `eventId`s; need to confirm Sumsub guarantees unique event IDs across applicants.
- **Whether Helius's enhanced-transactions API decodes SPL token transfers reliably for all wallet activity, or whether we need to fall back to raw transaction parsing.** This affects the RPC tailer's complexity. The Phase 2 verification answers it.
- **Whether the Privy "embedded Solana wallet" we get is a single keypair or a multisig-capable construct.** The spec assumes single keypair. If Privy ships a multisig option for Solana that we want for additional safety, the `WalletProvider` shape already supports it (`createAccount` could return `isMultisig: true`); we would need to add server-side authority management.
