import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Keypair } from '@solana/web3.js';
import { getBase58Decoder } from '@solana/kit';
import type { KmsClient } from '../recovery/kms.client';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import { SettlementAuthorityEnvSigner } from './settlement-authority.env-signer';
import { SettlementAuthorityKmsSigner } from './settlement-authority.kms-signer';
import { selectSettlementAuthoritySigner } from './settlement-authority.module';

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

/** Reverses a fixed xor pad, so "decrypt" is the inverse of the fixture's "encrypt". */
class FakeKms implements KmsClient {
  decrypted: Uint8Array[] = [];
  constructor(private readonly pad: Buffer) {}

  generateDataKey(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }

  encrypt(_keyId: string, plaintext: Uint8Array) {
    return Promise.resolve(this.xor(plaintext));
  }

  decrypt(ciphertext: Uint8Array) {
    this.decrypted.push(ciphertext);
    return Promise.resolve(this.xor(ciphertext));
  }

  private xor(bytes: Uint8Array): Uint8Array {
    return new Uint8Array(
      Buffer.from(bytes).map((b, i) => b ^ this.pad[i % this.pad.length]),
    );
  }
}

const solana = { sendRawTransaction: jest.fn() } as unknown as SolanaRpc;

describe('SettlementAuthorityKmsSigner', () => {
  const keypair = Keypair.generate();
  const secretBase58 = getBase58Decoder().decode(keypair.secretKey);
  const kms = new FakeKms(Buffer.from('a-fixed-pad-for-tests'));
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });
  afterEach(() => logSpy.mockRestore());

  it('decrypts the ciphertext once at boot and derives the authority address', async () => {
    const ciphertext = Buffer.from(
      await kms.encrypt('key', Buffer.from(secretBase58, 'utf-8')),
    ).toString('base64');
    const signer = new SettlementAuthorityKmsSigner(
      makeConfig({ SETTLEMENT_AUTHORITY_SECRET_KEY_CIPHERTEXT: ciphertext }),
      solana,
      kms,
    );
    await signer.onModuleInit();

    expect(signer.address).toBe(keypair.publicKey.toBase58());
    expect(kms.decrypted).toHaveLength(1);
    const logged = (logSpy.mock.calls as unknown[][])
      .map((c) => String(c[0]))
      .join('\n');
    expect(logged).toContain('provider=aws-kms');
    expect(logged).not.toContain(secretBase58);
    expect(logged).not.toContain(ciphertext);
  });

  it('fails at boot when the ciphertext is missing', async () => {
    const signer = new SettlementAuthorityKmsSigner(
      makeConfig({}),
      solana,
      kms,
    );
    await expect(signer.onModuleInit()).rejects.toThrow(
      /SETTLEMENT_AUTHORITY_SECRET_KEY_CIPHERTEXT/,
    );
  });
});

describe('selectSettlementAuthoritySigner', () => {
  it('defaults to the env signer', () => {
    const signer = selectSettlementAuthoritySigner(
      makeConfig({}),
      solana,
      new FakeKms(Buffer.from('x')),
    );
    expect(signer).toBeInstanceOf(SettlementAuthorityEnvSigner);
  });

  it('selects the KMS signer on aws-kms and refuses anything else', () => {
    expect(
      selectSettlementAuthoritySigner(
        makeConfig({ SETTLEMENT_AUTHORITY_PROVIDER: 'aws-kms' }),
        solana,
        new FakeKms(Buffer.from('x')),
      ),
    ).toBeInstanceOf(SettlementAuthorityKmsSigner);
    expect(() =>
      selectSettlementAuthoritySigner(
        makeConfig({ SETTLEMENT_AUTHORITY_PROVIDER: 'vault' }),
        solana,
        new FakeKms(Buffer.from('x')),
      ),
    ).toThrow(/unknown SETTLEMENT_AUTHORITY_PROVIDER/);
  });
});
