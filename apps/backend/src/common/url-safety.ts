import { promises as dns } from 'node:dns';

/**
 * The shared SSRF guard. Merchant return/cancel URLs and merchant webhook
 * endpoint URLs both flow through it: an outbound HTTP target that is not
 * HTTPS, or whose hostname resolves to a private, loopback, link-local,
 * unique-local, or unspecified address, is refused. Callers validate at
 * registration/creation time AND re-run it at delivery time as the
 * DNS-rebinding defense.
 */
export class UnsafeUrlError extends Error {
  readonly code = 'UNSAFE_URL';
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export interface UrlSafetyOptions {
  /**
   * When true, skip the resolved-IP private-range check. TEST ONLY, wired
   * from WEBHOOK_ALLOW_PRIVATE_URLS, so the E2E suite can deliver to
   * 127.0.0.1. Never true in a real environment.
   */
  allowPrivate?: boolean;
}

/** Parse an IPv4 dotted-quad into its four octets, or null if malformed. */
function parseIpv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => Number(p));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
  return octets as [number, number, number, number];
}

function isPrivateIpv4(ip: string): boolean {
  const octets = parseIpv4(ip);
  if (!octets) return false;
  const [a, b] = octets;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 0) return true; // 0.0.0.0/8 unspecified
  return false;
}

/**
 * Classify a resolved address as private/loopback/link-local/unique-local/
 * unspecified. IPv4 ranges: 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16,
 * 0.0.0.0. IPv6: ::1, fc00::/7, fe80::/10, :: (and IPv4-mapped forms).
 * Exported for unit testing.
 */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip.trim().toLowerCase();
  if (addr.length === 0) return true;

  // IPv4-mapped / IPv4-compatible IPv6 in dotted form (e.g. ::ffff:127.0.0.1):
  // classify by the embedded IPv4.
  const mappedDotted = addr.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return isPrivateIpv4(mappedDotted[1]);

  // IPv4-mapped IPv6 in hex form. Node normalizes literals like
  // [::ffff:127.0.0.1] to ::ffff:7f00:1, which would otherwise slip past the
  // IPv6 checks below (empty first hextet) and evade the private-range guard.
  const mappedHex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    const embedded = `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
    return isPrivateIpv4(embedded);
  }

  if (addr.includes('.') && !addr.includes(':')) return isPrivateIpv4(addr);

  // IPv6.
  if (addr === '::1') return true; // loopback
  if (addr === '::') return true; // unspecified
  const firstHextet = addr.split(':')[0];
  if (firstHextet.length > 0) {
    const value = parseInt(firstHextet, 16);
    if (!Number.isNaN(value)) {
      if ((value & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
      if ((value & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    }
  }
  return false;
}

/**
 * Reject the URL unless it is HTTPS and every resolved address is public.
 * Throws UnsafeUrlError with a self-contained reason on any failure.
 */
export async function assertPublicHttpsUrl(
  url: string,
  options: UrlSafetyOptions = {},
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeUrlError(`invalid url: ${url}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new UnsafeUrlError(`url must be https: ${url}`);
  }

  if (options.allowPrivate) return;

  const host = parsed.hostname.replace(/^\[|\]$/g, '');

  let resolved: { address: string }[];
  try {
    resolved = await dns.lookup(host, { all: true });
  } catch {
    throw new UnsafeUrlError(`could not resolve host: ${host}`);
  }

  if (resolved.length === 0) {
    throw new UnsafeUrlError(`host did not resolve: ${host}`);
  }

  for (const { address } of resolved) {
    if (isPrivateAddress(address)) {
      throw new UnsafeUrlError(
        `url resolves to a non-public address (${address}): ${url}`,
      );
    }
  }
}
