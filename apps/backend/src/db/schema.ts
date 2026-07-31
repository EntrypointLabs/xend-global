import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  bigint,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

// ---------- Enums ----------
//
// wallet_provider currently only allows 'privy'. Adding 'turnkey' /
// 'crossmint' later is a single ALTER TYPE ... ADD VALUE.

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
  // Soft-delete marker for account closure. The row (and its smart_accounts /
  // transfers) stays for the financial-recordkeeping retention the privacy
  // policy commits to; JwtStrategy rejects any token for a user with this set.
  deletedAt: timestamp('deleted_at'),
});

/**
 * smart_accounts — one row per (user, wallet provider). The wallet
 * address is the canonical Solana pubkey handed back to clients;
 * provider + provider_user_id are how we ask the provider (Privy today)
 * about the user later (e.g. fresh email on re-auth).
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
 * transfers:
 *   - intent_id: idempotency key returned by /transfers/prepare and
 *     replayed by /transfers/submit. UNIQUE but nullable.
 *   - direction: 'SEND' | 'RECEIVE'. Inbound (RECEIVE) rows are written
 *     by the RPC tailer.
 *   - mint + amount_raw. amount_raw is text because Solana amounts are
 *     u64 and numeric is unwieldy on the JS side.
 *   - submitted_at + failure_reason: written by /transfers/submit and
 *     the RPC tailer.
 */
export const transfers = pgTable(
  'transfers',
  {
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
  },
  (table) => ({
    // Partial index powering the ReconcilerService poll: scans only
    // outstanding PENDING rows (CONFIRMED + FAILED rows do not appear in
    // this index).
    pendingIdx: index('transfers_pending_idx')
      .on(table.submittedAt)
      .where(sql`status = 'PENDING'`),
  }),
);

/**
 * tailer_state — per-wallet bookmark for the RPC tailer. One row per
 * wallet address; UPSERT keyed on wallet_address. `last_indexed_slot` is
 * updated by:
 *   - the webhook hot path on every CONFIRMED event (max(current, event.slot)),
 *   - the boot-time `streamConfirmedTransfers` replay that catches up
 *     missed events since the last bookmark.
 */
export const tailerState = pgTable('tailer_state', {
  walletAddress: text('wallet_address').primaryKey(),
  lastIndexedSlot: bigint('last_indexed_slot', { mode: 'bigint' })
    .notNull()
    .default(0n),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
