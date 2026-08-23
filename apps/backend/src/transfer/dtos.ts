import { z } from 'zod';

// DTOs for the /transfers/prepare, /transfers/submit, and
// GET /transfers endpoints.

// ── POST /transfers/prepare ─────────────────────────────────────────

export const PrepareRequestSchema = z.object({
  toAddress: z.string(),
  mint: z.string(),
  // Integer string at the mint's native decimals. The mobile UI shows
  // a decimal-formatted amount; the wire form is always the raw u64
  // because JS Number cannot represent the upper range of SPL amounts.
  amountRaw: z.string().regex(/^\d+$/),
  memo: z.string().max(120).optional(),
});
export type PrepareRequest = z.infer<typeof PrepareRequestSchema>;

export const PrepareResponseSchema = z.object({
  intentId: z.string(),
  // Base64 of the serialized v0 transaction message ready for signing.
  // Mobile signs via Privy and submits back via /transfers/submit.
  unsignedTxBase64: z.string(),
  feeLamports: z.number().int().nonnegative(),
  // ISO-8601 UTC. The blockhash's lastValidBlockHeight + ~400ms/slot
  // upper bound. Mobile shows "Try again" on INTENT_EXPIRED.
  expiresAt: z.string().datetime(),
  /**
   * True when the transaction still needs the approval signer (S2) before it
   * can land. Absent on the pre-multisig path, where Privy alone is enough.
   *
   * Submitting a two-signature transaction with one signature does not fail
   * politely: it is rejected on chain after the Consumer has already confirmed.
   */
  needsApprovalSignature: z.boolean().optional(),
});
export type PrepareResponse = z.infer<typeof PrepareResponseSchema>;

// ── POST /transfers/submit ──────────────────────────────────────────

export const SubmitRequestSchema = z.object({
  intentId: z.string(),
  signedTxBase64: z.string(),
});
export type SubmitRequest = z.infer<typeof SubmitRequestSchema>;

export const SubmitResponseSchema = z.object({
  transferId: z.string(),
  signature: z.string(),
  // Always PENDING here. The RPC tailer transitions to CONFIRMED or
  // FAILED asynchronously; that is reflected in subsequent GET
  // /transfers reads, never in the submit response.
  status: z.literal('PENDING'),
});
export type SubmitResponse = z.infer<typeof SubmitResponseSchema>;

// ── GET /transfers ──────────────────────────────────────────────────

export const TransferRowSchema = z.object({
  id: z.string(),
  direction: z.enum(['SEND', 'RECEIVE']),
  mint: z.string(),
  amountRaw: z.string(),
  fromAddress: z.string(),
  toAddress: z.string(),
  status: z.enum(['PENDING', 'CONFIRMED', 'FAILED']),
  signature: z.string().nullable(),
  memo: z.string().nullable(),
  // Activity discriminant: a plain send/receive vs a settled Payment. Literals
  // bind to Phase 4's transfer_kind pgEnum, which is LOWERCASE; do not uppercase
  // to match the SEND/RECEIVE direction enum or Zod rejects every real row.
  kind: z.enum(['transfer', 'payment']),
  merchantName: z.string().nullable(),
  /**
   * What the transfer was worth in USD when it happened, as a decimal string.
   *
   * Frozen at index time rather than priced on read: five SOL received while
   * SOL was $100 stays $500 however SOL moves afterwards, because $500 is what
   * changed hands. Null when nothing could price the mint.
   */
  usdValue: z.string().nullable(),
  /**
   * The mint's decimals, as the chain reported them. Null on rows indexed
   * before it was recorded, where the client falls back to what it can infer.
   */
  decimals: z.number().int().nullable(),
  /**
   * The token's identity, resolved per row rather than from what the Consumer
   * currently holds.
   *
   * A holdings-derived lookup loses the token the moment it is sold: convert
   * every SOL to USDC and the SOL history would forget its own name and logo.
   * History has to keep describing itself after the balance is gone.
   *
   * Null when nothing can name the mint.
   */
  tokenName: z.string().nullable(),
  tokenSymbol: z.string().nullable(),
  tokenIconUrl: z.string().nullable(),
  createdAt: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable(),
});
export type TransferRow = z.infer<typeof TransferRowSchema>;

export const ListTransfersQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type ListTransfersQuery = z.infer<typeof ListTransfersQuerySchema>;

/**
 * Something that happened to the Account that was not a movement of money.
 *
 * Carried alongside the transfers rather than mixed into them. The balance
 * chart walks `transfers` directly, so an entry with no amount in that array
 * would corrupt it; the client merges the two for display only.
 */
export const AccountEventRowSchema = z.object({
  id: z.string(),
  kind: z.enum([
    'recovery_key_added',
    'recovery_key_removed',
    'wallet_renamed',
  ]),
  subject: z.string().nullable(),
  previousSubject: z.string().nullable(),
  signature: z.string().nullable(),
  occurredAt: z.string(),
});
export type AccountEventRow = z.infer<typeof AccountEventRowSchema>;

export const ListTransfersResponseSchema = z.object({
  transfers: z.array(TransferRowSchema),
  /**
   * The events that fall inside the span this page of transfers covers, so the
   * merged list stays in order across pages.
   */
  events: z.array(AccountEventRowSchema),
  nextCursor: z.string().nullable(),
});
export type ListTransfersResponse = z.infer<typeof ListTransfersResponseSchema>;
