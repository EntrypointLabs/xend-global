# Xend Monorepo (Mobile + Backend)

A Turborepo-managed workspace containing an Expo React Native mobile app (`@xend/mobile`) and a Node-based backend (`@xend/backend`), plus shared configs and a small UI library.

## Structure

- `apps/mobile` (`@xend/mobile`): Expo React Native app (Android/iOS/Web)
  - Scripts: `start`, `android`, `ios`, `web`, `lint`, `test`
  - Notables: `entrypoint.js`, `SETUP.md`, `app/`, `metro.config.js`, `example.env`
- `apps/backend` (`@xend/backend`): Node server (ESM) with TypeScript tooling
  - Scripts: `dev`, `build`, `start`, `lint`, `check-types`
  - Entry: `index.js`
- `packages/ui`: Shared React component library
  - Scripts: `lint`, `generate:component`, `check-types`
- `packages/eslint-config`: Shared ESLint configs
- `packages/typescript-config`: Shared TypeScript configs
- Root scripts (run across workspaces via Turbo): `build`, `dev`, `lint`, `check-types`, `format`

## Prerequisites

- Node `>=18`
- Mobile: Android Studio + JDK (for `android`), Xcode (for `ios`)
- Optional: Watchman (macOS) for faster Metro reloads

## Setup

1. Install dependencies at the repo root:

```
npm install
```

2. Mobile environment file (optional but recommended):

```
cp apps/mobile/example.env apps/mobile/.env
```

## Development

- Run everything with one command (Redis, Kafka with seeded topics, backend, relayer,
  checkout and the mobile Metro bundler):

```
npm run dev
```

It brings Docker up first (starting Docker Desktop on macOS if needed), waits for Redis
and Kafka to report healthy, seeds the payment/payout/session topics, checks that Postgres
is accepting connections and that the service ports are free, and only then starts the
services. Add `--log` to also tee the combined output to `/tmp/xend-dev.log`.

Tasks run with `--continue=always`, so one service falling over leaves the others up
instead of taking down the whole run.

The backend additionally tees its own output to `/tmp/xend-backend.log`, colour-free
(`NO_COLOR=1 FORCE_COLOR=0`) so it stays readable when something other than a terminal
is reading it.

- Infra on its own:

```
npm run infra         # redis + kafka + topic seeding
npm run infra:logs    # follow container logs
npm run infra:down    # stop
npm run infra:reset   # wipe volumes and start clean
```

- Expo on its own, in its own terminal:

```
npm run dev:mobile
```

Metro already runs as part of `npm run dev`, so reach for this when you want Expo's
keyboard shortcuts (`a` for Android, `i` for iOS, `r` to reload). Turbo panes cannot
forward keystrokes to a task unless it is marked `interactive`, and that flag makes the
whole run fail whenever stdout is not a terminal, so it is deliberately not set.

- Platform-specific mobile commands:

```
npm --workspace @xend/mobile run android
npm --workspace @xend/mobile run ios
npm --workspace @xend/mobile run web
```

- A single service (assumes `npm run infra` is already up):

```
npx turbo run dev --filter=@xend/backend
npx turbo run dev --filter=@xend/relayer
npx turbo run dev --filter=@xend/checkout
```

Ports come from each app's `.env`: backend `8008`, relayer `8080`, checkout `443` when the
mkcert certs are present (needs sudo, otherwise Vite falls back to the next free port), and
Metro on `8081`. Debuggers attach on `9229` for the backend and `9230` for the relayer.

## Build & Type Check

- Build all workspaces (primarily affects backend):

```
npm run build
```

- Type checks across the monorepo:

```
npm run check-types
```

- Start backend after build:

```
npm --workspace @xend/backend run start
```

## Linting & Formatting

- Lint across all workspaces:

```
npm run lint
```

- Format common file types:

```
npm run format
```

## Turbo Tips

- Filter tasks to specific apps/packages:

```
npx turbo run <task> --filter=@xend/mobile
npx turbo run <task> --filter=@xend/backend
```

- Remote caching (optional) with Vercel:

```
npx turbo login
npx turbo link
```

## Useful References

- Expo: https://docs.expo.dev
- React Native: https://reactnative.dev/docs
- Turborepo: https://turbo.build/repo/docs
