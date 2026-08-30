import { createHash, createPublicKey, verify } from 'node:crypto';

/**
 * Proof that the Consumer was present, on their enrolled device, for this
 * exact Spend.
 *
 * Under the spending limit a Spend needs one on-chain signature, and that
 * signature comes from the Privy wallet, which signs from a session rather
 * than from anything the Consumer does at the time. So the strongest thing
 * the chain asks for is satisfied by a phone lying unlocked on a table.
 *
 * The device key backing S2 is the one thing on the phone that cannot be used
 * without a face or a fingerprint, and its public half is already enrolled and
 * attested per Consumer. Making a signature from it a condition of broadcast
 * puts a biometric in front of every Spend without changing the signer set, the
 * policies, or what lands on chain. Above the limit nothing is added: S2 is
 * already signing the transaction itself, which is the same key and the same
 * prompt.
 *
 * What this is not: a signer. It authorises nothing on chain and no Solana
 * program reads it. It is a condition this backend imposes before it will
 * broadcast, and a Consumer holding two signers can always move funds without
 * it. Bypassing it means bypassing this API, not defeating the threshold.
 */

/**
 * Bound into the digest so this key's two jobs cannot be confused.
 *
 * The same key stamps Turnkey activity bodies, and a signature is only ever
 * over 32 bytes with nothing saying where they came from. Prefixing the domain
 * means a Turnkey stamp can never be replayed here as a presence proof, or the
 * reverse, without a SHA-256 preimage.
 */
export const PRESENCE_DOMAIN = 'xend:spend-presence:v1';

/**
 * SubjectPublicKeyInfo header for a P-256 key, up to the point itself.
 *
 * The device reports its key SEC1-compressed, and OpenSSL will not parse a bare
 * point. Wrapping it back into DER is cheaper and less error-prone than
 * decompressing to (x, y) by hand for a JWK: this is a fixed prefix, and any
 * corruption fails loudly in createPublicKey rather than producing a key that
 * verifies the wrong things.
 *
 * SEQUENCE(0x39) { SEQUENCE(0x13) { OID ecPublicKey, OID prime256v1 },
 * BIT STRING(0x22) { 0 unused bits, 33-byte point } }
 */
const P256_SPKI_PREFIX = Buffer.from(
  '3039301306072a8648ce3d020106082a8648ce3d030107032200',
  'hex',
);

const COMPRESSED_POINT_BYTES = 33;

/**
 * What the device is asked to sign: the compiled transaction message, not the
 * intent id.
 *
 * The message is the recipient, the mint and the amount. Signing an opaque
 * identifier would prove someone touched the sensor while *a* Spend was in
 * flight; signing the message is the only version that says which one, and it
 * is the same bytes `submit` already pins the signed transaction to.
 */
export function presenceDigest(message: Buffer): Buffer {
  return createHash('sha256')
    .update(Buffer.from(PRESENCE_DOMAIN, 'utf8'))
    .update(message)
    .digest();
}

/**
 * True when `signatureHex` is a P-256 signature over this message's digest by
 * any of the Consumer's enrolled device keys.
 *
 * Every enrolled key is tried rather than one nominated by the client. The
 * caller supplies the set from the database, so which device signed is never
 * the client's claim to make, and a Consumer with the app on two phones is not
 * locked out of the one they are holding.
 */
export function verifyPresenceProof(params: {
  /** Base64 of the compiled v0 message, as recorded on the intent. */
  messageBase64: string;
  /** DER ECDSA signature, hex, as the device produced it. */
  signatureHex: string;
  /** Compressed P-256 public keys, hex, from `approval_signers`. */
  enrolledKeys: readonly string[];
}): boolean {
  if (params.enrolledKeys.length === 0) return false;

  let signature: Buffer;
  let digest: Buffer;
  try {
    signature = Buffer.from(params.signatureHex, 'hex');
    digest = presenceDigest(Buffer.from(params.messageBase64, 'base64'));
  } catch {
    return false;
  }
  if (signature.length === 0) return false;

  return params.enrolledKeys.some((key) => verifies(digest, signature, key));
}

/**
 * A key that will not parse is a bad row, not a failed proof, but it is treated
 * as one anyway: the alternative is one unusable enrolment locking a Consumer
 * out of every Spend on a device whose key is fine.
 */
function verifies(digest: Buffer, signature: Buffer, keyHex: string): boolean {
  try {
    const point = Buffer.from(keyHex, 'hex');
    if (point.length !== COMPRESSED_POINT_BYTES) return false;
    if (point[0] !== 0x02 && point[0] !== 0x03) return false;

    const publicKey = createPublicKey({
      key: Buffer.concat([P256_SPKI_PREFIX, point]),
      format: 'der',
      type: 'spki',
    });
    // Null algorithm: the payload is already the digest, which is what the
    // Secure Enclave and StrongBox both sign. Hashing again here would verify
    // something the device never saw.
    return verify(null, digest, publicKey, signature);
  } catch {
    return false;
  }
}
