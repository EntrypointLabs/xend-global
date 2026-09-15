import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { KmsClient } from './kms.client';
import { KmsRecoveryVault } from './recovery-vault.aws-kms';
import { EnvRecoveryVault } from './recovery-vault.env';
import { parseVaultKeyRing } from './recovery-vault.keys';

const KEY_A = randomBytes(32).toString('base64');
const KEY_B = randomBytes(32).toString('base64');
const SECRET = new Uint8Array(randomBytes(32));

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`missing config ${key}`);
      return value;
    },
  } as unknown as ConfigService;
}

/**
 * Stands in for KMS with a reversible transform: a data key is "wrapped" by
 * xor against a fixed pad, so decrypt is the same operation. Every call is
 * recorded so a test can assert how many round trips a seal or open costs.
 */
class FakeKms implements KmsClient {
  calls: string[] = [];
  private readonly pad = randomBytes(32);

  generateDataKey(keyId: string) {
    this.calls.push(`generateDataKey:${keyId}`);
    const plaintext = randomBytes(32);
    return Promise.resolve({
      plaintext: new Uint8Array(plaintext),
      ciphertext: new Uint8Array(this.xor(plaintext)),
    });
  }

  decrypt(ciphertext: Uint8Array) {
    this.calls.push('decrypt');
    return Promise.resolve(new Uint8Array(this.xor(Buffer.from(ciphertext))));
  }

  encrypt(keyId: string, plaintext: Uint8Array) {
    this.calls.push(`encrypt:${keyId}`);
    return Promise.resolve(new Uint8Array(this.xor(Buffer.from(plaintext))));
  }

  private xor(bytes: Buffer): Buffer {
    return Buffer.from(bytes.map((b, i) => b ^ this.pad[i % 32]));
  }
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

describe('parseVaultKeyRing', () => {
  it('reads RECOVERY_VAULT_KEY as the single env-v1 key', () => {
    const ring = parseVaultKeyRing(makeConfig({ RECOVERY_VAULT_KEY: KEY_A }));
    expect(ring?.current.id).toBe('env-v1');
    expect([...ring!.byId.keys()]).toEqual(['env-v1']);
  });

  it('reads RECOVERY_VAULT_KEYS with the current key first', () => {
    const ring = parseVaultKeyRing(
      makeConfig({
        RECOVERY_VAULT_KEYS: `env-v2:${KEY_B}, env-v1:${KEY_A}`,
        RECOVERY_VAULT_KEY: KEY_A,
      }),
    );
    expect(ring?.current.id).toBe('env-v2');
    expect([...ring!.byId.keys()]).toEqual(['env-v2', 'env-v1']);
  });

  it('returns null when no key is configured', () => {
    expect(parseVaultKeyRing(makeConfig({}))).toBeNull();
  });

  it('refuses a duplicate id, a malformed entry, and a short key', () => {
    expect(() =>
      parseVaultKeyRing(
        makeConfig({ RECOVERY_VAULT_KEYS: `a:${KEY_A},a:${KEY_B}` }),
      ),
    ).toThrow(/twice/);
    expect(() =>
      parseVaultKeyRing(makeConfig({ RECOVERY_VAULT_KEYS: KEY_A })),
    ).toThrow(/id:base64/);
    expect(() =>
      parseVaultKeyRing(makeConfig({ RECOVERY_VAULT_KEYS: 'a:c2hvcnQ=' })),
    ).toThrow(/32 bytes/);
  });
});

describe('EnvRecoveryVault', () => {
  it('seals under the current key and opens rows sealed under an older one', async () => {
    const old = new EnvRecoveryVault(makeConfig({ RECOVERY_VAULT_KEY: KEY_A }));
    const sealedUnderOld = await old.seal(SECRET);
    expect(sealedUnderOld.keyId).toBe('env-v1');

    const rotated = new EnvRecoveryVault(
      makeConfig({ RECOVERY_VAULT_KEYS: `env-v2:${KEY_B},env-v1:${KEY_A}` }),
    );
    expect(rotated.currentKeyId).toBe('env-v2');
    await expect(rotated.open(sealedUnderOld)).resolves.toEqual(SECRET);

    const sealedUnderNew = await rotated.seal(SECRET);
    expect(sealedUnderNew.keyId).toBe('env-v2');
    expect(sealedUnderNew.wrappedDataKey).toBeNull();
    await expect(rotated.open(sealedUnderNew)).resolves.toEqual(SECRET);
    await expect(old.open(sealedUnderNew)).rejects.toThrow(/unknown key/);
  });

  it('fails at the call, not at construction, when no key is configured', async () => {
    const vault = new EnvRecoveryVault(makeConfig({}));
    await expect(vault.seal(SECRET)).rejects.toThrow(/RECOVERY_VAULT_KEYS/);
  });
});

describe('KmsRecoveryVault', () => {
  const KMS_KEY = 'arn:aws:kms:eu-west-1:1:key/abc';

  function make(env: Record<string, string | undefined> = {}) {
    const config = makeConfig({ RECOVERY_VAULT_KMS_KEY_ID: KMS_KEY, ...env });
    const kms = new FakeKms();
    const fallback = new EnvRecoveryVault(config);
    return {
      vault: new KmsRecoveryVault(config, kms, fallback),
      kms,
      fallback,
    };
  }

  it('wraps a fresh data key per seal and opens with one decrypt', async () => {
    const { vault, kms } = make();
    const sealed = await vault.seal(SECRET);

    expect(sealed.keyId).toBe(`aws-kms:${KMS_KEY}`);
    expect(sealed.wrappedDataKey).toEqual(expect.any(String));
    expect(sealed.ciphertext).not.toContain(
      Buffer.from(SECRET).toString('base64'),
    );
    expect(kms.calls).toEqual([`generateDataKey:${KMS_KEY}`]);

    await expect(vault.open(sealed)).resolves.toEqual(SECRET);
    expect(kms.calls).toEqual([`generateDataKey:${KMS_KEY}`, 'decrypt']);
  });

  it('never reuses a data key across seals', async () => {
    const { vault } = make();
    const a = await vault.seal(SECRET);
    const b = await vault.seal(SECRET);
    expect(a.wrappedDataKey).not.toBe(b.wrappedDataKey);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('refuses a KMS row that lost its wrapped data key', async () => {
    const { vault } = make();
    const sealed = await vault.seal(SECRET);
    await expect(
      vault.open({ ...sealed, wrappedDataKey: null }),
    ).rejects.toThrow(/no wrapped data key/);
  });

  it('still opens env-sealed rows while the env key is configured', async () => {
    const { vault, fallback } = make({ RECOVERY_VAULT_KEY: KEY_A });
    const envSealed = await fallback.seal(SECRET);
    await expect(vault.open(envSealed)).resolves.toEqual(SECRET);
  });

  it('refuses env-sealed rows once the env key is gone', async () => {
    const { vault, fallback } = make({ RECOVERY_VAULT_KEY: KEY_A });
    const envSealed = await fallback.seal(SECRET);
    const { vault: withoutEnv } = make();
    await expect(withoutEnv.open(envSealed)).rejects.toThrow(/unknown key/);
    expect(vault).toBeDefined();
  });
});
