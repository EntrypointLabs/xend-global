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
 * Same ladders as `bucketAmount` in packages/analytics, so a server bucket
 * and an app bucket for the same payment read the same. The backend cannot
 * load that package (it ships TypeScript source), hence the copy; both specs
 * assert the same cut points.
 */
export function bucketAmount(
  value: number | null | undefined,
  currency: 'USD' | 'NGN' = 'USD',
): string | undefined {
  if (value == null || !Number.isFinite(value) || value < 0) return undefined;
  if (value === 0) return '0';
  const edges = currency === 'NGN' ? NGN_EDGES : USD_EDGES;
  let lower: number | null = null;
  for (const edge of edges) {
    if (value < edge) {
      return lower === null
        ? `<${label(edge)}`
        : `${label(lower)}-${label(edge)}`;
    }
    lower = edge;
  }
  return `${label(lower ?? 0)}+`;
}

/** USDC base units (6 decimals) as a USD range. */
export function bucketUsdcRaw(
  raw: string | bigint | number | null | undefined,
): string | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? bucketAmount(n / 1_000_000, 'USD') : undefined;
}

/** Naira kobo as an NGN range. */
export function bucketNgnMinor(
  minor: string | bigint | number | null | undefined,
): string | undefined {
  if (minor == null || minor === '') return undefined;
  const n = Number(minor);
  return Number.isFinite(n) ? bucketAmount(n / 100, 'NGN') : undefined;
}

const EMAIL = /[^\s@"'<>]+@[^\s@"'<>]+\.[A-Za-z]{2,}/g;
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const BEARER = /(bearer\s+)[\w.~+/=-]+/gi;
const LONG_DIGITS = /\b\d{10,}\b/g;
const SECRET_KV =
  /\b(token|secret|password|api[_-]?key|otp|code|bvn|nin|account_number)=([^\s&]+)/gi;

/**
 * Log lines leave for a third party, so the identifiers that would make one a
 * personal record are masked: emails, bearer tokens and JWTs, `key=value`
 * secrets, and digit runs long enough to be a BVN, NIN, phone or bank
 * account number. Wallet addresses and signatures stay, because they are
 * public on chain and debugging a transfer needs them.
 */
export function redactLogLine(line: string): string {
  return line
    .replace(JWT, '[jwt]')
    .replace(BEARER, '$1[redacted]')
    .replace(SECRET_KV, '$1=[redacted]')
    .replace(EMAIL, '[email]')
    .replace(LONG_DIGITS, '[digits]');
}

/** A short machine code for a `reason` prop, never free text. */
export function reasonCode(reason: unknown): string {
  if (reason == null) return 'unknown';
  let raw: string;
  if (typeof reason === 'string') raw = reason;
  else if (typeof reason === 'object') {
    const e = reason as { code?: unknown; name?: unknown; status?: unknown };
    if (typeof e.code === 'string' && e.code) raw = e.code;
    else if (typeof e.status === 'number') return `http_${e.status}`;
    else if (typeof e.name === 'string' && e.name !== 'Error') raw = e.name;
    else return 'error';
  } else return 'error';
  const code = raw
    .trim()
    .split(/[\s:]/)[0]
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .slice(0, 48);
  if (!code || code.length >= 32 || /\d{6,}/.test(code)) return 'error';
  return code;
}
