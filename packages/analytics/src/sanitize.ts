export type Primitive = string | number | boolean | null;
export type Props = Record<string, Primitive>;

const BLOCKED_KEY =
  /(^|_)(email|e_mail|phone|name|first_name|last_name|address|wallet|pubkey|public_key|signature|tx|txid|tx_hash|hash|memo|note|bvn|nin|account_number|iban|routing|token_value|password|secret|otp|code_value|amount|balance|ip)($|_)/i;

const ALLOWED_KEY = new Set([
  "amount_bucket",
  "has_text",
  "is_new",
  "is_new_user",
  "merchant_id",
]);

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const BASE58_RUN = /[1-9A-HJ-NP-Za-km-z]{32,}/;
const LONG_DIGITS = /\d{8,}/;
const HEX_RUN = /(0x)?[0-9a-fA-F]{32,}/;

const MAX_STRING = 80;

function looksSensitive(value: string): boolean {
  return (
    EMAIL.test(value) ||
    BASE58_RUN.test(value) ||
    LONG_DIGITS.test(value) ||
    HEX_RUN.test(value)
  );
}

/**
 * The last guard before anything leaves a device or browser. Event types
 * already keep identity and money out, but a careless `reason` or a widened
 * prop would otherwise ship an email or wallet address verbatim, so this drops
 * any key named like personal or money data and any value shaped like one.
 */
export function sanitize(props: Record<string, unknown> | undefined): Props {
  const out: Props = {};
  if (!props) return out;
  for (const [key, raw] of Object.entries(props)) {
    if (raw === undefined) continue;
    if (!ALLOWED_KEY.has(key) && BLOCKED_KEY.test(key)) continue;
    if (raw === null || typeof raw === "boolean") {
      out[key] = raw;
    } else if (typeof raw === "number") {
      if (Number.isFinite(raw)) out[key] = raw;
    } else if (typeof raw === "string") {
      if (looksSensitive(raw)) continue;
      out[key] = raw.length > MAX_STRING ? raw.slice(0, MAX_STRING) : raw;
    }
  }
  return out;
}

/**
 * Turns any thrown value into a short code fit for a `reason` prop. Error
 * messages are not sent because they routinely carry addresses, amounts and
 * upstream response bodies.
 */
export function errorReason(error: unknown): string {
  if (error == null) return "unknown";
  if (typeof error === "string") return toCode(error);
  if (typeof error === "object") {
    const e = error as { code?: unknown; name?: unknown; status?: unknown };
    if (typeof e.code === "string" && e.code) return toCode(e.code);
    if (typeof e.code === "number") return `code_${e.code}`;
    if (typeof e.status === "number") return `http_${e.status}`;
    if (typeof e.name === "string" && e.name && e.name !== "Error") {
      return toCode(e.name);
    }
  }
  return "error";
}

function toCode(s: string): string {
  const code = s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  if (!code || looksSensitive(code)) return "error";
  return code;
}
