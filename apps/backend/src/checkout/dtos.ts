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
  /**
   * What the Merchant priced in and the figure to show, in that currency's
   * minor unit. Never a settlement amount and never a rate: a Consumer sees
   * the price they were quoted, and the FX behind a converted one stays off
   * this unauthenticated endpoint.
   */
  displayCurrency: z.string(),
  displayAmountMinor: z.string(),
  merchantOrigin: z.string().nullable(),
  sessionRecognized: z.boolean(),
  expiresAt: z.string(),
  livemode: z.boolean(),
  cancelUrl: z.string().optional(),
});
export type IntentSummary = z.infer<typeof IntentSummarySchema>;

/**
 * POST /checkout/settle body: the Spend the Consumer signed at the popup.
 *
 * Access control is the pinned message rather than a credential. The bytes have
 * to equal what authorize built and recorded, and they have to carry the
 * Consumer's own signature or the Account will not part with the money, so
 * neither the reference nor a stolen cookie is enough on its own. Deliberately
 * not gated on the Session cookie: a first Payment does not need one today, and
 * requiring it here would break Checkout inside the in-app browsers that drop
 * cookies, which is a large share of the launch market.
 */
export const SettleBodySchema = z.object({
  reference: z.string().min(1),
  signedTxBase64: z.string().min(1),
});
export type SettleBody = z.infer<typeof SettleBodySchema>;

/**
 * The authorize response.
 *
 * 'needs_signature' carries the Spend for the Consumer to sign at the popup and
 * hand back to /checkout/settle. The passkey ceremony proves who they are; the
 * Account's own signer is what moves the money, and those are two different
 * things. The terminal outcomes are unchanged; 'authorized' is an internal
 * attempt state and never appears on this wire.
 */
export const AuthorizeResponseSchema = z.union([
  z.object({
    status: z.literal('needs_signature'),
    unsignedTxBase64: z.string(),
    /** Which of the Consumer's keys the popup must sign with. */
    signerAddress: z.string(),
  }),
  z.object({
    status: z.enum(['succeeded', 'failed']),
    redirectUrl: z.string().optional(),
    cancelUrl: z.string().optional(),
  }),
]);
export type AuthorizeResponse = z.infer<typeof AuthorizeResponseSchema>;

/** The terminal half of {@link AuthorizeResponseSchema}, which settle returns. */
export type SettleResponse = Extract<
  AuthorizeResponse,
  { status: 'succeeded' | 'failed' }
>;
