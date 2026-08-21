/**
 * DER ECDSA signature normalisation, kept free of native imports so it can be
 * tested without a device.
 */

/** secp256r1 group order, for the low-S normalisation below. */
const CURVE_ORDER = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"
);
const HALF_ORDER = CURVE_ORDER / 2n;

/**
 * Rewrites a DER ECDSA signature to its low-S form.
 *
 * `(r, s)` and `(r, n - s)` are both valid, and Apple's and Android's
 * implementations do not promise the low half. Verifiers that enforce low-S
 * reject the high one, so a signature that is cryptographically correct fails
 * roughly half the time. Normalising here removes the coin flip.
 */
export function normaliseLowS(derHex: string): string {
  const der = hexToBytes(derHex);
  if (der[0] !== 0x30) throw new Error("signature is not DER");

  const rLength = der[3]!;
  const rStart = 4;
  const sLengthIndex = rStart + rLength + 1;
  const sLength = der[sLengthIndex]!;
  const sStart = sLengthIndex + 1;

  const r = der.slice(rStart, rStart + rLength);
  const s = der.slice(sStart, sStart + sLength);

  const sValue = bytesToBigInt(s);
  if (sValue <= HALF_ORDER) return derHex;

  return encodeDer(r, bigIntToBytes(CURVE_ORDER - sValue));
}

function encodeDer(r: Uint8Array, s: Uint8Array): string {
  const rInt = withSignPadding(r);
  const sInt = withSignPadding(s);
  const body = new Uint8Array([
    0x02,
    rInt.length,
    ...rInt,
    0x02,
    sInt.length,
    ...sInt,
  ]);
  return bytesToHex(new Uint8Array([0x30, body.length, ...body]));
}

/** DER integers are signed, so a leading bit of 1 needs a 0x00 in front. */
function withSignPadding(value: Uint8Array): Uint8Array {
  let start = 0;
  while (start < value.length - 1 && value[start] === 0x00) start++;
  const trimmed = value.slice(start);
  return trimmed[0]! & 0x80 ? new Uint8Array([0x00, ...trimmed]) : trimmed;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  return bytes.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
}

function bigIntToBytes(value: bigint): Uint8Array {
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return hexToBytes(hex);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
