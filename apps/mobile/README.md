# @xend/mobile

The Xend app: an Expo React Native client for Android and iOS. It talks to [`@xend/backend`](../backend) over HTTPS with a Xend-issued token. The passkey and the embedded Solana wallet behind it are held by Privy and reached through `hooks/usePasskey.ts`; the phone's hardware key is enrolled with Turnkey through `modules/hardware-key`; the Account itself is a Squads smart account (ADR 0025).

Built against Expo SDK 56 (ADR 0011). Use a [development build](https://docs.expo.dev/develop/development-builds/introduction/); Expo Go cannot load the native modules.

## What is in the app

Routes live under `app/` (expo-router).

- **Sign-up and sign-in** (`(auth)/`, `add-email.tsx`): email first, then a passkey, then the phone's hardware key, then the Account (ADR 0027). An email code on an existing Account opens a read-only entry session; the passkey opens a full one.
- **Home and Cash** (`(tabs)/index.tsx`, `cash/`): the Balance, read from the Account's vault.
- **Send** (`(send)/`): to an address, a `.sol` name or a Contact; under the daily limit one passkey signature, above it the phone's key as well.
- **Receive**: address and QR from the Cash surface.
- **Activity** (`(tabs)/history.tsx`): the unified feed, including merchant Payments and Account events.
- **Settings** (`(tabs)/settings/`): address book, spending limits, Keys and Recovery (add and remove recovery emails and wallets, review and reject a staged change), replace a lost passkey, restore onto a new phone, connected Merchants with Session revocation, finish an above-limit Payment a Merchant is waiting on.
- **Investments and Swap** (`investments/`, `swap/`): the non-spending tokens the Consumer holds, and a quoted swap between them.
- **Previews**: `earn/`, `card/` and `plus/` render surfaces whose backing does not exist yet. See section 9 of `docs/xend-master-context.md` before describing them anywhere.
- **KYC** (`(modals)/kyc.tsx`, `app/api/kyc*.ts`): the one remaining Grid SDK carve-out, behind `GRID_API_KEY`.

## Running

From the repo root:

```sh
npm install
cp apps/mobile/example.env apps/mobile/.env
npm run dev:mobile                              # expo start
npm --workspace @xend/mobile run android
npm --workspace @xend/mobile run ios
```

`npm run dev` at the root starts Metro alongside the backend; see the root README for ports. Tests are `npm --workspace @xend/mobile run test`; types `check-types`; lint `lint`.

## Environment

`example.env` is the template. Every `EXPO_PUBLIC_*` value ships in the bundle.

| Variable                        | What it is                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_BACKEND_URL`       | The backend, `http://localhost:8000` locally; `10.0.2.2` on the Android emulator                                |
| `EXPO_PUBLIC_PRIVY_APP_ID`      | Privy app id, the same value as the backend's `PRIVY_APP_ID`                                                    |
| `EXPO_PUBLIC_PRIVY_CLIENT_ID`   | Privy client id for native builds                                                                               |
| `EXPO_PUBLIC_USDC_MINT_ADDRESS` | The USDC mint. Must match the backend and the cluster; `utils/cluster.ts` rejects a mint from the other network |
| `EXPO_PUBLIC_USDT_MINT_ADDRESS` | Optional; mainnet only, adds USDT to the headline Balance                                                       |
| `EXPO_PUBLIC_SOLANA_RPC_URL`    | RPC for `.sol` resolution; never embed a provider key                                                           |
| `EXPO_PUBLIC_DISABLE_APP_LOCK`  | Dev-only, skips the biometric app lock in dev builds                                                            |
| `EXPO_PUBLIC_GRID_ENV`          | `sandbox` or `production`, KYC carve-out only                                                                   |
| `GRID_API_KEY`                  | Server-side only, KYC carve-out                                                                                 |
| `SENTRY_DNS_URL`                | Optional error reporting                                                                                        |

`utils/cluster.ts` reads `EXPO_PUBLIC_SOLANA_CLUSTER` and **defaults to mainnet**; set it to `devnet` for a devnet build. It is not in `example.env` yet, so a copied `.env` with the devnet mint and no cluster value targets mainnet and logs a mint mismatch.

## Conventions

Styling is NativeWind `className` only; see [`STYLE.md`](./STYLE.md) and ADRs 0001 to 0009. The domain vocabulary is [`CONTEXT.md`](../../CONTEXT.md).
