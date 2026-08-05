import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  bigint,
  integer,
  boolean,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

// ---------- Enums ----------
//
// wallet_provider currently only allows 'privy'. Adding 'turnkey' /
// 'crossmint' later is a single ALTER TYPE ... ADD VALUE.

export const walletProviderEnum = pgEnum('wallet_provider', ['privy']);

export const recoveryChannelEnum = pgEnum('recovery_channel', [
  'email',
  'external_wallet',
]);

export const transferDirectionEnum = pgEnum('transfer_direction', [
  'SEND',
  'RECEIVE',
]);

export const transferStatusEnum = pgEnum('transfer_status', [
  'PENDING',
  'CONFIRMED',
  'FAILED',
]);

// Discriminates a Consumer's Activity row: a plain send/receive vs a
// Payment settlement (correlated to a payments row by settlement signature).
export const transferKindEnum = pgEnum('transfer_kind', [
  'transfer',
  'payment',
]);

export const merchantStatusEnum = pgEnum('merchant_status', [
  'active',
  'suspended',
]);

export const apiKeyModeEnum = pgEnum('api_key_mode', ['test', 'live']);

// Stripe-shaped intent lifecycle. 'created' -> 'authorized' ->
// 'settling' -> 'succeeded' | 'failed'; 'expired' (TTL before
// authorization) and 'canceled' (merchant cancel before
// authorization) are the other terminals.
export const paymentIntentStatusEnum = pgEnum('payment_intent_status', [
  'created',
  'authorized',
  'settling',
  'succeeded',
  'failed',
  'expired',
  'canceled',
]);

export const paymentAttemptStatusEnum = pgEnum('payment_attempt_status', [
  'authorized',
  'settling',
  'succeeded',
  'failed',
]);

export const webhookDeliveryStatusEnum = pgEnum('webhook_delivery_status', [
  'pending',
  'succeeded',
  'failed',
  'exhausted',
]);

// Settlement provider names (ADR 0015). 'blockradar' is pre-allocated; the
// Blockradar adapter ships in Phase 8 behind the same seam.
export const settlementProviderEnum = pgEnum('settlement_provider', [
  'direct_usdc',
  'blockradar',
]);

// Discriminates how a webhook delivery was materialized: 'event' rows are
// created automatically from a consumed Kafka lifecycle event (at most one
// per endpoint+event, so at-least-once re-consume is idempotent), 'manual'
// rows are operator redeliveries (unbounded, exempt from the auto index).
export const webhookDeliveryOriginEnum = pgEnum('webhook_delivery_origin', [
  'event',
  'manual',
]);

// Merchant KYB verification state. Gates LIVE-mode key issuance only; test
// keys are never gated (KYB never blocks developer experience, only real
// money). Stamped by the manual ops action after registration, beneficial
// ownership, and sanctions checks are done off-system.
export const kybStatusEnum = pgEnum('kyb_status', [
  'pending',
  'verified',
  'rejected',
]);

export const refundStatusEnum = pgEnum('refund_status', [
  'pending',
  'processing',
  'succeeded',
  'failed',
]);

// Off-ramp settlement lifecycle (Phase 8). A settlement row moves
// pending -> swept -> converting -> paid (fiat landed) | failed; a reverse
// (refund) row moves reversing -> reversed | failed.
export const offrampStatusEnum = pgEnum('offramp_status', [
  'pending',
  'swept',
  'converting',
  'paid',
  'failed',
  'reversing',
  'reversed',
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
 * Mirrored WebAuthn credential metadata, captured at enrollment and on
 * login. Vendor hedge: if the wallet vendor is unavailable or swapped,
 * the credential inventory survives. public_key is nullable because the
 * server-side vendor SDK omits it; the client supplies it at enrollment.
 */
export const passkeyCredentials = pgTable(
  'passkey_credentials',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    credentialId: text('credential_id').notNull().unique(),
    publicKey: text('public_key'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('passkey_credentials_user_idx').on(table.userId),
  }),
);

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
/**
 * recovery_signers — the Account's recovery keys (S3 and any the Consumer adds
 * later). One row per signer.
 *
 * An email signer's secret is generated at signup and held here sealed; using
 * it requires proving control of `channel_value`. An external_wallet signer is
 * the Consumer's own key, so `sealed_key` is null and we store only the pubkey.
 *
 * Invariant, enforced in RecoveryService and NOT at the data layer: an Account
 * always keeps at least one recovery signer. The last one can be rotated but
 * never deleted, because deleting it would leave a lost phone unrecoverable.
 */
export const recoverySigners = pgTable(
  'recovery_signers',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /** The Squads signer pubkey. What actually sits in the signer set. */
    address: text('address').notNull().unique(),
    channel: recoveryChannelEnum('channel').notNull(),
    /** The email address, or the external wallet's own address. */
    channelValue: text('channel_value').notNull(),
    /** Null for external_wallet: the Consumer holds that key, not us. */
    sealedKey: text('sealed_key'),
    /** Which wrapping key sealed it, so the vault key can be rotated. */
    sealedKeyId: text('sealed_key_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('recovery_signers_user_channel_idx').on(
      table.userId,
      table.channel,
      table.channelValue,
    ),
  ],
);

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
    // Activity linkage for Pay: a settlement transfer carries kind='payment'
    // and the payment_id it settled, correlated by signature at confirmation.
    kind: transferKindEnum('kind').notNull().default('transfer'),
    paymentId: text('payment_id').references((): AnyPgColumn => payments.id),
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

// ---------- Pay domain ----------

/**
 * merchants — a Xend Merchant record. display_name is what Checkout
 * renders; it is server-owned and never taken from the merchant page.
 * intent_ttl_minutes is a nullable per-Merchant override of the platform
 * intent-TTL default. allowed_origins is the postMessage origin allowlist,
 * populated when the Merchant API lands.
 */
export const merchants = pgTable('merchants', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text('name').notNull(),
  displayName: text('display_name').notNull(),
  status: merchantStatusEnum('status').notNull().default('active'),
  intentTtlMinutes: integer('intent_ttl_minutes'),
  allowedOrigins: text('allowed_origins').array(),
  // KYB gates LIVE-mode key issuance only; test keys are never gated. Stamped
  // by the manual stage-2 ops action after off-system checks complete.
  kybStatus: kybStatusEnum('kyb_status').notNull().default('pending'),
  kybVerifiedAt: timestamp('kyb_verified_at'),
  // Per-Merchant revenue fields, both zero at pilot. flat_fee_bps is a flat
  // basis-point fee; fx_spread_bps is the spread booked on the naira
  // conversion at settlement. Whether both stack on one naira Payment is an
  // open commercial call, so both are carried as first-class fields.
  flatFeeBps: integer('flat_fee_bps').notNull().default(0),
  fxSpreadBps: integer('fx_spread_bps').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * api_keys — hashed Merchant API keys. key_hash is the SHA-256 hex of the
 * full key; the raw key is never stored. fingerprint (prefix + last 4) is
 * the display-safe form for a console.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id),
    keyHash: text('key_hash').notNull().unique(),
    keyPrefix: text('key_prefix').notNull(),
    fingerprint: text('fingerprint').notNull(),
    mode: apiKeyModeEnum('mode').notNull(),
    revokedAt: timestamp('revoked_at'),
    lastUsedAt: timestamp('last_used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    merchantIdx: index('api_keys_merchant_idx').on(table.merchantId),
  }),
);

/**
 * payment_intents — a durable Payment intent. Rows survive restarts and
 * multiple instances; there is no in-memory intent state. The pi_ prefix
 * makes the id self-describing on the wire, and the id doubles as the
 * correlation id that traces the Payment across services. The NGN-display
 * columns are nullable until the FX quote adapter lands; amounts and rates
 * are strings, never float columns.
 */
export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `pi_${createId()}`),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id),
    consumerId: text('consumer_id').references(() => users.id),
    status: paymentIntentStatusEnum('status').notNull().default('created'),
    usdcSettlementRaw: text('usdc_settlement_raw').notNull(),
    ngnDisplayMinor: text('ngn_display_minor'),
    fxRate: text('fx_rate'),
    fxSource: text('fx_source'),
    fxQuotedAt: timestamp('fx_quoted_at'),
    merchantReference: text('merchant_reference'),
    idempotencyKey: text('idempotency_key'),
    // The cluster/mode the intent was created under; devnet-safe default.
    mode: apiKeyModeEnum('mode').notNull().default('test'),
    // Merchant-supplied redirect targets, SSRF-validated at creation and
    // consumed by redirect-completion mode (the signing leg is the checkout
    // surface's; these are the stored base URLs).
    returnUrl: text('return_url'),
    cancelUrl: text('cancel_url'),
    expiresAt: timestamp('expires_at').notNull(),
    authorizedAt: timestamp('authorized_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    // Replays of the same merchant write must return the same intent
    // (Postgres treats NULL idempotency keys as distinct, so intents
    // created without a key are unconstrained).
    merchantIdemIdx: uniqueIndex('payment_intents_merchant_idem_idx').on(
      table.merchantId,
      table.idempotencyKey,
    ),
    // Expiry sweep scans only unauthorized intents.
    expiryIdx: index('payment_intents_expiry_idx')
      .on(table.expiresAt)
      .where(sql`status = 'created'`),
  }),
);

/**
 * payment_attempts — a settlement attempt against an intent. message_base64
 * and tx_signature stay null until the settlement leg pins the transaction.
 * The partial unique index below is the double-spend guard.
 */
export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    intentId: text('intent_id')
      .notNull()
      .references(() => paymentIntents.id),
    status: paymentAttemptStatusEnum('status').notNull().default('authorized'),
    messageBase64: text('message_base64'),
    txSignature: text('tx_signature').unique(),
    blockhash: text('blockhash'),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    // At most one live attempt per intent: a retry while one is in
    // flight fails at the database, not in application logic.
    liveAttemptIdx: uniqueIndex('payment_attempts_live_idx')
      .on(table.intentId)
      .where(sql`status IN ('authorized', 'settling')`),
  }),
);

/**
 * payments — a completed Payment. refund_of_payment_id is a self-FK that
 * links a refund row back to the Payment it reverses; the linkage exists
 * from day one even though refunds are manual ops at pilot.
 */
export const payments = pgTable(
  'payments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `pay_${createId()}`),
    intentId: text('intent_id')
      .notNull()
      .unique()
      .references(() => paymentIntents.id),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id),
    consumerId: text('consumer_id')
      .notNull()
      .references(() => users.id),
    usdcSettlementRaw: text('usdc_settlement_raw').notNull(),
    ngnDisplayMinor: text('ngn_display_minor'),
    txSignature: text('tx_signature').unique(),
    settledAt: timestamp('settled_at'),
    refundOfPaymentId: text('refund_of_payment_id').references(
      (): AnyPgColumn => payments.id,
    ),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    merchantIdx: index('payments_merchant_idx').on(table.merchantId),
    consumerIdx: index('payments_consumer_idx').on(table.consumerId),
  }),
);

/**
 * sessions — merchant-scoped opaque Sessions. token_hash is the SHA-256 of
 * the raw token; the raw token is never stored. The token rotates in place
 * on use (hash overwritten) while the row identity stays stable, so
 * revocation and listing survive rotation. expires_at is the absolute
 * lifetime; the sliding inactivity window is enforced against last_used_at.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tokenHash: text('token_hash').notNull().unique(),
    consumerId: text('consumer_id')
      .notNull()
      .references(() => users.id),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id),
    issuingIntentId: text('issuing_intent_id').references(
      () => paymentIntents.id,
    ),
    uaHint: text('ua_hint'),
    lastUsedAt: timestamp('last_used_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    consumerIdx: index('sessions_consumer_idx').on(table.consumerId),
    merchantConsumerIdx: index('sessions_merchant_consumer_idx').on(
      table.merchantId,
      table.consumerId,
    ),
  }),
);

/**
 * webhook_endpoints — Merchant webhook destinations. Two concurrently valid
 * whsec_ secrets allow zero-downtime secret rotation. event_types null means
 * every event type is delivered.
 */
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id),
    url: text('url').notNull(),
    secretPrimary: text('secret_primary').notNull(),
    secretSecondary: text('secret_secondary'),
    enabled: boolean('enabled').notNull().default(true),
    eventTypes: text('event_types').array(),
    // An endpoint delivers only events created under its own mode, so a test
    // endpoint never receives live events and vice versa.
    mode: apiKeyModeEnum('mode').notNull().default('test'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    merchantIdx: index('webhook_endpoints_merchant_idx').on(table.merchantId),
  }),
);

/**
 * webhook_deliveries — one row per delivery attempt. event_id is stable
 * across redeliveries so consumer-side dedup works; payload is the
 * JSON-serialized event snapshot; correlation_id ties the delivery back to
 * the Payment.
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: text('payload').notNull(),
    correlationId: text('correlation_id').notNull(),
    attemptNo: integer('attempt_no').notNull().default(1),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    durationMs: integer('duration_ms'),
    status: webhookDeliveryStatusEnum('status').notNull().default('pending'),
    origin: webhookDeliveryOriginEnum('origin').notNull().default('event'),
    nextRetryAt: timestamp('next_retry_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    endpointIdx: index('webhook_deliveries_endpoint_idx').on(table.endpointId),
    eventIdx: index('webhook_deliveries_event_idx').on(table.eventId),
    // At most one automatic delivery per (endpoint, event); Kafka is
    // at-least-once, so re-consuming the same lifecycle event must not
    // enqueue a second delivery. Manual redeliveries are exempt.
    autoDeliveryIdx: uniqueIndex('webhook_deliveries_auto_idx')
      .on(table.endpointId, table.eventId)
      .where(sql`origin = 'event'`),
  }),
);

/**
 * settlement_accounts — per-Merchant settlement endpoints behind the
 * SettlementProvider layer (ADR 0015). This table is a READ MODEL: the
 * chain is the source of truth and a Merchant's owed balance is their
 * on-chain USDC balance (no pooled ledger). `address` is the classic-SPL
 * USDC token account settlements land in (the TransferChecked destination,
 * REQ-PLAIN-SPL). `provider`/`currency`/`provider_reference`/`payout_config`
 * are the polymorphic settlement reference; `authority_address` is the
 * attribution root the address is enumerable from (the Xend authority for
 * direct-USDC, the Blockradar master wallet in Phase 8, null for a recorded
 * merchant-own address). Columns are nullable until provisioning completes.
 */
export const settlementAccounts = pgTable('settlement_accounts', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  merchantId: text('merchant_id')
    .notNull()
    .unique()
    .references(() => merchants.id),
  address: text('address').unique(),
  provider: settlementProviderEnum('provider'),
  currency: text('currency'),
  providerReference: text('provider_reference'),
  payoutConfig: text('payout_config'),
  authorityAddress: text('authority_address'),
  provisionedAt: timestamp('provisioned_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * idempotency_keys — Stripe-semantics response snapshot for merchant-facing
 * writes. A replay of the same (merchant, key) with the same request body
 * returns the byte-identical stored response and never re-runs the write; a
 * reuse of the same key with a different body is a 409. request_hash is the
 * SHA-256 hex of the canonical request; response_body is the exact JSON
 * returned, replayed verbatim.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status').notNull(),
    responseBody: text('response_body').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    merchantKeyIdx: uniqueIndex('idempotency_keys_merchant_key_idx').on(
      table.merchantId,
      table.idempotencyKey,
    ),
  }),
);

/**
 * refunds — an ops-initiated, partial-capable reversal of a succeeded
 * Payment. The reversal runs through Phase 4's SettlementProvider.reverse()
 * at the provider's live rate at refund time; provider_reference is the
 * reverse() signature. The payment<->refund linkage is preserved via
 * payment_id, and the durable row is written before the provider call so a
 * crash never loses a refund in flight.
 */
export const refunds = pgTable(
  'refunds',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `rf_${createId()}`),
    paymentId: text('payment_id')
      .notNull()
      .references(() => payments.id),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id),
    status: refundStatusEnum('status').notNull().default('pending'),
    amountUsdcRaw: text('amount_usdc_raw').notNull(),
    reason: text('reason'),
    providerReference: text('provider_reference'),
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    paymentIdx: index('refunds_payment_idx').on(table.paymentId),
    // Data-layer backstop against a double refund: the same merchant
    // Idempotency-Key can create at most one refund row, so a concurrent
    // retry loses the insert (23505) before it can call provider.reverse().
    // NULL keys are distinct in Postgres, so keyless refunds are unconstrained.
    merchantIdemIdx: uniqueIndex('refunds_merchant_idem_idx').on(
      table.merchantId,
      table.idempotencyKey,
    ),
  }),
);

/**
 * settlement_offramps — the settlement adapter's own off-ramp lifecycle read
 * model (Phase 8). The provider column records which adapter owns the row (the
 * settlement provider layer has no off-ramp table to write through, so this
 * stays local to the adapter). `signature` is the Consumer->endpoint
 * settlement tx signature and the money-safety idempotency key for a
 * 'settlement' row (partial-unique index below) so the convert-payout cannot
 * double-fire. `provider_ref` is the webhook correlation handle. Amounts,
 * rates, and the per-settlement FX spread (zero at pilot) are text — never
 * float columns.
 */
export const settlementOfframps = pgTable(
  'settlement_offramps',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `so_${createId()}`),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id),
    paymentId: text('payment_id').references((): AnyPgColumn => payments.id),
    provider: text('provider').notNull(),
    signature: text('signature'),
    providerRef: text('provider_ref').unique(),
    direction: text('direction').notNull(),
    usdcAmountRaw: text('usdc_amount_raw').notNull(),
    ngnAmountMinor: text('ngn_amount_minor'),
    fxRate: text('fx_rate'),
    fxSpreadRaw: text('fx_spread_raw'),
    status: offrampStatusEnum('status').notNull().default('pending'),
    failureReason: text('failure_reason'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    merchantIdx: index('settlement_offramps_merchant_idx').on(table.merchantId),
    // Money-safety: at most one settlement row per signature (partial unique
    // per the transfers_pending_idx precedent) so handleIncomingSettlement is
    // idempotent per signature and the convert-payout fires once.
    settlementSignatureIdx: uniqueIndex('settlement_offramps_signature_idx')
      .on(table.signature)
      .where(sql`direction = 'settlement'`),
  }),
);

// ---------- Relations ----------

export const usersRelations = relations(users, ({ one, many }) => ({
  smartAccount: one(smartAccounts, {
    fields: [users.id],
    references: [smartAccounts.userId],
  }),
  passkeyCredentials: many(passkeyCredentials),
}));

export const passkeyCredentialsRelations = relations(
  passkeyCredentials,
  ({ one }) => ({
    user: one(users, {
      fields: [passkeyCredentials.userId],
      references: [users.id],
    }),
  }),
);

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

export const merchantsRelations = relations(merchants, ({ one, many }) => ({
  apiKeys: many(apiKeys),
  paymentIntents: many(paymentIntents),
  sessions: many(sessions),
  webhookEndpoints: many(webhookEndpoints),
  settlementAccount: one(settlementAccounts, {
    fields: [merchants.id],
    references: [settlementAccounts.merchantId],
  }),
}));

export const paymentIntentsRelations = relations(
  paymentIntents,
  ({ one, many }) => ({
    merchant: one(merchants, {
      fields: [paymentIntents.merchantId],
      references: [merchants.id],
    }),
    attempts: many(paymentAttempts),
    payment: one(payments, {
      fields: [paymentIntents.id],
      references: [payments.intentId],
    }),
  }),
);

export const paymentAttemptsRelations = relations(
  paymentAttempts,
  ({ one }) => ({
    intent: one(paymentIntents, {
      fields: [paymentAttempts.intentId],
      references: [paymentIntents.id],
    }),
  }),
);

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  intent: one(paymentIntents, {
    fields: [payments.intentId],
    references: [paymentIntents.id],
  }),
  merchant: one(merchants, {
    fields: [payments.merchantId],
    references: [merchants.id],
  }),
  refundOf: one(payments, {
    fields: [payments.refundOfPaymentId],
    references: [payments.id],
    relationName: 'refund',
  }),
  refunds: many(payments, { relationName: 'refund' }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  merchant: one(merchants, {
    fields: [sessions.merchantId],
    references: [merchants.id],
  }),
  consumer: one(users, {
    fields: [sessions.consumerId],
    references: [users.id],
  }),
}));

export const webhookEndpointsRelations = relations(
  webhookEndpoints,
  ({ many }) => ({
    deliveries: many(webhookDeliveries),
  }),
);

export const refundsRelations = relations(refunds, ({ one }) => ({
  payment: one(payments, {
    fields: [refunds.paymentId],
    references: [payments.id],
  }),
  merchant: one(merchants, {
    fields: [refunds.merchantId],
    references: [merchants.id],
  }),
}));
