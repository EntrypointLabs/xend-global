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

- Start backend (port `8000`):

```
npm --workspace @xend/backend run dev
```

- Start mobile app (Expo dev tools):

```
npm --workspace @xend/mobile run start
```

- Platform-specific mobile commands:

```
npm --workspace @xend/mobile run android
npm --workspace @xend/mobile run ios
npm --workspace @xend/mobile run web
```

- Run via Turbo with filters (alternative):

```
# Backend dev
npx turbo run dev --filter=@xend/backend

# Mobile start
npx turbo run start --filter=@xend/mobile
```

- Run all available `dev` scripts (note: mobile uses `start`, not `dev`):

```
npm run dev
```

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
