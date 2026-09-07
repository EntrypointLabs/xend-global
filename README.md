# xend

The Xend monorepo: the consumer app, the NestJS backend behind it, the fee-payer relayer, the hosted Pay with Xend checkout, and the packages they share. Turborepo over npm workspaces (`apps/*`, `packages/*`; root package name `xend`).

What Xend is, and the vocabulary the code uses, is in [`CONTEXT.md`](./CONTEXT.md). Decisions are in [`docs/adr/`](./docs/adr/README.md).

## Workspaces

| Workspace                    | Package                   | What it is                                                                                                                                                     |
| ---------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile`                | `@xend/mobile`            | Expo React Native app for Android and iOS. See [`apps/mobile/README.md`](./apps/mobile/README.md).                                                             |
| `apps/backend`               | `@xend/backend`           | NestJS API. Consumer auth, Accounts, Spends, recovery, Pay with Xend (merchants, intents, settlement, webhooks), console. Drizzle over Postgres, Redis, Kafka. |
| `apps/relayer`               | `@xend/relayer`           | Fee-payer relayer. A separate NestJS deployable holding only the fee-payer key, its own RPC access and an internal-auth secret (ADR 0012).                     |
| `apps/checkout`              | `@xend/checkout`          | The hosted checkout popup at pay.xend.global. Vite and React.                                                                                                  |
| `packages/smart-account`     | `@xend/smart-account`     | Owned adapter over the Squads Smart Account Program: address derivation and unsigned transaction builders for the 2-of-3 signer set (ADR 0025).                |
| `packages/checkout-core`     | `@xend/checkout-core`     | Pay with Xend button and result relay. Framework-agnostic, zero runtime dependencies, size-gated.                                                              |
| `packages/checkout-react`    | `@xend/checkout-react`    | React wrapper for the button.                                                                                                                                  |
| `packages/checkout-protocol` | `@xend/checkout-protocol` | The versioned postMessage protocol between button and popup (ADR 0016).                                                                                        |
| `packages/ui`                | `@xend/ui`                | Shared React component library.                                                                                                                                |
| `packages/eslint-config`     | `@xend/eslint-config`     | Shared ESLint configs.                                                                                                                                         |
| `packages/typescript-config` | `@xend/typescript-config` | Shared tsconfigs.                                                                                                                                              |

## Prerequisites

- Node `>=18`, npm 10 (`packageManager` is pinned in `package.json`)
- Docker, for Redis and Kafka
- Postgres 17, either natively installed or through the optional compose profile
- Mobile: Android Studio and a JDK for `android`, Xcode for `ios`

## Setup

```
npm install
cp apps/backend/.env.example apps/backend/.env
cp apps/relayer/.env.example apps/relayer/.env
cp apps/mobile/example.env apps/mobile/.env
```

Fill in the secrets each file marks as blank. `postinstall` runs `patch-package`.

## Running everything

```
npm run dev
```

`scripts/dev.mjs` brings Docker up (starting Docker Desktop on macOS if it has to), runs `docker compose up -d --wait redis kafka kafka-topics`, checks that Postgres answers on the host and port in `apps/backend/.env`'s `DATABASE_URL`, checks that the service ports are free, and then runs `turbo run dev --continue=always`, so one service falling over leaves the rest up. Add `--log` to tee the combined output to `/tmp/xend-dev.log`.

Infra on its own:

```
npm run infra         # redis + kafka + topic seeding
npm run infra:logs
npm run infra:down
npm run infra:reset   # wipe volumes and start clean
```

Postgres is not part of `npm run infra` because a native install usually already holds 5432. `docker compose --profile postgres up -d --wait postgres` runs the bundled one; its `DATABASE_URL` is `postgresql://postgres:postgres@localhost:5432/fuse`.

One service at a time, with infra already up:

```
npx turbo run dev --filter=@xend/backend
npx turbo run dev --filter=@xend/relayer
npx turbo run dev --filter=@xend/checkout
npm run dev:mobile    # expo start in its own terminal, so the keyboard shortcuts work
```

## Ports

| Service          | Port                                       | Where it is set                                                                                                                        |
| ---------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Backend          | 8000                                       | `PORT` in `apps/backend/.env.example`; `scripts/dev.mjs` assumes 8000 when unset                                                       |
| Relayer          | 8787                                       | `PORT` in `apps/relayer/.env.example`, the Joi default in `apps/relayer/src/config/config.module.ts`, `docker-compose.yml`             |
| Checkout         | 5173, or 443 with a `www.xend.global` cert | `apps/checkout/vite.config.ts` serves on whichever mkcert cert is present under `apps/checkout/certs/`; with none, Vite's default 5173 |
| Metro            | 8081                                       | Expo default; `scripts/dev.mjs` refuses to start if it is taken                                                                        |
| Redis            | 6379                                       | `docker-compose.yml`                                                                                                                   |
| Kafka            | 9092                                       | `docker-compose.yml`                                                                                                                   |
| Postgres         | 5432                                       | `docker-compose.yml` (profile `postgres`)                                                                                              |
| Backend debugger | 9229                                       | `nest start --debug`                                                                                                                   |
| Relayer debugger | 9230                                       | `nest start --debug=9230`                                                                                                              |

Two committed values disagree with this table and are worth knowing about: `apps/backend/.env.example` sets `RELAYER_URL=http://localhost:8080`, and `apps/checkout/vite.config.ts` proxies `/checkout` and `/v1` to `http://localhost:8008` when serving over TLS. Set `RELAYER_URL` to port 8787 and point the proxy at the backend's real port when running those paths locally.

The backend tees its own output to `/tmp/xend-backend.log`, colour-free.

## Build, check, test

```
npm run build          # turbo run build
npm run check-types
npm run lint
npm run test
npm run format
```

Filter any task with `--filter`, for example `npx turbo run test --filter=@xend/backend`. The checkout packages are released with changesets: `npm run changeset`, `npm run version-packages`, `npm run release`.

## Running in production

The backend ships as a container built from the repo root, because it imports
`@xend/smart-account` from the workspace:

```
docker build -f apps/backend/Dockerfile -t xend-backend .
```

It runs as `node`, listens on `PORT` (8000 by default), and answers
`GET /health` with the state of Postgres and Redis. The image carries its own
migrations, so apply them before the first request reaches a new release:

```
npm --workspace @xend/backend run db:migrate
```

### Environment

`NODE_ENV` has no default and the process refuses to boot without it. Nine more
values are required everywhere:

`DATABASE_URL`, `KAFKA_BROKERS`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`,
`HELIUS_API_KEY`, `HELIUS_RPC_URL`, `HELIUS_WEBHOOK_SECRET`,
`INTERNAL_API_SECRET`, `CHECKOUT_RETURN_URL_SECRET`.

Set these for a real deployment as well:

| Key                                                              | Why                                                                                                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TRUST_PROXY`                                                    | Defaults to 1 in production. Without it every caller behind the load balancer shares one address and the per-address limits stop meaning anything.                 |
| `SOLANA_CLUSTER` and `EXPO_PUBLIC_USDC_MINT_ADDRESS`             | Checked against each other at boot. A cluster and a mint from different networks refuse to start.                                                                  |
| `RECOVERY_VAULT_PROVIDER`                                        | `env` or `aws-kms`. Under `aws-kms` the sealed recovery keys are wrapped by a data key from `RECOVERY_VAULT_KMS_KEY_ID`.                                           |
| `RECOVERY_VAULT_KEYS`                                            | The key ring, current key first, as `id:base64`. Rows sealed under an older id keep opening. `RECOVERY_VAULT_KEY` remains the single-key form.                     |
| `SETTLEMENT_AUTHORITY_PROVIDER` and `RELAYER_FEE_PAYER_PROVIDER` | Same switch for the two signing keys. Under `aws-kms` each reads a KMS ciphertext rather than a raw secret.                                                        |
| `JWT_SECRETS`                                                    | A comma list where the first signs and every entry verifies, so the signing key can rotate without ending live sessions. `JWT_SECRET` remains the single-key form. |
| `METRICS_SECRET`                                                 | Required in production. `GET /metrics` is refused without it.                                                                                                      |
| `TEST_DASHBOARD_SECRET`                                          | The test dashboard is never registered in production, and needs this header elsewhere.                                                                             |
| `CHECKOUT_DEV_FORCE_SETTLE`                                      | Must be false in production; the process refuses to boot otherwise. Test-mode intents settle through the sandbox instead.                                          |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                                    | Turns tracing on. Absent, the tracer never starts.                                                                                                                 |

`apps/backend/.env.example` carries every key the configuration validates,
including the ones with defaults.

Use an operator script to produce a KMS ciphertext for a secret:

```
npm --workspace @xend/backend exec tsx scripts/kms-encrypt-secret.ts
```

## Docs

- `CONTEXT.md`: the domain glossary
- `docs/adr/`: architectural decision records
- `docs/specs/`: specs, runbooks and handoffs; each carries a status line at the top
- `docs/xend-master-context.md`: the briefing for outward-facing material
- `docs/agents/`: how agents use the issue tracker, triage labels and domain docs
- `apps/mobile/STYLE.md`: the mobile styling rules
