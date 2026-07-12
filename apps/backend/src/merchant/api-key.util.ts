import { createHash, randomBytes } from 'node:crypto';

export const TEST_PREFIX = 'xnd_test_';
export const LIVE_PREFIX = 'xnd_live_';

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function generateApiKey(mode: 'test' | 'live') {
  const keyPrefix = mode === 'live' ? LIVE_PREFIX : TEST_PREFIX;
  const raw = keyPrefix + randomBytes(24).toString('base64url');
  return {
    raw,
    keyHash: hashApiKey(raw),
    keyPrefix,
    // Display-safe: prefix + last 4. Never reveals the secret.
    fingerprint: `${keyPrefix}...${raw.slice(-4)}`,
    mode,
  };
}
