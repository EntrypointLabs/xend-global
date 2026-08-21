import { Keypair, PublicKey } from '@solana/web3.js';

import { AddRecoveryWalletSchema } from './dtos';

describe('AddRecoveryWalletSchema', () => {
  it('accepts a real wallet address', () => {
    const address = Keypair.generate().publicKey.toBase58();

    expect(AddRecoveryWalletSchema.safeParse({ address }).success).toBe(true);
  });

  it('refuses an address that cannot sign', () => {
    // A program-derived address: 32 valid bytes, parses as a PublicKey, and
    // has no private key behind it. Accepted as a recovery key it would look
    // completely normal until the day somebody needed it.
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('recovery')],
      new PublicKey('SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG'),
    );

    expect(PublicKey.isOnCurve(pda.toBytes())).toBe(false);
    expect(
      AddRecoveryWalletSchema.safeParse({ address: pda.toBase58() }).success,
    ).toBe(false);
  });

  it('refuses base58 that is not a public key at all', () => {
    // Right alphabet, wrong length. A regex over the base58 alphabet lets this
    // through, which is why the check decodes instead of matching.
    for (const address of ['abc', '1'.repeat(64), '']) {
      expect(AddRecoveryWalletSchema.safeParse({ address }).success).toBe(
        false,
      );
    }
  });

  it('refuses characters outside base58', () => {
    const address = `0OIl${Keypair.generate().publicKey.toBase58().slice(4)}`;

    expect(AddRecoveryWalletSchema.safeParse({ address }).success).toBe(false);
  });
});
