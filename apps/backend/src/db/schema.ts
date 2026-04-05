import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  bigint,
  numeric,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

// ---------- Enums ----------

export const txTypeEnum = pgEnum('tx_type', ['SEND', 'RECEIVE']);
export const txStatusEnum = pgEnum('tx_status', [
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

export const smartAccounts = pgTable('smart_accounts', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => users.id),
  gridAccountId: text('grid_account_id').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const transactions = pgTable('transactions', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  smartAccountId: text('smart_account_id')
    .notNull()
    .references(() => smartAccounts.id),
  signature: text('signature').unique(),
  type: txTypeEnum('type').notNull(),
  amount: numeric('amount').notNull(),
  token: text('token').notNull(),
  fromAddress: text('from_address').notNull(),
  toAddress: text('to_address').notNull(),
  status: txStatusEnum('status').notNull().default('PENDING'),
  slot: bigint('slot', { mode: 'bigint' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  confirmedAt: timestamp('confirmed_at'),
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
    transactions: many(transactions),
  }),
);

export const transactionsRelations = relations(transactions, ({ one }) => ({
  smartAccount: one(smartAccounts, {
    fields: [transactions.smartAccountId],
    references: [smartAccounts.id],
  }),
}));
