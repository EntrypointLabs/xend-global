// Shared DTO contracts for the wire-real-backend cutover.
//
// These types describe the JSON over the wire between apps/mobile and apps/backend.
// Field names are camelCase to match (a) the Drizzle ORM property names in
// apps/backend/src/db/schema.ts, (b) the @sqds/grid SDK type shape (see
// .claude/plans/wire-real-backend/phases/01-foundation/SDK_NOTES.md), and
// (c) NestJS's default JSON serialization.
//
// SDK source: node_modules/@sqds/grid/dist/index.d.ts
// DB source:  apps/backend/src/db/schema.ts

import type {
  AccountPolicies,
  SignAndSendRequest,
} from '@sqds/grid';

// ---------- /wallets/me ----------

// Backend returns { id, gridAccountId, ...gridAccount.data } where gridAccount.data
// is the @sqds/grid GetAccountResponse `data` shape (index.d.ts:428-436).
export interface WalletDto {
  id: string;
  gridAccountId: string;
  type: 'signers' | 'email';
  address: string;
  gridUserId: string;
  policies?: AccountPolicies;
  memo?: string;
  createdAt?: string;
  status?: string;
}

// ---------- /wallets/me/balances ----------

// @sqds/grid TokenBalance (index.d.ts:450-458) carries `amount: bigint` in-process,
// but on the wire NestJS serializes bigint to a JSON string. Same for `lamports`.
export interface BalanceTokenDto {
  tokenAddress: string;
  amount: string;
  decimals: number;
  amountDecimal: string;
  symbol?: string;
  name?: string;
  logo?: string;
}

export interface BalancesDto {
  address: string;
  lamports: string;
  sol: number;
  tokens: BalanceTokenDto[];
}

// ---------- /transactions (history) ----------

// Mirrors apps/backend/src/db/schema.ts `transactions` table (Drizzle camelCase props).
// Date columns serialize to ISO strings over JSON.
// `signature` is `.unique()` but NOT `.notNull()` in the schema — keep nullable.
// `slot` is `bigint` — serializes to string over JSON.
// `amount` is `numeric` in Postgres — serialized as decimal string.
// `confirmedAt` is `timestamp` (nullable) — null until Phase 3 reconciliation flips PENDING→CONFIRMED.
export interface TransactionRowDto {
  id: string;
  smartAccountId: string;
  signature: string | null;
  type: 'SEND' | 'RECEIVE';
  amount: string;
  token: string;
  fromAddress: string;
  toAddress: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  slot: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

// Mirrors @sqds/grid SplTransfer (index.d.ts:853-872). The Grid `getTransfers`
// response is `(BridgeTransfer | SplTransfer)[]`; this app only consumes SPL transfers.
// BridgeTransfer (fiat onramp / off-ramp) is out of scope for wire-real-backend.
export interface GridTransferDto {
  id: string;
  gridUserId: string;
  mainAccountAddress: string;
  mint: string;
  isToken2022: boolean;
  signature: string;
  confirmationStatus: 'pending' | 'confirmed';
  fromAddress: string;
  toAddress: string;
  amount: string;
  uiAmount: string;
  decimals: number;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
  direction?: 'inflow' | 'outflow';
  environment?: string;
  instructionIndex?: number;
}

// Backend's transactions.service.getHistory currently returns
// `{ transactions: dbTxs, transfers: gridTransfers.data }`.
export interface TransactionsDto {
  transactions: TransactionRowDto[];
  transfers: GridTransferDto[];
}

// ---------- POST /transactions/send ----------

// Mobile sends a DECIMAL string for `amount` (e.g. "0.10"); Phase 3 backend
// converts to base units via TOKEN_DECIMALS map. Token is USDC-only for the
// wire-real-backend spec.
//
// `sessionSecrets` and `session` types are pinned to the @sqds/grid
// SignAndSendRequest shape so we can pass them through without re-typing.
export interface SendTransactionDto {
  toAddress: string;
  amount: string;
  token: 'USDC';
  sessionSecrets: SignAndSendRequest['sessionSecrets'];
  session: SignAndSendRequest['session'];
}
