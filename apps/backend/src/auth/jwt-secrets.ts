import type { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface JwtKey {
  kid: string;
  secret: string;
}

export interface JwtKeyRing {
  /** Signs every new token. */
  current: JwtKey;
  byKid: Map<string, JwtKey>;
}

/**
 * JWT_SECRETS is a comma list with the signing secret first; every entry
 * verifies. JWT_SECRET alone is the single-key fallback. A key's id is
 * derived from the secret so rotation needs no second list to keep in step.
 */
export function parseJwtKeyRing(
  config: Pick<ConfigService, 'get'>,
): JwtKeyRing {
  const list = config.get<string>('JWT_SECRETS');
  const secrets = (list ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (secrets.length === 0) {
    const single = config.get<string>('JWT_SECRET');
    if (!single) {
      throw new Error('JWT_SECRETS or JWT_SECRET is required');
    }
    secrets.push(single);
  }

  const byKid = new Map<string, JwtKey>();
  for (const secret of secrets) {
    const key = { kid: keyIdFor(secret), secret };
    if (byKid.has(key.kid)) {
      throw new Error('JWT_SECRETS lists the same secret twice');
    }
    byKid.set(key.kid, key);
  }
  return { current: secrets.map((s) => byKid.get(keyIdFor(s))!)[0], byKid };
}

export function keyIdFor(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 16);
}

/** The HS families jsonwebtoken accepts for a symmetric secret. */
const HMAC_BY_ALG: Record<string, string> = {
  HS256: 'sha256',
  HS384: 'sha384',
  HS512: 'sha512',
};

/**
 * The secret a token must verify against. A `kid` resolves strictly to the key
 * it names, so a forged header cannot pick its own secret. A token with no
 * `kid` predates the ring and could have been signed by any key now in it, so
 * every key is tried and the one whose signature matches is returned; without
 * that, the first rotation would reject every session minted before it. Each
 * ring key is already a trusted signer, so this widens nothing.
 */
export function secretForToken(ring: JwtKeyRing, rawToken: string): string {
  const kid = readHeader(rawToken)?.kid ?? null;
  if (kid !== null) {
    const key = ring.byKid.get(kid);
    if (!key) {
      throw new Error('token signed under an unknown key');
    }
    return key.secret;
  }
  for (const key of ring.byKid.values()) {
    if (signatureMatches(rawToken, key.secret)) {
      return key.secret;
    }
  }
  throw new Error('token signature matches no configured key');
}

function signatureMatches(rawToken: string, secret: string): boolean {
  const parts = rawToken.split('.');
  if (parts.length !== 3) return false;
  const [header, payload, signature] = parts;
  const hash = HMAC_BY_ALG[readHeader(rawToken)?.alg ?? ''];
  if (!hash) return false;
  const expected = createHmac(hash, secret)
    .update(`${header}.${payload}`)
    .digest();
  const actual = Buffer.from(signature, 'base64url');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function readHeader(rawToken: string): { kid?: string; alg?: string } | null {
  const [header] = rawToken.split('.');
  if (!header) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(header, 'base64url').toString('utf-8'),
    ) as { kid?: unknown; alg?: unknown };
    return {
      kid: typeof parsed?.kid === 'string' ? parsed.kid : undefined,
      alg: typeof parsed?.alg === 'string' ? parsed.alg : undefined,
    };
  } catch {
    return null;
  }
}
