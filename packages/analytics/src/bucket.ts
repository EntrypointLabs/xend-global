export type AmountBucket = string;

const USD_EDGES = [1, 10, 50, 100, 500, 1_000, 5_000, 10_000];
const NGN_EDGES = [
  1_000, 10_000, 50_000, 100_000, 500_000, 1_000_000, 5_000_000,
];

function label(n: number): string {
  if (n >= 1_000_000) return `${n / 1_000_000}m`;
  if (n >= 1_000) return `${n / 1_000}k`;
  return String(n);
}

/**
 * Amounts never leave the device exactly: they are reported as a range such
 * as `10-50`. Naira uses its own ladder so a ₦20,000 send does not land in the
 * top USD bucket.
 */
export function bucketAmount(
  value: number | string | null | undefined,
  currency: "USD" | "NGN" = "USD",
): AmountBucket | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  if (n == null || !Number.isFinite(n) || n < 0) return undefined;
  if (n === 0) return "0";
  const edges = currency === "NGN" ? NGN_EDGES : USD_EDGES;
  let lower: number | null = null;
  for (const edge of edges) {
    if (n < edge) {
      return lower === null
        ? `<${label(edge)}`
        : `${label(lower)}-${label(edge)}`;
    }
    lower = edge;
  }
  return `${label(lower ?? 0)}+`;
}
