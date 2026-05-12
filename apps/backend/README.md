# @xend/backend

The Xend backend — a [NestJS](https://nestjs.com) server that fronts the Squads Grid SDK for the Xend mobile app. Owns the API-key-bearing Grid operations, authentication, wallet management, and transaction orchestration that must not live on the client.

## Modules

- `src/auth` — authentication and JWT issuance (`@nestjs/passport`, `passport-jwt`)
- `src/grid` — Grid SDK integration via [`@sqds/grid`](https://www.npmjs.com/package/@sqds/grid)
- `src/wallets` — wallet provisioning and lookup
- `src/transactions` — transaction orchestration and history
- `src/db` — Drizzle ORM schema and client (Postgres via `pg`)
- `src/config` — environment configuration

## Getting started

Run all commands from the repo root unless noted. The backend is a workspace; npm scripts can target it with `--workspace @xend/backend`.

### 1. Install

```bash
npm install
```

### 2. Configure environment

Create `apps/backend/.env` with at least:

```env
DATABASE_URL=postgres://user:pass@localhost:5432/xend
GRID_API_KEY=your_grid_api_key_here
GRID_ENV=sandbox          # or production
JWT_SECRET=replace-me
PORT=3000
```

### 3. Database

```bash
npm --workspace @xend/backend run db:generate   # generate migrations from schema
npm --workspace @xend/backend run db:migrate    # apply migrations
npm --workspace @xend/backend run db:studio     # open Drizzle Studio
```

### 4. Run

```bash
npm --workspace @xend/backend run dev           # watch mode
npm --workspace @xend/backend run build         # compile to dist/
npm --workspace @xend/backend run start         # run compiled output
npm --workspace @xend/backend run start:debug   # watch + --debug
```

## Tests

```bash
npm --workspace @xend/backend run test          # unit
npm --workspace @xend/backend run test:e2e      # end-to-end (test/jest-e2e.json)
npm --workspace @xend/backend run test:cov      # coverage
```

## Linting and types

```bash
npm --workspace @xend/backend run lint
npm --workspace @xend/backend run check-types
npm --workspace @xend/backend run format
```

## References

- [NestJS docs](https://docs.nestjs.com)
- [Drizzle ORM](https://orm.drizzle.team)
- [@sqds/grid](https://www.npmjs.com/package/@sqds/grid)
