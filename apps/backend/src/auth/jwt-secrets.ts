import type { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

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

/**
 * The secret a token must verify against, by the `kid` in its header. A token
 * with no `kid` predates key ids and verifies against the current key, which
 * is the only one that could have signed it before rotation existed.
 */
export function secretForToken(ring: JwtKeyRing, rawToken: string): string {
  const kid = readKid(rawToken);
  if (kid === null) return ring.current.secret;
  const key = ring.byKid.get(kid);
  if (!key) {
    throw new Error('token signed under an unknown key');
  }
  return key.secret;
}

function readKid(rawToken: string): string | null {
  const [header] = rawToken.split('.');
  if (!header) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(header, 'base64url').toString('utf-8'),
    );
    const kid = (parsed as { kid?: unknown })?.kid;
    return typeof kid === 'string' ? kid : null;
  } catch {
    return null;
  }
}
