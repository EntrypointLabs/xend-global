import { normaliseLowS } from "@/modules/hardware-key/src/lowS";

const CURVE_ORDER = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"
);

function der(r: bigint, s: bigint): string {
  const encode = (value: bigint) => {
    let hex = value.toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    const bytes = hex.match(/.{2}/g)!.map((b) => parseInt(b, 16));
    if (bytes[0]! & 0x80) bytes.unshift(0x00);
    return bytes;
  };
  const rb = encode(r);
  const sb = encode(s);
  const body = [0x02, rb.length, ...rb, 0x02, sb.length, ...sb];
  return [0x30, body.length, ...body]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseS(hex: string): bigint {
  const bytes = hex.match(/.{2}/g)!.map((b) => parseInt(b, 16));
  const rLength = bytes[3]!;
  const sLength = bytes[4 + rLength + 1]!;
  const s = bytes.slice(4 + rLength + 2, 4 + rLength + 2 + sLength);
  return s.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
}

describe("normaliseLowS", () => {
  const r = 0x1234n;

  it("leaves a signature that is already low-S untouched", () => {
    const low = der(r, 2n);
    expect(normaliseLowS(low)).toBe(low);
  });

  it("folds a high-S signature into the low half", () => {
    // Secure Enclave and Keystore make no promise about which half they emit,
    // and a verifier that enforces low-S rejects the high one, so an otherwise
    // correct signature fails about half the time without this.
    const high = der(r, CURVE_ORDER - 2n);
    const normalised = normaliseLowS(high);

    expect(normalised).not.toBe(high);
    expect(parseS(normalised)).toBe(2n);
  });

  it("keeps S at exactly half the order, which is already the low half", () => {
    const half = CURVE_ORDER / 2n;
    expect(parseS(normaliseLowS(der(r, half)))).toBe(half);
  });

  it("folds S one above half the order", () => {
    const justOver = CURVE_ORDER / 2n + 1n;
    expect(parseS(normaliseLowS(der(r, justOver)))).toBe(
      CURVE_ORDER - justOver
    );
  });

  it("preserves R", () => {
    const bigR = CURVE_ORDER - 5n;
    const normalised = normaliseLowS(der(bigR, CURVE_ORDER - 2n));
    const bytes = normalised.match(/.{2}/g)!.map((b) => parseInt(b, 16));
    const rLength = bytes[3]!;
    const parsedR = bytes
      .slice(4, 4 + rLength)
      .reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);

    expect(parsedR).toBe(bigR);
  });

  it("rejects input that is not DER", () => {
    expect(() => normaliseLowS("0011")).toThrow(/not DER/);
  });
});
