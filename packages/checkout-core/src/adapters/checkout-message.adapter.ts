import type { CheckoutResult } from "../types";
// Types-only imports from Phase 5's protocol package, via the zod-free
// `/types` subpath (Phase 5's recorded consumption model): erased at
// build, so checkout-core stays zero-runtime-dependency while the
// compiler catches any future envelope drift. These names are BOUND
// below (envelope cast, type/status narrowing), not decorative.
import type {
  CheckoutEnvelope,
  CheckoutStatus,
  CheckoutMessageTypeValue,
} from "@xend/checkout-protocol/types";

// SEAM owned by Phase 5 (checkout surface). RECONCILED against the
// CANONICAL envelope contract (coordinator decision, recorded in Phase 5
// and Phase 7 FINDINGS rounds 1b + 2) and typed against
// @xend/checkout-protocol/types:
//   - discriminants: xend === 'checkout' and v === 1 (unknown versions are
//     IGNORED, never errors, so future protocol bumps fail soft)
//   - type values are NAMESPACED: 'xend.checkout.result' |
//     'xend.checkout.cancel' (never bare 'result'/'cancel'); cancel
//     messages ALSO carry status 'canceled', so a status-driven parser
//     resolves them; there is NO ready message in v1 (ADR 0016)
//   - fields: reference (intent reference), nonce (must match the nonce
//     this SDK generated at open), status
//   - statuses: 'succeeded' | 'failed' | 'canceled' | 'expired'
// This file is the ONLY place that reads envelope field names; everything
// else consumes CheckoutResult.

// `satisfies` binds these literals to the protocol package's types, so a
// Phase 5 rename breaks this compile instead of silently never matching.
const RESULT_TYPES = [
  "xend.checkout.result",
  "xend.checkout.cancel",
] as const satisfies readonly CheckoutMessageTypeValue[];
const STATUSES = [
  "succeeded",
  "failed",
  "canceled",
  "expired",
] as const satisfies readonly CheckoutStatus[];

/**
 * Map an already-origin-validated message payload to a CheckoutResult, or
 * null if it is not a well-formed envelope matching the expected reference
 * AND nonce. Origin validation happens in the listener
 * (message-listener.ts); this function assumes the origin was already
 * checked by strict equality.
 */
export function parseCheckoutEnvelope(
  data: unknown,
  expected: { reference: string; nonce: string },
): CheckoutResult | null {
  if (typeof data !== "object" || data === null) return null;
  const env = data as Partial<CheckoutEnvelope> & Record<string, unknown>;
  if (env["xend"] !== "checkout") return null;
  if (env["v"] !== 1) return null; // ignore unknown protocol versions
  if (!(RESULT_TYPES as readonly string[]).includes(String(env["type"]))) {
    return null;
  }
  if (env["reference"] !== expected.reference) return null;
  if (env["nonce"] !== expected.nonce) return null;
  const status = env["status"];
  if (
    typeof status !== "string" ||
    !(STATUSES as readonly string[]).includes(status)
  ) {
    return null;
  }
  return {
    reference: expected.reference,
    status: status as CheckoutResult["status"],
  };
}
