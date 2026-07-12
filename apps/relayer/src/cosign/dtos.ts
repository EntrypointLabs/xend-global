import { z } from "zod";

/**
 * Frozen /internal/cosign request contract (owner: Phase 3). The trusted
 * caller supplies expectedSettlementAccount per request; in Phase 4 it is
 * the seed/child settlement account and the caller also supplies
 * expectedMessageBase64 (the pinned compiled message), which this phase
 * already honors when present.
 */
export const CosignRequestSchema = z.object({
  intentId: z.string().min(1),
  consumerId: z.string().min(1),
  merchantId: z.string().min(1),
  transactionBase64: z.string().min(1),
  expectedSettlementAccount: z.string().min(32),
  expectedMessageBase64: z.string().optional(),
});

export type CosignRequest = z.infer<typeof CosignRequestSchema>;

export interface CosignResponse {
  signature: string;
  status: "BROADCAST";
  correlationId: string;
}
