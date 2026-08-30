import { createHash, generateKeyPairSync, KeyObject, sign } from 'node:crypto';
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

import {
  PRESENCE_DOMAIN,
  presenceDigest,
  verifyPresenceProof,
} from './presence-proof';

/**
 * A stand-in for the Secure Enclave: the same curve, the same compressed
 * public key, and signatures over a digest the caller supplies rather than
 * over data it hashes itself.
 */
function deviceKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x!, 'base64url');
  const y = Buffer.from(jwk.y!, 'base64url');
  const compressed = Buffer.concat([
    Buffer.from([(y[y.length - 1] & 1) === 0 ? 0x02 : 0x03]),
    x,
  ]);

  return {
    hardwarePublicKey: compressed.toString('hex'),
    signDigest: (digest: Buffer) => signWith(privateKey, digest),
    signMessage: (messageBase64: string) =>
      signWith(
        privateKey,
        presenceDigest(Buffer.from(messageBase64, 'base64')),
      ),
  };
}

function signWith(privateKey: KeyObject, digest: Buffer): string {
  return sign(null, digest, privateKey).toString('hex');
}

const MESSAGE = Buffer.from('a compiled transaction message').toString(
  'base64',
);

describe('presenceDigest', () => {
  it('binds the domain, so a signature cannot be carried between uses', () => {
    const message = Buffer.from('payload');
    const undomained = createHash('sha256').update(message).digest();

    expect(presenceDigest(message).equals(undomained)).toBe(false);
    expect(presenceDigest(message)).toEqual(
      createHash('sha256')
        .update(Buffer.from(PRESENCE_DOMAIN, 'utf8'))
        .update(message)
        .digest(),
    );
  });

  it('changes with the message, so one proof cannot cover another send', () => {
    expect(presenceDigest(Buffer.from('to alice'))).not.toEqual(
      presenceDigest(Buffer.from('to bob')),
    );
  });
});

describe('verifyPresenceProof', () => {
  it('accepts a signature from an enrolled key over this message', () => {
    const device = deviceKey();

    expect(
      verifyPresenceProof({
        messageBase64: MESSAGE,
        signatureHex: device.signMessage(MESSAGE),
        enrolledKeys: [device.hardwarePublicKey],
      }),
    ).toBe(true);
  });

  it('accepts the second of several enrolled devices', () => {
    const other = deviceKey();
    const holding = deviceKey();

    expect(
      verifyPresenceProof({
        messageBase64: MESSAGE,
        signatureHex: holding.signMessage(MESSAGE),
        enrolledKeys: [other.hardwarePublicKey, holding.hardwarePublicKey],
      }),
    ).toBe(true);
  });

  it('refuses a key that is not enrolled', () => {
    const stranger = deviceKey();

    expect(
      verifyPresenceProof({
        messageBase64: MESSAGE,
        signatureHex: stranger.signMessage(MESSAGE),
        enrolledKeys: [deviceKey().hardwarePublicKey],
      }),
    ).toBe(false);
  });

  it('refuses a proof over a different message', () => {
    const device = deviceKey();
    const elsewhere = Buffer.from('a different transfer').toString('base64');

    expect(
      verifyPresenceProof({
        messageBase64: MESSAGE,
        signatureHex: device.signMessage(elsewhere),
        enrolledKeys: [device.hardwarePublicKey],
      }),
    ).toBe(false);
  });

  it('refuses a Turnkey stamp replayed as a presence proof', () => {
    const device = deviceKey();
    // What stamp() signs: SHA-256 of the request body, with no domain in front.
    const stampDigest = createHash('sha256')
      .update(Buffer.from(MESSAGE, 'base64'))
      .digest();

    expect(
      verifyPresenceProof({
        messageBase64: MESSAGE,
        signatureHex: device.signDigest(stampDigest),
        enrolledKeys: [device.hardwarePublicKey],
      }),
    ).toBe(false);
  });

  it('refuses when nothing is enrolled', () => {
    const device = deviceKey();

    expect(
      verifyPresenceProof({
        messageBase64: MESSAGE,
        signatureHex: device.signMessage(MESSAGE),
        enrolledKeys: [],
      }),
    ).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['not hex', 'zzzz'],
    ['truncated DER', '3044'],
    ['not a signature', '00'.repeat(64)],
  ])('refuses a %s signature without throwing', (_label, signatureHex) => {
    const device = deviceKey();

    expect(
      verifyPresenceProof({
        messageBase64: MESSAGE,
        signatureHex,
        enrolledKeys: [device.hardwarePublicKey],
      }),
    ).toBe(false);
  });

  it.each([
    ['uncompressed', `04${'11'.repeat(64)}`],
    ['wrong length', '02'],
    ['bad prefix', `05${'11'.repeat(32)}`],
    ['off the curve', `02${'11'.repeat(32)}`],
  ])('refuses a %s enrolled key without throwing', (_label, key) => {
    const device = deviceKey();

    expect(
      verifyPresenceProof({
        messageBase64: MESSAGE,
        signatureHex: device.signMessage(MESSAGE),
        enrolledKeys: [key],
      }),
    ).toBe(false);
  });

  it('still accepts a good key sitting beside an unparseable one', () => {
    const device = deviceKey();

    expect(
      verifyPresenceProof({
        messageBase64: MESSAGE,
        signatureHex: device.signMessage(MESSAGE),
        enrolledKeys: ['not-a-key', device.hardwarePublicKey],
      }),
    ).toBe(true);
  });
});

/**
 * The two sides derive the digest from different starting points: this one from
 * the message it recorded on the intent, the app from the transaction it was
 * handed. They have to land on the same bytes or every Spend under the limit is
 * refused, and nothing else in either test suite would notice.
 */
describe('digest agreement with the app', () => {
  it('matches the digest the app derives from the unsigned transaction', () => {
    const message = new TransactionMessage({
      payerKey: Keypair.generate().publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [
        SystemProgram.transfer({
          fromPubkey: Keypair.generate().publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1,
        }),
      ],
    }).compileToV0Message();

    // What prepare stores, and what the app is given.
    const messageBase64 = Buffer.from(message.serialize()).toString('base64');
    const unsignedTxBase64 = Buffer.from(
      new VersionedTransaction(message).serialize(),
    ).toString('base64');

    // modules/hardware-key/src/presence.ts, step for step.
    const appMessage = VersionedTransaction.deserialize(
      Buffer.from(unsignedTxBase64, 'base64'),
    ).message.serialize();
    const appDigest = createHash('sha256')
      .update(Buffer.from(new TextEncoder().encode(PRESENCE_DOMAIN)))
      .update(Buffer.from(appMessage))
      .digest();

    expect(presenceDigest(Buffer.from(messageBase64, 'base64'))).toEqual(
      appDigest,
    );
  });
});
