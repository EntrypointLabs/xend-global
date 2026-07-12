import { z } from 'zod';

/**
 * POST /checkout/authorize body. camelCase per Phase 5's api.ts vocabulary.
 * `reference` is the intent handle; `providerToken` is the provider-neutral
 * credential name (never a provider-branded field).
 */
export const AuthorizeBodySchema = z.object({
  reference: z.string().min(1),
  providerToken: z.string().min(1).optional(),
});
export type AuthorizeBody = z.infer<typeof AuthorizeBodySchema>;

/**
 * The public-safe intent summary for the checkout popup. EXACTLY these fields.
 * merchantDisplayName comes from the merchant record (never per-intent params);
 * merchantOrigin is the popup's postMessage targetOrigin from
 * merchants.allowed_origins; sessionRecognized is a non-destructive cookie
 * check. cancelUrl is the optional signed redirect-mode cancel target (a
 * Consumer can cancel BEFORE any authorize call, so it rides on the summary).
 * There is deliberately no settlement amount and no FX field here: exposing
 * them on an unauthenticated endpoint would leak the pinned rate.
 */
export const IntentSummarySchema = z.object({
  reference: z.string(),
  status: z.string(),
  merchantDisplayName: z.string(),
  ngnDisplayMinor: z.string().nullable(),
  merchantOrigin: z.string().nullable(),
  sessionRecognized: z.boolean(),
  expiresAt: z.string(),
  livemode: z.boolean(),
  cancelUrl: z.string().optional(),
});
export type IntentSummary = z.infer<typeof IntentSummarySchema>;

/**
 * The blocking authorize response: terminal outcomes only. 'authorized' is an
 * internal attempt state and never appears on this wire.
 */
export const AuthorizeResponseSchema = z.object({
  status: z.enum(['succeeded', 'failed']),
  redirectUrl: z.string().optional(),
  cancelUrl: z.string().optional(),
});
export type AuthorizeResponse = z.infer<typeof AuthorizeResponseSchema>;
