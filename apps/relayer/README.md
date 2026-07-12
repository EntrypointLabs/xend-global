# @xend/relayer

The fee-payer relayer: a thin, key-isolated Solana co-signer for Pay with
Xend. It sponsors the SOL fee on USDC settlement transactions so Consumers
never hold SOL. It is a SEPARATE deployable, not a module in `apps/backend`,
and holds the platform's most sensitive material (the fee-payer key). It
speaks `@solana/kit` (no `@solana/web3.js`) and shares no code with the
backend.

The adopt-vs-build decision (build a thin NestJS relayer, Kora as the
documented alternative) is recorded in
`docs/specs/relayer-kora-adopt-vs-build.md`. The abuse-control config
(`src/relayer-config.ts`) maps one-to-one onto Kora's config, so an
adopt-Kora reversal reuses the design.

## What it does

- One internal-only endpoint, `POST /internal/cosign`: validates a
  platform-compiled USDC settlement transaction, simulates it, partial-signs
  as the fee payer LAST, and broadcasts it.
- Refuses anything that is not a platform-compiled settlement transaction
  (instruction allowlist, fee payer never a writable non-fee account, USDC
  mint + decimals=6 + expected destination, no address lookup tables, hard
  fee ceiling, optional pinned-message byte-equality).
- Enforces per-Consumer / per-merchant / global caps and a bounded in-memory
  replay guard (defense-in-depth; the authoritative attempt registry is
  Phase 4).
- Monitors the fee-payer SOL balance and alerts below threshold.

## Run locally

```bash
cp apps/relayer/.env.example apps/relayer/.env   # fill in secrets locally
# from the repo root, alongside the Phase 1 redis/kafka stack:
docker compose up -d relayer
```

The compose healthcheck authenticates: it sends both `X-Correlation-Id` and
`X-Relayer-Auth`, because `/health` sits behind the correlation middleware
and the internal-auth guard like every other route. There is no
unauthenticated route.

Without Docker:

```bash
cd apps/relayer
npm install
npm run build && npm start        # node dist/main
npm run check-types && npm test   # quality gate
```

## Fee-payer key custody (review-blocking)

The fee-payer key lives ONLY in this deployment's secret store. It MUST NOT
appear in `apps/backend` env, in this repo, or in any log line (only the
derived public address is ever logged). Order of custody preference:

1. Turnkey / KMS-backed remote signer (drop in behind `FEE_PAYER_SIGNER`).
2. Cloud-KMS-wrapped key in the relayer's own secret store.
3. Raw `RELAYER_FEE_PAYER_SECRET_KEY` env var (pilot floor).

`RELAYER_INTERNAL_AUTH_SECRET` is, by design, also held by the Identity and
Capability API caller (wired there in Phase 4). It is the app-level half of
"never public"; see below for the network half.

## Never publicly reachable

The relayer must not be reachable from the public internet. Deploy it on an
internal / private network so only the Identity and Capability API can reach
it (VPC, private service, or security-group rule). The internal-auth secret
is defense-in-depth, NOT the only barrier. A publicly reachable fee sponsor
is a faucet. Network isolation is confirmed at the human checkpoint.

## Credential surface

The relayer deliberately gets NO Postgres, Drizzle, Kafka, or Redis client
or credential. Its complete credential surface is: its fee-payer key, its
own Helius RPC access, and its internal-auth secret. Payment lifecycle
events and domain state belong to the Identity and Capability API and the
settlement layer (Phases 2 and 4), which call this relayer and record the
returned signature.
