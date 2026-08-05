// SEAM owned by Phase 6 (merchant API + webhooks). Phase 6 FROZE the
// outbound signing scheme in ADR 0017 (Stripe-style t/v1); its
// webhook-signer.ts is the byte-level oracle. This file is the ONLY
// place that encodes it:
//   - single header `Xend-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>]`
//     (multiple v1 entries appear during dual-secret rotation)
//   - signed content = `${timestamp}.${rawBody}` (NO event id signed)
//   - digests are hex
//   - the HMAC-SHA256 key is the FULL secret string INCLUDING the
//     whsec_ prefix, as raw UTF-8 (no prefix strip, no base64 decode)
//   - the 300s replay tolerance is evaluated against the t= value
//     parsed from the header
//   - `Xend-Event-Id` is an UNSIGNED convenience header; merchants dedup
//     on the event id inside the SIGNED body, never on the header
// RECONCILE: verified against ADR 0017 + Phase 6's webhook-signer.ts
// (FINDINGS round 1b/2); any future change lands here and nowhere else.
export const WEBHOOK = {
  signatureHeader: "xend-signature",
  eventIdHeader: "xend-event-id",
  secretPrefix: "whsec_",
  toleranceSeconds: 300,
  signedContent: (timestamp: string, body: string) => `${timestamp}.${body}`,
} as const;
