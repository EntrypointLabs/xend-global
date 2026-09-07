import type { ConfigService } from '@nestjs/config';
import { JwtSecretRequestType, JwtService } from '@nestjs/jwt';
import * as jwt from 'jsonwebtoken';
import { keyIdFor, parseJwtKeyRing, secretForToken } from './jwt-secrets';

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/** The same options AuthModule builds, so the spec exercises the real wiring. */
function makeJwtService(config: ConfigService): JwtService {
  const ring = parseJwtKeyRing(config);
  return new JwtService({
    secretOrKeyProvider: (requestType, tokenOrPayload) =>
      requestType === JwtSecretRequestType.VERIFY &&
      typeof tokenOrPayload === 'string'
        ? secretForToken(ring, tokenOrPayload)
        : ring.current.secret,
    signOptions: { expiresIn: '1h', keyid: ring.current.kid },
  });
}

describe('parseJwtKeyRing', () => {
  it('falls back to JWT_SECRET as the single key', () => {
    const ring = parseJwtKeyRing(makeConfig({ JWT_SECRET: 'only' }));
    expect(ring.current).toEqual({ kid: keyIdFor('only'), secret: 'only' });
    expect(ring.byKid.size).toBe(1);
  });

  it('takes the first JWT_SECRETS entry as the signer and keeps the rest for verify', () => {
    const ring = parseJwtKeyRing(
      makeConfig({ JWT_SECRETS: 'new, old', JWT_SECRET: 'ignored' }),
    );
    expect(ring.current.secret).toBe('new');
    expect([...ring.byKid.values()].map((k) => k.secret)).toEqual([
      'new',
      'old',
    ]);
  });

  it('refuses an empty configuration and a repeated secret', () => {
    expect(() => parseJwtKeyRing(makeConfig({}))).toThrow(/JWT_SECRETS/);
    expect(() =>
      parseJwtKeyRing(makeConfig({ JWT_SECRETS: 'same,same' })),
    ).toThrow(/twice/);
  });
});

describe('JWT key rotation', () => {
  const before = makeJwtService(makeConfig({ JWT_SECRET: 'old' }));
  const after = makeJwtService(makeConfig({ JWT_SECRETS: 'new,old' }));
  const retired = makeJwtService(makeConfig({ JWT_SECRETS: 'new' }));

  it('signs with the current key and names it in the header', () => {
    const token = after.sign({ sub: 'u_1' });
    const header = jwt.decode(token, { complete: true })?.header;
    expect(header?.kid).toBe(keyIdFor('new'));
    expect(after.verify(token)).toMatchObject({ sub: 'u_1' });
  });

  it('still verifies a token the previous key signed', () => {
    const token = before.sign({ sub: 'u_1' });
    expect(jwt.decode(token, { complete: true })?.header.kid).toBe(
      keyIdFor('old'),
    );
    expect(after.verify(token)).toMatchObject({ sub: 'u_1' });
  });

  it('rejects that token once the old key is dropped', () => {
    const token = before.sign({ sub: 'u_1' });
    expect(() => void retired.verify(token)).toThrow(/unknown key/);
  });

  it('verifies a token minted before key ids existed against the current key', () => {
    const legacy = jwt.sign({ sub: 'u_1' }, 'new', { expiresIn: '1h' });
    expect(jwt.decode(legacy, { complete: true })?.header.kid).toBeUndefined();
    expect(after.verify(legacy)).toMatchObject({ sub: 'u_1' });
  });

  it('does not let a forged kid pick a secret it names itself', () => {
    const forged = jwt.sign({ sub: 'u_1' }, 'attacker', {
      expiresIn: '1h',
      keyid: keyIdFor('attacker'),
    });
    expect(() => void after.verify(forged)).toThrow(/unknown key/);
  });
});
