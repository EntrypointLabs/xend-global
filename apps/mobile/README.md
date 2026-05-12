# @xend/mobile

The Xend mobile app — an Expo React Native client for Android, iOS, and Web. Integrates the [@sqds/grid-react-native SDK](https://www.npmjs.com/package/@sqds/grid-react-native) for authentication, KYC, virtual bank accounts, USDC transfers, and payment history. Pairs with [`@xend/backend`](../backend) for any operations that require server-held credentials.

> Built against Expo SDK 54. Expo Go only supports the latest SDK; use a [development build](https://docs.expo.dev/develop/development-builds/introduction/) for the full feature set.

## Architecture

- **Frontend** uses [`utils/easClient.ts`](utils/easClient.ts) to call backend API routes.
- **Backend routes** under `app/api/` use the Grid SDK via [`grid/sdkClient.ts`](grid/sdkClient.ts).
- **Security**: API keys live in environment variables on the server side and are never exposed to the client.

### SDK client

The Grid SDK is wrapped in a singleton in [`grid/sdkClient.ts`](grid/sdkClient.ts):

```typescript
import { GridClient, GridEnvironment } from "@sqds/grid-react-native";

const gridClient = new GridClient({
  apiKey: process.env.GRID_API_KEY,
  environment: "sandbox" as GridEnvironment,
  baseUrl: process.env.EXPO_PUBLIC_GRID_ENDPOINT,
});

const sessionSecrets = await gridClient.generateSessionSecrets();
```

## Features

- [Email authentication and OTP](docs/authentication.md)
- [Smart account creation](docs/smart-account.md)
- [KYC onboarding](docs/kyc.md)
- [Virtual bank accounts and deposits](docs/deposit.md)
- [Withdrawals](docs/withdraw.md)
- [USDC transfers](docs/usdc-transfers.md)
- [Balance and transfers](docs/balance-and-transfers.md)

## Getting started

Run all commands from the repo root unless noted.

### 1. Install dependencies

```sh
npm install
```

### 2. Configure environment

```sh
cp apps/mobile/example.env apps/mobile/.env
```

Required variables:

```env
# Server-side only — never exposed to the client
GRID_API_KEY=your_grid_api_key_here

# Public — safe for the client bundle
EXPO_PUBLIC_GRID_ENV=sandbox            # or production
EXPO_PUBLIC_API_ENDPOINT=http://localhost:8081/api
EXPO_PUBLIC_BACKEND_URL=http://localhost:3000   # use 10.0.2.2 on Android emulator
EXPO_PUBLIC_USDC_MINT_ADDRESS=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

If you're using EAS, set these as [EAS secrets](https://docs.expo.dev/build-reference/variables/#using-secrets-in-environment-variables).

### 3. Run

```sh
npm --workspace @xend/mobile run start          # Expo dev tools
npm --workspace @xend/mobile run android        # Android device/emulator
npm --workspace @xend/mobile run ios            # iOS simulator
npm --workspace @xend/mobile run web            # Web target
```

Scan the QR code with Expo Go (SDK 54 only) or run on a development build.

## Project structure

```
app/
  (auth)/        # Email + OTP flow
  (tabs)/        # Main authenticated experience
  (send)/        # Send-money flow
  (modals)/      # Shared modal screens
  api/           # Server routes that use the Grid SDK
  cash/          # Cash deposit / withdraw screens
grid/
  sdkClient.ts   # Grid SDK singleton wrapper
components/      # UI primitives (atoms → organisms)
contexts/        # React contexts
hooks/           # Reusable hooks (auth, kyc, transfers, ...)
utils/
  easClient.ts   # Typed client for backend API routes
docs/            # Feature-level docs (auth, kyc, transfers, etc.)
```

## App flow

1. **Authenticate** with email and OTP.
2. **Complete KYC** and accept the Terms of Service.
3. **Create a virtual bank account** for fiat deposits.
4. **Send and receive** USDC and fiat via the in-app flows.

## Troubleshooting

- **Env changes not picked up?** Restart Expo after editing `.env` or EAS secrets.
- **Localhost unreachable from device?** Replace `localhost` with your machine's LAN IP in `EXPO_PUBLIC_API_ENDPOINT` / `EXPO_PUBLIC_BACKEND_URL`. On Android emulator, use `10.0.2.2`.
- **SDK connection errors?** Double-check `GRID_API_KEY` and that `EXPO_PUBLIC_GRID_ENV` matches the environment your key was issued for.
- **Expo Go can't connect?** Open the dev server directly via `exp://<your-ip>:8081` on the device, on the same network.
- **Stale bundler state?** `npx expo start -c` clears the cache.

## References

- [@sqds/grid-react-native SDK](https://www.npmjs.com/package/@sqds/grid-react-native)
- [Expo docs](https://docs.expo.dev/)
- [Expo CLI](https://docs.expo.dev/workflow/expo-cli/)
