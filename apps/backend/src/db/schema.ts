import { pgTable, pgEnum, text, timestamp, bigint } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

// ---------- Enums ----------
//
// Phase 1 (migration 0001) reshape:
//   - wallet_provider replaces the implicit "Grid" binding; today only
//     'privy' is valid. Adding 'turnkey' / 'crossmint' later is a single
//     ALTER TYPE ... ADD VALUE.
//   - transfer_direction + transfer_status replace tx_type + tx_status.
//     The values are identical but the names align with the
//     `transfers` table rename (transactions -> transfers per spec
//     §5.4).
//
// The old tx_type / tx_status enums have been DROPPED in 0001. They no
// longer exist in the database; any TS code referencing
// `txTypeEnum`/`txStatusEnum` must be updated in the same commit as
// this schema change to keep the build atomic.

export const walletProviderEnum = pgEnum('wallet_provider', ['privy']);

export const transferDirectionEnum = pgEnum('transfer_direction', [
  'SEND',
  'RECEIVE',
]);

export const transferStatusEnum = pgEnum('transfer_status', [
  'PENDING',
  'CONFIRMED',
  'FAILED',
]);

// ---------- Tables ----------

export const users = pgTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * smart_accounts — one row per (user, wallet provider). The wallet
 * address is the canonical Solana pubkey we hand back to clients;
 * provider + provider_user_id are how we ask the provider (Privy
 * today) about the user later (e.g. fresh email on re-auth).
 *
 * The column rename grid_account_id -> wallet_address is provider-
 * neutral wording, not a schema reshape: the value is still a Solana
 * base58 address.
 */
export const smartAccounts = pgTable('smart_accounts', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => users.id),
  walletAddress: text('wallet_address').notNull().unique(),
  provider: walletProviderEnum('provider').notNull().default('privy'),
  providerUserId: text('provider_user_id').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * transfers — formerly `transactions`. Reshape per spec §5.4:
 *   - intent_id: idempotency key returned by /transfers/prepare and
 *     replayed by /transfers/submit. UNIQUE but nullable so legacy
 *     /transactions/send inserts (which do not have an intent) can
 *     coexist during the Phase 1 -> Phase 4 transition.
 *   - direction: 'SEND' | 'RECEIVE'. Inbound (RECEIVE) rows are
 *     written by the Phase 2 RPC tailer; the legacy send path defaults
 *     to 'SEND'.
 *   - mint + amount_raw: provider-neutral replacements for token +
 *     amount. amount_raw is text because Solana amounts are u64 and
 *     numeric is unwieldy on the JS side.
 *   - submitted_at + failure_reason: written by /transfers/submit and
 *     the RPC tailer.
 *
 * Legacy columns dropped in migration 0001: type, token, amount.
 */
export const transfers = pgTable('transfers', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  smartAccountId: text('smart_account_id')
    .notNull()
    .references(() => smartAccounts.id),
  intentId: text('intent_id').unique(),
  signature: text('signature').unique(),
  direction: transferDirectionEnum('direction').notNull(),
  mint: text('mint').notNull(),
  amountRaw: text('amount_raw').notNull(),
  fromAddress: text('from_address').notNull(),
  toAddress: text('to_address').notNull(),
  status: transferStatusEnum('status').notNull().default('PENDING'),
  slot: bigint('slot', { mode: 'bigint' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  submittedAt: timestamp('submitted_at'),
  confirmedAt: timestamp('confirmed_at'),
  failureReason: text('failure_reason'),
});

// ---------- Relations ----------

export const usersRelations = relations(users, ({ one }) => ({
  smartAccount: one(smartAccounts, {
    fields: [users.id],
    references: [smartAccounts.userId],
  }),
}));

export const smartAccountsRelations = relations(
  smartAccounts,
  ({ one, many }) => ({
    user: one(users, {
      fields: [smartAccounts.userId],
      references: [users.id],
    }),
    transfers: many(transfers),
  }),
);

export const transfersRelations = relations(transfers, ({ one }) => ({
  smartAccount: one(smartAccounts, {
    fields: [transfers.smartAccountId],
    references: [smartAccounts.id],
  }),
}));
