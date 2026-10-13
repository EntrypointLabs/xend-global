# @prydd/backend

The Prydd backend — a [NestJS](https://nestjs.com) server that fronts the Squads Grid SDK for the Prydd mobile app. Owns the API-key-bearing Grid operations, authentication, wallet management, and transaction orchestration that must not live on the client.

## Modules

- `src/auth` — authentication and JWT issuance (`@nestjs/passport`, `passport-jwt`)
- `src/grid` — Grid SDK integration via [`@sqds/grid`](https://www.npmjs.com/package/@sqds/grid)
- `src/wallets` — wallet provisioning and lookup
- `src/transactions` — transaction orchestration and history
- `src/db` — Drizzle ORM schema and client (Postgres via `pg`)
- `src/config` — environment configuration

## Getting started

Run all commands from the repo root unless noted. The backend is a workspace; npm scripts can target it with `--workspace @prydd/backend`.

### 1. Install

```bash
npm install
```

### 2. Configure environment

Create `apps/backend/.env` with at least:

```env
DATABASE_URL=postgres://user:pass@localhost:5432/prydd
GRID_API_KEY=your_grid_api_key_here
GRID_ENV=sandbox          # or production
JWT_SECRET=replace-me
PORT=3000
```

### 3. Services

Kafka and Redis are required at boot; the consumer connects during `onModuleInit`, so an unreachable broker takes the process down.

```bash
npm run infra          # Kafka (KRaft, no ZooKeeper) + Redis, with topics seeded
npm run infra:down     # stop
npm run infra:reset    # stop, drop volumes, start clean
```

Postgres is not started by default, since a natively installed one usually already holds 5432. Use `docker compose --profile postgres up -d` to run it in Docker instead, and point `DATABASE_URL` at `postgresql://postgres:postgres@localhost:5432/fuse`.

### 4. Database

```bash
npm --workspace @prydd/backend run db:generate   # generate migrations from schema
npm --workspace @prydd/backend run db:migrate    # apply migrations
npm --workspace @prydd/backend run db:studio     # open Drizzle Studio
```

A hand-authored migration must be added to `drizzle/meta/_journal.json` as well as `drizzle/`. `db:migrate` works off the journal, so a file that is not listed there is silently never applied.

### 5. Run

```bash
npm --workspace @prydd/backend run dev           # watch mode
npm --workspace @prydd/backend run build         # compile to dist/
npm --workspace @prydd/backend run start         # run compiled output
npm --workspace @prydd/backend run start:debug   # watch + --debug
```

## Tests

```bash
npm --workspace @prydd/backend run test          # unit
npm --workspace @prydd/backend run test:e2e      # end-to-end (test/jest-e2e.json)
npm --workspace @prydd/backend run test:cov      # coverage
```

## Linting and types

```bash
npm --workspace @prydd/backend run lint
npm --workspace @prydd/backend run check-types
npm --workspace @prydd/backend run format
```

## References

- [NestJS docs](https://docs.nestjs.com)
- [Drizzle ORM](https://orm.drizzle.team)
- [@sqds/grid](https://www.npmjs.com/package/@sqds/grid)
