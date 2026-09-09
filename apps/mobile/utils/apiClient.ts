import { NairaTransferSchema, NairaTransfersSchema } from "@/utils/naira-transfers";
import { ObservedBalancesSchema } from "@/utils/observed-balances";
import { BankAccountsSchema, BankAccountRecordSchema, type BankAccountInput } from "@/utils/bank-accounts";
import { localFiatDemo } from "@/utils/local-fiat-demo";
import { UnifiedSnapshotSchema, UnifiedQuoteSchema, UnifiedOrderSchema, UnifiedCurrency, UnifiedQuoteInput } from "@/utils/unified-fiat";
import { FiatRouteSchema, FiatQuoteSchema, FiatOrderSchema, FiatSimulationEvent } from "@/utils/fiat";
import { z } from "zod";

import * as Sentry from "@sentry/react-native";

import {
  handleError,
  ErrorCode,
  ENTRY_SESSION_SEND_MESSAGE,
} from "@/utils/errors";
import { showToast } from "@/utils/toast";
import { AuthStorage } from "@/utils/storage/authStorage";
import {
  SEED_DEMO,
  seedAccount,
  seedProvisioningStep,
  seedRecoveryKeys,
  seedPendingChange,
  seedBalances,
  seedPrepareTransfer,
  seedSessions,
  seedTransfers,
  seedWallet,
} from "@/utils/devSeed";

/**
 * /auth/exchange request + response. Mirrors `ExchangeRequestSchema` and
 * `ExchangeResponseSchema` in `apps/backend/src/auth/dtos.ts`. Kept in sync
 * by hand; the backend types are not published as a workspace package today.
 */
export const ExchangeRequestSchema = z.object({
  privyIdToken: z.string().min(1),
  /**
   * Carried on the exchange that follows sign-up. It is what binds the passkey
   * just created to the address proved a moment earlier; without it the
   * backend would have nothing to attach the new Privy user to.
   */
  signupToken: z.string().min(1).optional(),
  /**
   * Present when the sign-in follows a proved inbox: the exchange must land
   * on this user or refuse, so a passkey for another account cannot quietly
   * replace the session the code opened.
   */
  expectUserId: z.string().min(1).optional(),
});
export type ExchangeRequest = z.infer<typeof ExchangeRequestSchema>;

export const ExchangeResponseSchema = z.object({
  token: z.string(),
  user: z.object({
    id: z.string(),
    // Null until the Consumer gives one: the passkey is the credential, so a
    // sign-up arrives with no email and a passkey sign-in never carries one.
    email: z.string().email().nullable(),
    walletAddress: z.string(),
    isNewUser: z.boolean(),
  }),
});
export type ExchangeResponse = z.infer<typeof ExchangeResponseSchema>;

// Mirrors `MirrorPasskeyCredentialSchema` in apps/backend/src/auth/dtos.ts.
export const MirrorPasskeyCredentialRequestSchema = z.object({
  credentialId: z.string().min(1).max(1024),
  publicKey: z.string().min(1).max(4096).optional(),
});
export type MirrorPasskeyCredentialRequest = z.infer<
  typeof MirrorPasskeyCredentialRequestSchema
>;

/** Mirrors the sign-up email responses in apps/backend/src/auth/dtos.ts. */
export const SignupEmailChallengeResponseSchema = z.object({
  sent: z.literal(true),
  expiresAt: z.string(),
});

/**
 * What proving an inbox earned. Mirrors `EmailProofOutcome` in
 * apps/backend/src/auth/signup.service.ts.
 *
 * `signup` is an address nobody held: the token binds the passkey created
 * next. `entry` is an address already on an account: a session that can look
 * and start a recovery, and nothing else. Which one only becomes known after
 * the code is right, so a stranger typing an address learns nothing.
 */
export const EmailProofResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("signup"),
    signupToken: z.string().min(1),
    expiresAt: z.string(),
  }),
  z.object({
    kind: z.literal("entry"),
    entryToken: z.string().min(1),
    expiresAt: z.string(),
    user: z.object({
      id: z.string(),
      email: z.string().email(),
      walletAddress: z.string(),
    }),
  }),
]);
export type EmailProofResponse = z.infer<typeof EmailProofResponseSchema>;
export type EntryProof = Extract<EmailProofResponse, { kind: "entry" }>;

export const MirrorPasskeyCredentialResponseSchema = z.object({
  mirrored: z.boolean(),
});
export type MirrorPasskeyCredentialResponse = z.infer<
  typeof MirrorPasskeyCredentialResponseSchema
>;

// Mirrors apps/backend/src/wallets/dtos.ts.
export const WalletResponseSchema = z.object({
  walletAddress: z.string(),
  provider: z.literal("privy"),
});
export type WalletResponse = z.infer<typeof WalletResponseSchema>;

/**
 * The Squads Account (ADR 0025). `address` is the vault PDA, which is the
 * Consumer's address everywhere: QR code, deposits, balance reads. The
 * settings account holds the signer set, never money, and is deliberately
 * not returned.
 */
/**
 * How much can leave the vault on one confirmation. Mirrors
 * `SpendingLimitResponseSchema` in apps/backend/src/account/dtos.ts.
 *
 * Amounts are integer strings at the mint's decimals, so read them with BigInt
 * rather than Number: a u64 does not survive JavaScript's number type.
 */
export const SpendingLimitSchema = z.object({
  mint: z.string(),
  maxPerUse: z.string(),
  maxPerPeriod: z.string(),
  remainingInPeriod: z.string(),
  period: z.enum(["OneTime", "Daily", "Weekly", "Monthly"]),
});
export type SpendingLimit = z.infer<typeof SpendingLimitSchema>;

export const AccountResponseSchema = z.object({
  address: z.string(),
  signers: z.object({ primary: z.string(), approval: z.string() }),
  /** The Consumer's Turnkey sub-organization, which the device stamps against. */
  approvalSubOrgId: z.string(),
  /**
   * Set while a device rotation is waiting out the time lock. Optional so an
   * older backend that does not report it is absent rather than "none".
   */
  pendingApprovalSigner: z.string().nullable().optional(),
  /** Set while a passkey replacement is waiting out the time lock. */
  pendingPrimarySigner: z.string().nullable().optional(),
  /**
   * The hardware key this Account enrolled with. Compared against the one on
   * this phone: a phone holding a different account's key is as unable to
   * approve as one holding none.
   */
  deviceKey: z.string().nullable().optional(),
  /**
   * Null means the Account has no limit, so every send takes two
   * confirmations. Absent means this backend does not report limits at all,
   * which is not the same answer and must not be shown as one.
   */
  spendingLimit: SpendingLimitSchema.nullable().optional(),
});
export type AccountResponse = z.infer<typeof AccountResponseSchema>;

export const EnrolmentNonceSchema = z.object({ nonce: z.string() });
export type EnrolmentNonce = z.infer<typeof EnrolmentNonceSchema>;

export const EnrolAccountResponseSchema = z.object({
  address: z.string(),
  security: z.enum(["secure_enclave", "strongbox", "tee"]),
});
export type EnrolAccountResponse = z.infer<typeof EnrolAccountResponseSchema>;

/**
 * One step of provisioning, or `done`.
 *
 * The transaction fields are absent when `done` is true, which is why they are
 * optional rather than defaulted: a blank transaction would be signable and
 * submittable, and would fail on chain instead of ending the loop.
 */
/**
 * A settings change staged against the Consumer's Account.
 *
 * `executableAt` is null until the change is approved, which is not the same as
 * safe: the time lock starts the moment the quorum is reached, and rejecting is
 * only possible before it elapses.
 */
export const StagedChangeSchema = z.object({
  transactionIndex: z.string(),
  status: z.string(),
  approvals: z.array(z.string()),
  executableAt: z.string().nullable(),
  /**
   * True when this Consumer started the change from this app.
   *
   * Softens the announcement rather than silencing it: the alarm is still what
   * a change nobody here staged gets, and a self-started one still shows on the
   * Keys & Recovery screen with a way to cancel it.
   */
  selfInitiated: z.boolean(),
});
export type StagedChange = z.infer<typeof StagedChangeSchema>;

export const PendingChangeResponseSchema = z.object({
  change: StagedChangeSchema.nullable(),
});

export const PreparedRejectionSchema = z.object({
  unsignedTxBase64: z.string(),
  blockhash: z.string(),
  lastValidBlockHeight: z.number(),
});
export type PreparedRejection = z.infer<typeof PreparedRejectionSchema>;

export const RejectionSubmitSchema = z.object({ signature: z.string() });

export const ProvisioningStepSchema = z.object({
  done: z.boolean(),
  change: z.enum(["provision"]).optional(),
  step: z
    .enum([
      "propose",
      "approve-primary",
      "approve-approval",
      "provision",
      "execute",
    ])
    .optional(),
  unsignedTxBase64: z.string().optional(),
  needsApprovalSignature: z.boolean(),
});
export type ProvisioningStep = z.infer<typeof ProvisioningStepSchema>;

export const ProvisioningSubmitSchema = z.object({ signature: z.string() });
export type ProvisioningSubmit = z.infer<typeof ProvisioningSubmitSchema>;

export const RecoveryKeySchema = z.object({
  id: z.string(),
  address: z.string(),
  channel: z.enum(["email", "external_wallet"]),
  /** The email address, or the external wallet's own address. */
  channelValue: z.string(),
  createdAt: z.string(),
  status: z.enum(["pending_add", "active", "pending_remove"]),
  removable: z.boolean(),
  /**
   * The key anchored on the address on file. Changing that address means
   * rotating this key, which is why it is the only one offered a Change
   * action and never a Delete.
   */
  isContactAddress: z.boolean().default(false),
});
export type RecoveryKey = z.infer<typeof RecoveryKeySchema>;

export const RecoveryKeysResponseSchema = z.object({
  keys: z.array(RecoveryKeySchema),
});

/**
 * A step of the settings change that adds or removes a recovery key.
 *
 * `waiting` has no transaction: the change is approved and serving out the
 * time lock, and `executableAt` says when it can be finished.
 */
export const RecoveryChangeStepSchema = z.object({
  done: z.boolean(),
  step: z
    .enum([
      "propose",
      "approve-primary",
      "approve-approval",
      "waiting",
      "execute",
    ])
    .optional(),
  unsignedTxBase64: z.string().optional(),
  changeIndex: z.string().optional(),
  executableAt: z.string().optional(),
  needsApprovalSignature: z.boolean().optional(),
});
export type RecoveryChangeStep = z.infer<typeof RecoveryChangeStepSchema>;

/**
 * A step of the settings change that moves the Spending Limit, or takes it off.
 *
 * `limit` is the limit the change installs, in the words the Consumer is
 * shown, so the screen and the notice say the same thing.
 */
export const SpendingLimitChangeStepSchema = z.object({
  done: z.boolean(),
  step: z
    .enum([
      "propose",
      "approve-primary",
      "approve-approval",
      "waiting",
      "execute",
    ])
    .optional(),
  unsignedTxBase64: z.string().optional(),
  changeIndex: z.string().optional(),
  executableAt: z.string().optional(),
  needsApprovalSignature: z.boolean().optional(),
  removing: z.boolean().optional(),
  creating: z.boolean().optional(),
  limit: z.string().optional(),
});
export type SpendingLimitChangeStep = z.infer<
  typeof SpendingLimitChangeStepSchema
>;

/**
 * A step of the settings change that moves the approval signer to this phone.
 *
 * `approve-recovery` never reaches the device: it is the one approval the
 * backend can produce, from the sealed recovery signer, once the Consumer has
 * proved their inbox.
 */
export const DeviceRotationStepSchema = z.object({
  done: z.boolean(),
  step: z
    .enum([
      "propose",
      "approve-primary",
      "approve-recovery",
      "waiting",
      "execute",
    ])
    .optional(),
  unsignedTxBase64: z.string().optional(),
  changeIndex: z.string().optional(),
  executableAt: z.string().optional(),
  newApprovalSigner: z.string().optional(),
});
export type DeviceRotationStep = z.infer<typeof DeviceRotationStepSchema>;

export const PrimaryRotationStepSchema = z.object({
  done: z.boolean(),
  step: z
    .enum([
      "propose",
      "approve-approval",
      "approve-recovery",
      "waiting",
      "execute",
    ])
    .optional(),
  unsignedTxBase64: z.string().optional(),
  changeIndex: z.string().optional(),
  needsApprovalSignature: z.boolean().optional(),
  executableAt: z.string().optional(),
  newPrimarySigner: z.string().optional(),
});
export type PrimaryRotationStep = z.infer<typeof PrimaryRotationStepSchema>;

export const AddRecoveryKeyResponseSchema = z.object({
  key: RecoveryKeySchema,
  plan: RecoveryChangeStepSchema,
});

export const RemoveRecoveryKeyResponseSchema = z.object({
  plan: RecoveryChangeStepSchema,
});

/** A contact address change: the key coming in, the one it retires, and the first step. */
export const RotateContactEmailResponseSchema = z.object({
  key: RecoveryKeySchema,
  retiring: RecoveryKeySchema,
  plan: RecoveryChangeStepSchema,
});

export const RecoveryChangeSubmitSchema = z.object({ signature: z.string() });

export const SweepPlanSchema = z.object({
  needed: z.boolean(),
  destination: z.string().optional(),
  balances: z.array(
    z.object({
      mint: z.string(),
      amountRaw: z.string(),
      decimals: z.number().int(),
    })
  ),
});
export type SweepPlan = z.infer<typeof SweepPlanSchema>;

export const TokenBalanceSchema = z.object({
  mint: z.string(),
  amountRaw: z.string(),
  decimals: z.number().int(),
  symbol: z.string().nullable(),
  /**
   * USD value of the holding, or null when nothing could price the mint.
   * Optional because the on-chain fallback read builds these locally and has
   * no price source of its own.
   */
  usdValue: z.number().nullish(),
  /** USD per whole token, or null when the mint could not be priced. */
  usdPrice: z.number().nullish(),
  /** Percent change over 24h, or null when nothing reports one. */
  priceChange24h: z.number().nullish(),
  /** What a Consumer calls it: "Solana". */
  name: z.string().nullish(),
  /** Absolute URL of the token's logo, when one is known. */
  iconUrl: z.string().nullish(),
});
export type TokenBalance = z.infer<typeof TokenBalanceSchema>;

export const BalancesResponseSchema = z.object({
  walletAddress: z.string(),
  tokens: z.array(TokenBalanceSchema),
  fetchedAtSlot: z.number().int(),
});
export type BalancesResponse = z.infer<typeof BalancesResponseSchema>;

export const NotificationPreferenceSchema = z.object({
  enabled: z.boolean(),
});

export const DeleteAccountResponseSchema = z.object({
  deleted: z.literal(true),
});
export type DeleteAccountResponse = z.infer<typeof DeleteAccountResponseSchema>;

// Mirrors apps/backend/src/transfer/dtos.ts.
export const PrepareTransferRequestSchema = z.object({
  toAddress: z.string(),
  mint: z.string(),
  amountRaw: z.string().regex(/^\d+$/),
  memo: z.string().max(120).optional(),
});
export type PrepareTransferRequest = z.infer<
  typeof PrepareTransferRequestSchema
>;

export const PrepareTransferResponseSchema = z.object({
  intentId: z.string(),
  unsignedTxBase64: z.string(),
  feeLamports: z.number().int().nonnegative(),
  expiresAt: z.string().datetime(),
  /**
   * Present once the Consumer has a Squads Account. True means the approval
   * signer must also sign before this can land, and submitting without it is
   * rejected on chain rather than refused politely.
   */
  needsApprovalSignature: z.boolean().optional(),
});
export type PrepareTransferResponse = z.infer<
  typeof PrepareTransferResponseSchema
>;

/**
 * A Payment waiting on this phone.
 *
 * Checkout can only reach the primary signer, so a Payment above the band that
 * signer carries alone is left for the Consumer to finish here, where the
 * approval signer lives.
 */
export const AwaitingPaymentSchema = z.object({
  reference: z.string(),
  merchantDisplayName: z.string(),
  /** ISO 4217, whatever the Merchant priced in. */
  displayCurrency: z.string(),
  displayAmountMinor: z.string(),
  /** When Checkout handed this over, which is when the Consumer was asked. */
  deferredAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type AwaitingPayment = z.infer<typeof AwaitingPaymentSchema>;

export const AwaitingPaymentsResponseSchema = z.object({
  payments: z.array(AwaitingPaymentSchema),
});

export const PreparePaymentResponseSchema = z.object({
  unsignedTxBase64: z.string(),
  needsApprovalSignature: z.boolean(),
});
export type PreparePaymentResponse = z.infer<
  typeof PreparePaymentResponseSchema
>;

export const SubmitPaymentResponseSchema = z.object({
  signature: z.string(),
});

export const SubmitTransferRequestSchema = z.object({
  intentId: z.string(),
  signedTxBase64: z.string(),
  /**
   * The device key's signature over the prepared message, proving the Consumer
   * was here. Required by the backend for a send that settles on one signature;
   * omitted above the limit, where the approval signature already is one.
   */
  presenceProof: z.string().optional(),
});
export type SubmitTransferRequest = z.infer<typeof SubmitTransferRequestSchema>;

export const SubmitTransferResponseSchema = z.object({
  transferId: z.string(),
  signature: z.string(),
  status: z.literal("PENDING"),
});
export type SubmitTransferResponse = z.infer<
  typeof SubmitTransferResponseSchema
>;

export const TransferRowSchema = z.object({
  id: z.string(),
  direction: z.enum(["SEND", "RECEIVE"]),
  mint: z.string(),
  amountRaw: z.string(),
  fromAddress: z.string(),
  toAddress: z.string(),
  status: z.enum(["PENDING", "CONFIRMED", "FAILED"]),
  signature: z.string().nullable(),
  memo: z.string().nullable(),
  // Mirrors apps/backend/src/transfer/dtos.ts TransferRowSchema field-for-field.
  // Lowercase literals bind to Phase 4's transfer_kind enum; the wire literal
  // is the presentation literal (never uppercased).
  kind: z.enum(["transfer", "payment"]),
  merchantName: z.string().nullable(),
  /**
   * What the transfer was worth in USD when it happened, as a decimal string.
   * Frozen server-side at index time, never re-priced on read.
   */
  usdValue: z.string().nullish(),
  /** The mint's decimals, as the chain reported them on this transaction. */
  decimals: z.number().int().nullish(),
  /**
   * The token's identity, resolved per row so it survives the Consumer
   * selling the token: history has to keep describing itself after the
   * balance is gone.
   */
  tokenName: z.string().nullish(),
  tokenSymbol: z.string().nullish(),
  tokenIconUrl: z.string().nullish(),
  createdAt: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable(),
});
export type TransferRow = z.infer<typeof TransferRowSchema>;

/**
 * Backend returns `{ transfers: [...], nextCursor: ... }`
 * (apps/backend/src/transfer/dtos.ts → ListTransfersResponseSchema).
 * The mobile field name is preserved from the backend; do not re-key on
 * the client.
 */
/**
 * Something that happened to the Account that was not money moving.
 *
 * Kept out of `transfers` on purpose: the balance chart walks that array, and
 * an entry with no amount in it would be read as a zero-value movement.
 */
export const AccountEventRowSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "recovery_key_added",
    "recovery_key_removed",
    "wallet_renamed",
  ]),
  subject: z.string().nullable(),
  previousSubject: z.string().nullable(),
  signature: z.string().nullable(),
  occurredAt: z.string(),
});
export type AccountEventRow = z.infer<typeof AccountEventRowSchema>;

export const TransferListResponseSchema = z.object({
  transfers: z.array(TransferRowSchema),
  // Defaulted: the on-chain fallback path builds a page without them, and a
  // page with no events is not an error.
  events: z.array(AccountEventRowSchema).default([]),
  nextCursor: z.string().nullable(),
});
export type TransferListResponse = z.infer<typeof TransferListResponseSchema>;

/**
 * Merchant Sessions the Consumer has granted. Mirrors Phase 2's
 * SessionSummary (apps/backend/src/session, GET /consumers/me/sessions):
 * one row per active merchant Session, all timestamps ISO strings.
 */
export const SessionSummarySchema = z.object({
  id: z.string(),
  merchantDisplayName: z.string(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const ListSessionsResponseSchema = z.object({
  sessions: z.array(SessionSummarySchema),
});
export type ListSessionsResponse = z.infer<typeof ListSessionsResponseSchema>;

export const RevokeSessionResponseSchema = z.object({
  revoked: z.literal(true),
});
export type RevokeSessionResponse = z.infer<typeof RevokeSessionResponseSchema>;

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: any
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The HTTP status behind a rejected request, or null if it never reached one. */
export function apiErrorStatus(err: unknown): number | null {
  return err instanceof ApiError ? err.status : null;
}

/** The backend's typed refusal, when the response body carried one. */
export function apiErrorCode(err: unknown): string | null {
  const code = err instanceof ApiError ? err.data?.code : null;
  return typeof code === "string" ? code : null;
}

/** The sentence the backend sent with a typed refusal, when there was one. */
export function apiErrorMessage(err: unknown): string | null {
  const message = err instanceof ApiError ? err.data?.message : null;
  return typeof message === "string" ? message : null;
}

/** The masked address a mismatched passkey actually opens, when named. */
export function apiErrorMaskedEmail(err: unknown): string | null {
  const masked = err instanceof ApiError ? err.data?.maskedEmail : null;
  return typeof masked === "string" ? masked : null;
}

class BackendClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;

  constructor() {
    this.validateEnv();
    this.baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL!;
    this.defaultHeaders = {
      "Content-Type": "application/json",
    };
  }

  async nairaTransfers() {
    return NairaTransfersSchema.parse(await this.request<unknown>("/fiat/banking/transfers", { auth: true }));
  }
  async quoteNairaTransfer(destinationAccountNumber: string, amountMinor: string) {
    return NairaTransferSchema.parse(await this.request<unknown>("/fiat/banking/transfers/quotes", { auth: true, method: "POST", body: JSON.stringify({destinationAccountNumber,amountMinor}) }));
  }
  async sendNairaTransfer(quoteId: string, idempotencyKey: string) {
    return NairaTransferSchema.parse(await this.request<unknown>("/fiat/banking/transfers", { auth: true, method: "POST", body: JSON.stringify({quoteId,idempotencyKey}) }));
  }
  async observedBalances() {
    return ObservedBalancesSchema.parse(await this.request<unknown>("/fiat/balances", { auth: true }));
  }
  async bankAccounts() {
    return BankAccountsSchema.parse(await this.request<unknown>("/fiat/banking/accounts", { auth: true }));
  }
  async reconcileBankAccount(accountId: string) {
    return BankAccountRecordSchema.parse(await this.request<unknown>("/fiat/banking/accounts/reconcile", { auth: true, method: "POST", body: JSON.stringify({ accountId }) }));
  }
  async createBankAccount(input: BankAccountInput) {
    return BankAccountRecordSchema.parse(await this.request<unknown>("/fiat/banking/accounts", { auth: true, method: "POST", body: JSON.stringify(input) }));
  }
  async unifiedFiat(displayCurrency: "USD" | "NGN") {
    return UnifiedSnapshotSchema.parse(await this.request<unknown>(`/fiat/unified?displayCurrency=${displayCurrency}`, { auth: true }));
  }
  async unifiedReceive(currency: UnifiedCurrency, amountMinor: string, idempotencyKey: string) {
    return this.request<unknown>("/fiat/unified/receive", { auth: true, method: "POST", body: JSON.stringify({ currency, amountMinor, idempotencyKey }) });
  }
  async unifiedQuote(input: UnifiedQuoteInput) {
    return UnifiedQuoteSchema.parse(await this.request<unknown>("/fiat/unified/quotes", { auth: true, method: "POST", body: JSON.stringify(input) }));
  }
  async unifiedCreateOrder(quoteId: string, idempotencyKey: string, autoAdvance = true) {
    return UnifiedOrderSchema.parse(await this.request<unknown>("/fiat/unified/orders", { auth: true, method: "POST", body: JSON.stringify({ quoteId, idempotencyKey, autoAdvance }) }));
  }
  async unifiedAdvance(id: string, action: "advance" | "fail", idempotencyKey: string) {
    return UnifiedOrderSchema.parse(await this.request<unknown>(`/fiat/unified/orders/${encodeURIComponent(id)}/advance`, { auth: true, method: "POST", body: JSON.stringify({ action, idempotencyKey }) }));
  }
  async fiatRoutes() {
    return z.object({ routes: z.array(FiatRouteSchema) }).parse(await this.request<unknown>("/fiat/routes", { auth: true }));
  }
  async fiatQuote(routeId: string, amountMinor: string) {
    return FiatQuoteSchema.parse(await this.request<unknown>("/fiat/quotes", { auth: true, method: "POST", body: JSON.stringify({ routeId, amountMinor }) }));
  }
  async fiatCreateOrder(quoteId: string, idempotencyKey: string, fields: Record<string, string>) {
    return FiatOrderSchema.parse(await this.request<unknown>("/fiat/orders", { auth: true, method: "POST", body: JSON.stringify({ quoteId, idempotencyKey, fields }) }));
  }
  async fiatOrders() {
    return z.object({ orders: z.array(FiatOrderSchema) }).parse(await this.request<unknown>("/fiat/orders", { auth: true }));
  }
  async fiatOrder(id: string) {
    return FiatOrderSchema.parse(await this.request<unknown>(`/fiat/orders/${encodeURIComponent(id)}`, { auth: true }));
  }
  async fiatSimulate(id: string, event: FiatSimulationEvent, idempotencyKey: string) {
    return FiatOrderSchema.parse(await this.request<unknown>(`/fiat/orders/${encodeURIComponent(id)}/simulate`, { auth: true, method: "POST", body: JSON.stringify({ event, idempotencyKey }) }));
  }

  private validateEnv() {
    if (!process.env.EXPO_PUBLIC_BACKEND_URL) {
      throw new Error(
        "Missing required environment variable: EXPO_PUBLIC_BACKEND_URL"
      );
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit & { auth?: boolean } = {}
  ): Promise<T> {
    try {
      const localSimulation = localFiatDemo && (/^\/fiat\/unified(?:[/?]|$)/.test(endpoint) || endpoint === "/fiat/banking/accounts" || endpoint === "/fiat/banking/accounts/reconcile" || endpoint === "/fiat/balances" || endpoint === "/fiat/banking/transfers" || endpoint === "/fiat/banking/transfers/quotes");
      if (localSimulation) options = { ...options, auth: false, headers: { ...options.headers, "x-xend-local-simulation": "1" } };
      const url = `${this.baseUrl}${localSimulation ? "/dev" : ""}${endpoint}`;

      // Attach the Bearer JWT from AuthStorage only when `auth: true` is set.
      const authHeaders: Record<string, string> = {};
      if (options.auth) {
        const token = await AuthStorage.getToken();
        if (token) {
          authHeaders["Authorization"] = `Bearer ${token}`;
        } else if (__DEV__) {
          // Sent anyway, because a caller racing a sign-in should recover on
          // its next attempt rather than throw. It does come back 401, and a
          // 401 earned this way is indistinguishable from an expired session
          // or a rejected token, so say which one it was.
          console.warn(
            `[api] ${endpoint} needs auth and no token is stored yet; it will 401`
          );
        }
      }

      const fetchOptions: RequestInit = {
        ...options,
        // Never read from, or write to, the platform HTTP cache. That cache is
        // keyed on the URL and knows nothing about the bearer token, so a
        // device that switches Consumers can be handed the previous one's
        // response for the same path.
        cache: "no-store",
        headers: {
          ...this.defaultHeaders,
          ...authHeaders,
          ...options.headers,
        },
      };
      // Remove our internal flag before fetch sees it.
      delete (fetchOptions as { auth?: boolean }).auth;

      if ((options.method ?? "GET").toUpperCase() === "GET") {
        delete fetchOptions.body;
      } else if (fetchOptions.body === undefined) {
        // React Native's fetch puts a single NUL byte on the wire for a POST
        // with no body (Content-Length: 1). Paired with the JSON content type
        // above, Express rejects it as malformed JSON before any guard or
        // handler runs, so the route 400s and nothing is logged. An explicit
        // empty object is the smallest thing that parses.
        fetchOptions.body = "{}";
      }

      const response = await fetch(url, fetchOptions);

      // A 304 says "your cached copy is still good", and this client keeps no
      // cache to answer with, so there is no body to return and nothing the
      // caller can do. `no-store` above should mean we never ask a conditional
      // question, but a proxy in between can still answer one.
      if (response.status === 304) {
        throw new ApiError(
          `BackendClient: ${endpoint} answered 304 with no body to use`,
          304,
          undefined
        );
      }

      if (!response.ok) {
        const errorData = await response.json().catch((parseError) => {
          Sentry.captureException(parseError, {
            tags: { api: "error-body", endpoint, status: response.status },
          });
          return undefined;
        });

        // 401 on an authed endpoint → token is invalid or expired. Clear the
        // local JWT so the next app start re-exchanges against the Privy
        // session (which may have auto-refreshed). Do NOT force-logout here:
        // it would break the confirm flow, and screens decide their own UX
        // response (toast / retry / redirect).
        if (response.status === 401 && options.auth) {
          await AuthStorage.saveToken("").catch(() => {});
        }

        // Refused for what the session is rather than what was asked: an
        // entry session reached for something only the passkey may do.
        if (
          response.status === 403 &&
          errorData?.code === "ENTRY_SESSION_FORBIDDEN"
        ) {
          showToast(ENTRY_SESSION_SEND_MESSAGE);
        }

        if (errorData?.details?.[0]?.code) {
          const code = errorData.details[0].code as ErrorCode;
          const errorCodesToDisplay = [ErrorCode.OTP_RATE_LIMIT];

          if (errorCodesToDisplay.includes(code as ErrorCode)) {
            handleError(code, true, true);
          } else {
            handleError(code, true, false);
          }
        }

        throw new ApiError(
          "BackendClient: Request failed",
          response.status,
          errorData
        );
      }

      // 204 carries no body by definition, and some endpoints have nothing to
      // say beyond "recorded". Parsing that as JSON throws, which turns a
      // succeeded request into a caller-visible failure.
      if (response.status === 204) return undefined as T;

      return await response.json();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error("BackendClient: Unexpected error in request():", error);
      handleError(ErrorCode.UNKNOWN_ERROR, true, false);
      throw error;
    }
  }

  /**
   * Exchange a Privy ID token for our backend JWT.
   *
   * Calls `POST /auth/exchange` on the NestJS backend; the backend verifies
   * the token against Privy's JWKS, upserts the `users` + `smart_accounts`
   * row, and returns `{ token, user: { id, email, walletAddress, isNewUser } }`.
   *
   * The caller is `AuthContext`; the returned JWT is
   * persisted via `AuthStorage.saveToken` and used as the Bearer on every
   * subsequent NestJS request.
   *
   * Response is validated with `ExchangeResponseSchema` so any backend drift
   * fails loudly at the network boundary rather than silently in screens.
   */
  async exchange(req: ExchangeRequest): Promise<ExchangeResponse> {
    const raw = await this.request<unknown>("/auth/exchange", {
      method: "POST",
      body: JSON.stringify(ExchangeRequestSchema.parse(req)),
    });
    return ExchangeResponseSchema.parse(raw);
  }

  /**
   * POST /auth/signup/email/challenge: the first step of sign-up, before any
   * session exists. Answers the same way whether or not the address already
   * has an account, so a code not arriving is the only signal there is.
   */
  async requestSignupEmailCode(email: string): Promise<void> {
    const raw = await this.request<unknown>("/auth/signup/email/challenge", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    SignupEmailChallengeResponseSchema.parse(raw);
  }

  /**
   * POST /auth/signup/email: proves the address and returns what it earned,
   * a sign-up token for a new account or an entry session for an existing
   * one. Both are single-purpose and short-lived.
   */
  async verifySignupEmail(
    email: string,
    code: string
  ): Promise<EmailProofResponse> {
    const raw = await this.request<unknown>("/auth/signup/email", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    });
    return EmailProofResponseSchema.parse(raw);
  }

  /**
   * POST /auth/signout: ends the session behind the stored token. Only an
   * entry session has anything to revoke server-side; a JWT is simply
   * forgotten, so this is called before the token is dropped.
   */
  async signOut(): Promise<void> {
    await this.request<unknown>("/auth/signout", {
      method: "POST",
      auth: true,
    });
  }

  /**
   * POST /auth/email/challenge: sends a code to an address a signed-in
   * Consumer with no address on file is claiming.
   *
   * Refused with 409 when the address is already on another Account, before
   * anything is mailed.
   */
  async requestContactEmailCode(email: string): Promise<void> {
    await this.request<unknown>("/auth/email/challenge", {
      method: "POST",
      body: JSON.stringify({ email }),
      auth: true,
    });
  }

  /**
   * POST /auth/email: records the address, with the code that proves it.
   *
   * The code is required: the recovery signer is anchored on this address, so
   * an unproved one leaves the only route back pointing at an inbox nobody
   * reads.
   */
  async setContactEmail(email: string, code: string): Promise<void> {
    await this.request<unknown>("/auth/email", {
      method: "POST",
      body: JSON.stringify({ email, code }),
      auth: true,
    });
  }

  /** POST /auth/passkey-credentials — mirror a freshly enrolled passkey
   *  credential (credentialId + optional publicKey) for the authenticated
   *  Consumer. Called fire-and-forget from the enrollment hook; a failure
   *  must never block or surface in enrollment. */
  async mirrorPasskeyCredential(
    req: MirrorPasskeyCredentialRequest
  ): Promise<MirrorPasskeyCredentialResponse> {
    const raw = await this.request<unknown>("/auth/passkey-credentials", {
      method: "POST",
      body: JSON.stringify(MirrorPasskeyCredentialRequestSchema.parse(req)),
      auth: true,
    });
    return MirrorPasskeyCredentialResponseSchema.parse(raw);
  }

  /** GET /wallet/me — returns the authenticated user's Privy embedded
   *  Solana wallet address. */
  async getWallet(): Promise<WalletResponse> {
    if (SEED_DEMO) return seedWallet();
    const raw = await this.request<unknown>("/wallet/me", {
      method: "GET",
      auth: true,
    });
    return WalletResponseSchema.parse(raw);
  }

  /** GET /wallet/me/balances — returns the full SPL token balance list. The
   *  client filters for headline currencies (USDC + USDT); the full list is
   *  preserved so a future Investments screen can list every mint. */

  /**
   * GET /account/me — the Consumer's Squads Account, or null before one
   * exists. A 404 is the ordinary pre-enrolment state rather than an error,
   * so it is mapped to null instead of thrown.
   */
  async getAccount(): Promise<AccountResponse | null> {
    if (SEED_DEMO) return seedAccount();
    try {
      const raw = await this.request<unknown>("/account/me", {
        method: "GET",
        auth: true,
      });
      return AccountResponseSchema.parse(raw);
    } catch (err: any) {
      // Only our own "no Account yet", never any 404. A tunnel or a proxy
      // answering 404 is an outage, and reading it as "this Consumer has no
      // Account" tells a finished Consumer their sign-up is unfinished.
      if (err?.data?.code === "NO_ACCOUNT") return null;
      throw err;
    }
  }

  /** POST /account/enrolment/nonce — the challenge the device attests over. */
  async requestEnrolmentNonce(): Promise<EnrolmentNonce> {
    const raw = await this.request<unknown>("/account/enrolment/nonce", {
      method: "POST",
      auth: true,
    });
    return EnrolmentNonceSchema.parse(raw);
  }

  /**
   * POST /account/enrolment — creates the Account.
   *
   * Deliberately carries neither the public key nor the recovery signer: the
   * backend takes the key from the attestation it verified and mints the
   * recovery signer itself, so this request cannot nominate either.
   */
  async enrolAccount(
    body:
      | {
          platform: "ios" | "android";
          attestation: string;
          nonce: string;
          /** iOS: the Secure Enclave key the attested challenge commits to. */
          hardwarePublicKey?: string;
        }
      | { hardwarePublicKey: string }
  ): Promise<EnrolAccountResponse> {
    const raw = await this.request<unknown>("/account/enrolment", {
      method: "POST",
      body: JSON.stringify(body),
      auth: true,
    });
    return EnrolAccountResponseSchema.parse(raw);
  }

  /**
   * POST /account/provisioning/next — the next step to sign, or `done`.
   *
   * The backend re-derives this from chain state on every call, so it is safe
   * to call again after an interruption and there is no cursor to carry.
   */
  async nextProvisioningStep(): Promise<ProvisioningStep> {
    if (SEED_DEMO) return seedProvisioningStep();
    const raw = await this.request<unknown>("/account/provisioning/next", {
      method: "POST",
      auth: true,
    });
    return ProvisioningStepSchema.parse(raw);
  }

  /** POST /account/provisioning/submit — lands a signed step. */
  async submitProvisioningStep(body: {
    signedTxBase64: string;
  }): Promise<ProvisioningSubmit> {
    const raw = await this.request<unknown>("/account/provisioning/submit", {
      method: "POST",
      body: JSON.stringify(body),
      auth: true,
    });
    return ProvisioningSubmitSchema.parse(raw);
  }

  /** GET /account/changes/pending — a settings change awaiting a decision. */
  async getPendingAccountChange(): Promise<StagedChange | null> {
    if (SEED_DEMO) return seedPendingChange();
    const raw = await this.request<unknown>("/account/changes/pending", {
      method: "GET",
      auth: true,
    });
    return PendingChangeResponseSchema.parse(raw).change;
  }

  /** POST /account/changes/reject/prepare — the rejection to sign. */
  async prepareChangeRejection(): Promise<PreparedRejection> {
    const raw = await this.request<unknown>("/account/changes/reject/prepare", {
      method: "POST",
      auth: true,
    });
    return PreparedRejectionSchema.parse(raw);
  }

  /** POST /account/changes/reject/submit — lands the signed rejection. */
  async submitChangeRejection(body: {
    signedTxBase64: string;
  }): Promise<{ signature: string }> {
    const raw = await this.request<unknown>("/account/changes/reject/submit", {
      method: "POST",
      body: JSON.stringify(body),
      auth: true,
    });
    return RejectionSubmitSchema.parse(raw);
  }

  /** GET /account/recovery — the Consumer's recovery keys. */
  async getRecoveryKeys(): Promise<RecoveryKey[]> {
    if (SEED_DEMO) return seedRecoveryKeys();
    const raw = await this.request<unknown>("/account/recovery", {
      method: "GET",
      auth: true,
    });
    return RecoveryKeysResponseSchema.parse(raw).keys;
  }

  /** POST /account/recovery/external-wallet — stages a wallet as a recovery key. */
  async addRecoveryWallet(body: { address: string }) {
    const raw = await this.request<unknown>(
      "/account/recovery/external-wallet",
      {
        method: "POST",
        body: JSON.stringify(body),
        auth: true,
      }
    );
    return AddRecoveryKeyResponseSchema.parse(raw);
  }

  /**
   * POST /account/recovery/email/challenge — sends a code to an address being
   * offered as a recovery key. Refused before mailing if it is already one.
   */
  /** POST /account/recovery/device/challenge — mails a code to the address on file. */
  async requestDeviceRotationCode(): Promise<{ expiresAt: string }> {
    return this.request<{ expiresAt: string }>(
      "/account/recovery/device/challenge",
      { method: "POST", auth: true }
    );
  }

  /** POST /account/recovery/device/verify — turns the code into a grant. */
  async verifyDeviceRotationCode(code: string): Promise<{ grantId: string }> {
    return this.request<{ grantId: string }>(
      "/account/recovery/device/verify",
      { method: "POST", body: JSON.stringify({ code }), auth: true }
    );
  }

  /**
   * POST /account/recovery/device/start — enrols this phone's hardware key and
   * stages the swap. Attested, exactly like enrolment.
   */
  async startDeviceRotation(body: {
    grantId: string;
    platform?: string;
    attestation?: string;
    nonce?: string;
    hardwarePublicKey?: string;
  }) {
    const raw = await this.request<unknown>("/account/recovery/device/start", {
      method: "POST",
      body: JSON.stringify(body),
      auth: true,
    });
    return DeviceRotationStepSchema.parse(raw);
  }

  /** POST /account/recovery/device/next — the next step, re-read from chain. */
  async nextDeviceRotationStep(grantId?: string) {
    const raw = await this.request<unknown>("/account/recovery/device/next", {
      method: "POST",
      body: JSON.stringify(grantId ? { grantId } : {}),
      auth: true,
    });
    return DeviceRotationStepSchema.parse(raw);
  }

  /** POST /account/recovery/device/submit — hands back a signed step. */
  async submitDeviceRotationStep(body: { signedTxBase64: string }) {
    const raw = await this.request<unknown>("/account/recovery/device/submit", {
      method: "POST",
      body: JSON.stringify(body),
      auth: true,
    });
    return RecoveryChangeSubmitSchema.parse(raw);
  }

  /** POST /account/recovery/primary/challenge: mails a code to the address on file. */
  async requestPasskeyRotationCode(): Promise<{ expiresAt: string }> {
    return this.request<{ expiresAt: string }>(
      "/account/recovery/primary/challenge",
      { method: "POST", auth: true }
    );
  }

  /** POST /account/recovery/primary/verify: turns the code into a grant. */
  async verifyPasskeyRotationCode(code: string): Promise<{ grantId: string }> {
    return this.request<{ grantId: string }>(
      "/account/recovery/primary/verify",
      { method: "POST", body: JSON.stringify({ code }), auth: true }
    );
  }

  /**
   * POST /account/recovery/primary/start: verifies the fresh passkey's
   * identity token and stages the swap that puts its wallet in the signer set.
   */
  async startPrimaryRotation(body: { grantId: string; privyIdToken: string }) {
    const raw = await this.request<unknown>("/account/recovery/primary/start", {
      method: "POST",
      body: JSON.stringify(body),
      auth: true,
    });
    return PrimaryRotationStepSchema.parse(raw);
  }

  /** POST /account/recovery/primary/next: the next step, re-read from chain. */
  async nextPrimaryRotationStep(grantId?: string) {
    const raw = await this.request<unknown>("/account/recovery/primary/next", {
      method: "POST",
      body: JSON.stringify(grantId ? { grantId } : {}),
      auth: true,
    });
    return PrimaryRotationStepSchema.parse(raw);
  }

  /** POST /account/recovery/primary/submit: hands back a signed step. */
  async submitPrimaryRotationStep(body: { signedTxBase64: string }) {
    const raw = await this.request<unknown>(
      "/account/recovery/primary/submit",
      { method: "POST", body: JSON.stringify(body), auth: true }
    );
    return RecoveryChangeSubmitSchema.parse(raw);
  }

  async requestRecoveryEmailCode(email: string): Promise<void> {
    await this.request<unknown>("/account/recovery/email/challenge", {
      method: "POST",
      body: JSON.stringify({ email }),
      auth: true,
    });
  }

  /**
   * POST /account/recovery/email — stages a proved address as a recovery key
   * and starts the settings change that carries it.
   */
  /**
   * POST /account/recovery/email/verify — checks the code and returns the
   * grant the review step spends.
   */
  async verifyRecoveryEmail(body: { email: string; code: string }) {
    const raw = await this.request<{ grantId: string }>(
      "/account/recovery/email/verify",
      {
        method: "POST",
        body: JSON.stringify(body),
        auth: true,
      }
    );
    return raw;
  }

  async addRecoveryEmail(body: { email: string; grantId: string }) {
    const raw = await this.request<unknown>("/account/recovery/email", {
      method: "POST",
      body: JSON.stringify(body),
      auth: true,
    });
    return AddRecoveryKeyResponseSchema.parse(raw);
  }

  /**
   * POST /account/recovery/contact/challenge: sends a code to the address
   * that will replace the one on file. Refused before mailing when it is
   * already a recovery key here or on another account.
   */
  async requestContactRotationCode(email: string): Promise<void> {
    await this.request<unknown>("/account/recovery/contact/challenge", {
      method: "POST",
      body: JSON.stringify({ email }),
      auth: true,
    });
  }

  /** POST /account/recovery/contact/verify: checks the code and returns the grant. */
  async verifyContactRotation(body: { email: string; code: string }) {
    return this.request<{ grantId: string }>(
      "/account/recovery/contact/verify",
      {
        method: "POST",
        body: JSON.stringify(body),
        auth: true,
      }
    );
  }

  /**
   * POST /account/recovery/contact: stages the change that moves the
   * contact address and starts it. The address on file moves only when the
   * change executes, a day after both Active Keys approve it.
   */
  async rotateContactEmail(body: { email: string; grantId: string }) {
    const raw = await this.request<unknown>("/account/recovery/contact", {
      method: "POST",
      body: JSON.stringify(body),
      auth: true,
    });
    return RotateContactEmailResponseSchema.parse(raw);
  }

  /** POST /account/recovery/:id/remove — stages a recovery key's removal. */
  async removeRecoveryKey(id: string) {
    const raw = await this.request<unknown>(`/account/recovery/${id}/remove`, {
      method: "POST",
      auth: true,
    });
    return RemoveRecoveryKeyResponseSchema.parse(raw);
  }

  /** POST /account/recovery/change/next — the next step, or done. */
  async nextRecoveryChangeStep(): Promise<RecoveryChangeStep> {
    const raw = await this.request<unknown>("/account/recovery/change/next", {
      method: "POST",
      auth: true,
    });
    return RecoveryChangeStepSchema.parse(raw);
  }

  /** POST /account/recovery/change/submit — lands a signed step. */
  async submitRecoveryChangeStep(body: {
    signedTxBase64: string;
  }): Promise<{ signature: string }> {
    const raw = await this.request<unknown>("/account/recovery/change/submit", {
      method: "POST",
      body: JSON.stringify(body),
      auth: true,
    });
    return RecoveryChangeSubmitSchema.parse(raw);
  }

  /**
   * POST /account/limits/spending/start: stages a new limit, or its removal.
   *
   * `maxPerPeriod` is in the mint's smallest units, as an integer string: the
   * caps do not survive JSON's number, and the ones in use today only just do.
   */
  async startSpendingLimitChange(
    body: { maxPerPeriod: string } | { remove: true }
  ): Promise<SpendingLimitChangeStep> {
    const raw = await this.request<unknown>("/account/limits/spending/start", {
      method: "POST",
      body: JSON.stringify(body),
      auth: true,
    });
    return SpendingLimitChangeStepSchema.parse(raw);
  }

  /** POST /account/limits/spending/next: the next step, or done. */
  async nextSpendingLimitChangeStep(): Promise<SpendingLimitChangeStep> {
    const raw = await this.request<unknown>("/account/limits/spending/next", {
      method: "POST",
      auth: true,
    });
    return SpendingLimitChangeStepSchema.parse(raw);
  }

  /** POST /account/limits/spending/submit: lands a signed step. */
  async submitSpendingLimitChangeStep(body: {
    signedTxBase64: string;
  }): Promise<{ signature: string }> {
    const raw = await this.request<unknown>("/account/limits/spending/submit", {
      method: "POST",
      body: JSON.stringify(body),
      auth: true,
    });
    return RecoveryChangeSubmitSchema.parse(raw);
  }

  /** GET /account/sweep — what is still in the Privy wallet after enrolment. */
  async getSweepPlan(): Promise<SweepPlan> {
    const raw = await this.request<unknown>("/account/sweep", {
      method: "GET",
      auth: true,
    });
    return SweepPlanSchema.parse(raw);
  }

  /** Records where this installation's notifications should go. */
  async registerPushDevice(req: {
    token: string;
    platform: "ios" | "android";
  }): Promise<void> {
    // The demo seed has no JWT, so an authed call here just 401s in a loop
    // behind the offline screens it exists to render.
    if (SEED_DEMO) return;
    await this.request<unknown>("/notifications/devices", {
      method: "POST",
      auth: true,
      body: JSON.stringify(req),
    });
  }

  /** Forgets this installation, on sign-out. */
  async forgetPushDevice(token: string): Promise<void> {
    if (SEED_DEMO) return;
    await this.request<unknown>("/notifications/devices", {
      method: "DELETE",
      auth: true,
      body: JSON.stringify({ token }),
    });
  }

  async getNotificationPreference(): Promise<boolean> {
    if (SEED_DEMO) return true;
    const raw = await this.request<unknown>("/notifications/preferences", {
      method: "GET",
      auth: true,
    });
    return NotificationPreferenceSchema.parse(raw).enabled;
  }

  async setNotificationPreference(enabled: boolean): Promise<boolean> {
    if (SEED_DEMO) return enabled;
    const raw = await this.request<unknown>("/notifications/preferences", {
      method: "PUT",
      auth: true,
      body: JSON.stringify({ enabled }),
    });
    return NotificationPreferenceSchema.parse(raw).enabled;
  }

  async getBalances(): Promise<BalancesResponse> {
    if (SEED_DEMO) return seedBalances();
    const raw = await this.request<unknown>("/wallet/me/balances", {
      method: "GET",
      auth: true,
    });
    return BalancesResponseSchema.parse(raw);
  }

  /** DELETE /wallet/me — closes the Consumer's Xend account. Rejects with a
   *  409 `{code: "ACCOUNT_HAS_BALANCE"}` while any token balance remains;
   *  the caller is responsible for the zero-balance check and for handling
   *  that response (see DeleteAccountModal). */
  async deleteAccount(): Promise<DeleteAccountResponse> {
    const raw = await this.request<unknown>("/wallet/me", {
      method: "DELETE",
      auth: true,
    });
    return DeleteAccountResponseSchema.parse(raw);
  }

  /** POST /transfers/prepare — backend builds an unsigned v0 transaction
   *  and returns its base64 form alongside an `intentId`. The mobile app
   *  signs with the Privy embedded wallet and calls `submitTransfer`. */
  async prepareTransfer(
    req: PrepareTransferRequest
  ): Promise<PrepareTransferResponse> {
    if (SEED_DEMO) return seedPrepareTransfer();
    const raw = await this.request<unknown>("/transfers/prepare", {
      method: "POST",
      body: JSON.stringify(PrepareTransferRequestSchema.parse(req)),
      auth: true,
    });
    return PrepareTransferResponseSchema.parse(raw);
  }

  /** POST /transfers/submit — backend forwards the signed transaction to
   *  the Solana RPC and creates a transfers row in PENDING. The RPC
   *  tailer transitions it to CONFIRMED / FAILED asynchronously. */
  async submitTransfer(
    req: SubmitTransferRequest
  ): Promise<SubmitTransferResponse> {
    const raw = await this.request<unknown>("/transfers/submit", {
      method: "POST",
      body: JSON.stringify(SubmitTransferRequestSchema.parse(req)),
      auth: true,
    });
    return SubmitTransferResponseSchema.parse(raw);
  }

  /** GET /payments/pending — Payments a Merchant is waiting on, that only
   *  this phone can finish. */
  async listAwaitingPayments(): Promise<AwaitingPayment[]> {
    if (SEED_DEMO) return [];
    const raw = await this.request<unknown>("/payments/pending", {
      auth: true,
    });
    return AwaitingPaymentsResponseSchema.parse(raw).payments;
  }

  /** POST /payments/pending/:reference/prepare — builds the Spend and
   *  authorizes the Payment. The transaction comes back needing both signers. */
  async preparePayment(reference: string): Promise<PreparePaymentResponse> {
    const raw = await this.request<unknown>(
      `/payments/pending/${encodeURIComponent(reference)}/prepare`,
      { method: "POST", auth: true }
    );
    return PreparePaymentResponseSchema.parse(raw);
  }

  /** POST /payments/pending/:reference/submit — the fee payer completes and
   *  broadcasts what this phone signed. */
  async submitPayment(
    reference: string,
    signedTxBase64: string
  ): Promise<string> {
    const raw = await this.request<unknown>(
      `/payments/pending/${encodeURIComponent(reference)}/submit`,
      { method: "POST", body: JSON.stringify({ signedTxBase64 }), auth: true }
    );
    return SubmitPaymentResponseSchema.parse(raw).signature;
  }

  /** GET /transfers — cursor-paginated list of the authenticated user's
   *  transfers (SEND + RECEIVE union). Used by the Activity feed. */
  async listTransfers(req?: {
    cursor?: string;
    limit?: number;
  }): Promise<TransferListResponse> {
    if (SEED_DEMO) return seedTransfers();
    const search = new URLSearchParams();
    if (req?.cursor) search.set("cursor", req.cursor);
    if (req?.limit != null) search.set("limit", String(req.limit));
    const qs = search.toString();
    const raw = await this.request<unknown>(`/transfers${qs ? `?${qs}` : ""}`, {
      method: "GET",
      auth: true,
    });
    return TransferListResponseSchema.parse(raw);
  }

  /** GET /consumers/me/sessions — the merchant Sessions the signed-in
   *  Consumer has granted. Powers Settings > Connected Merchants. */
  async listSessions(): Promise<ListSessionsResponse> {
    if (SEED_DEMO) return seedSessions();
    const raw = await this.request<unknown>("/consumers/me/sessions", {
      method: "GET",
      auth: true,
    });
    return ListSessionsResponseSchema.parse(raw);
  }

  /** DELETE /consumers/me/sessions/:id — revoke a merchant Session. The
   *  revoked Session fails validation server-side, forcing full ceremony at
   *  the next checkout. */
  async revokeSession(id: string): Promise<RevokeSessionResponse> {
    const raw = await this.request<unknown>(
      `/consumers/me/sessions/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        auth: true,
      }
    );
    return RevokeSessionResponseSchema.parse(raw);
  }
}

export const apiClient = new BackendClient();
