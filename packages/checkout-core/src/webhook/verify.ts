import { createHmac, timingSafeEqual } from "node:crypto";
import { WEBHOOK } from "./webhook-contract";

export interface WebhookHeaders {
  [key: string]: string | string[] | undefined;
}

export type WebhookVerificationCode =
  | "MISSING_HEADERS"
  | "MALFORMED_HEADER"
  | "TIMESTAMP_OUT_OF_TOLERANCE"
  | "INVALID_SIGNATURE";

export class WebhookVerificationError extends Error {
  constructor(
    readonly code: WebhookVerificationCode,
    message: string,
  ) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

const HEX = /^[0-9a-fA-F]+$/;

function readHeader(headers: WebhookHeaders, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const value = headers[key];
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

/**
 * Verify a Pay with Xend webhook (Stripe-style t/v1 scheme, ADR 0017).
 * Returns the parsed JSON payload on success; throws
 * WebhookVerificationError otherwise. `rawBody` MUST be the exact received
 * bytes (string or Buffer): verifying over re-serialized JSON breaks the
 * signature.
 *
 * The `Xend-Event-Id` header is UNSIGNED and for convenience only. Dedup
 * on the event id inside the verified payload, never on that header.
 */
export function verifyWebhook(
  rawBody: string | Buffer,
  headers: WebhookHeaders,
  secret: string,
): unknown {
  const signature = readHeader(headers, WEBHOOK.signatureHeader);
  if (!signature) {
    throw new WebhookVerificationError(
      "MISSING_HEADERS",
      `Missing ${WEBHOOK.signatureHeader} header`,
    );
  }

  let timestamp: string | undefined;
  const candidates: string[] = [];
  for (const part of signature.split(",")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (key === "t") timestamp = value;
    else if (key === "v1") candidates.push(value);
  }

  if (
    timestamp === undefined ||
    !/^\d+$/.test(timestamp) ||
    candidates.length === 0
  ) {
    throw new WebhookVerificationError(
      "MALFORMED_HEADER",
      "Signature header must carry one t= and at least one v1= element",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > WEBHOOK.toleranceSeconds) {
    throw new WebhookVerificationError(
      "TIMESTAMP_OUT_OF_TOLERANCE",
      "Timestamp outside the replay tolerance window",
    );
  }

  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  // Key is the FULL secret string INCLUDING the whsec_ prefix, raw UTF-8.
  // No prefix strip, no base64 decode (ADR 0017).
  const expected = createHmac("sha256", secret)
    .update(WEBHOOK.signedContent(timestamp, body))
    .digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");

  const matched = candidates.some((candidate) => {
    if (
      candidate.length === 0 ||
      candidate.length % 2 !== 0 ||
      !HEX.test(candidate)
    ) {
      return false; // odd-length or non-hex candidate is a non-match, never an error
    }
    const candidateBytes = Buffer.from(candidate, "hex");
    if (candidateBytes.length !== expectedBytes.length) return false;
    return timingSafeEqual(candidateBytes, expectedBytes);
  });

  if (!matched) {
    throw new WebhookVerificationError(
      "INVALID_SIGNATURE",
      "No v1 signature matched",
    );
  }

  return JSON.parse(body);
}
