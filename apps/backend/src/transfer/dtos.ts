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
  createdAt: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable(),
});
export type TransferRow = z.infer<typeof TransferRowSchema>;

export const ListTransfersQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type ListTransfersQuery = z.infer<typeof ListTransfersQuerySchema>;

export const ListTransfersResponseSchema = z.object({
  transfers: z.array(TransferRowSchema),
  nextCursor: z.string().nullable(),
});
export type ListTransfersResponse = z.infer<typeof ListTransfersResponseSchema>;
