import { Buffer } from "buffer";

import { SwapTransactionError, toBytes } from "@/utils/swapTransaction";

describe("toBytes", () => {
  it("decodes base64 instruction data", () => {
    // ComputeBudget sets a unit price this way; the string form is base64.
    expect(Array.from(toBytes("AkQhBQA="))).toEqual([2, 68, 33, 5, 0]);
  });

  it("accepts a plain byte array", () => {
    expect(Array.from(toBytes([2, 192, 92, 21, 0]))).toEqual([
      2, 192, 92, 21, 0,
    ]);
  });

  it("round trips arbitrary bytes through base64", () => {
    const bytes = Uint8Array.from({ length: 64 }, (_, i) => (i * 7) % 256);
    const encoded = Buffer.from(bytes).toString("base64");
    expect(Array.from(toBytes(encoded))).toEqual(Array.from(bytes));
  });

  it("returns an empty array for empty data rather than throwing", () => {
    expect(Array.from(toBytes(""))).toEqual([]);
    expect(Array.from(toBytes([]))).toEqual([]);
  });

  it("rejects anything else instead of producing silent garbage", () => {
    expect(() => toBytes(null)).toThrow(SwapTransactionError);
    expect(() => toBytes(undefined)).toThrow(SwapTransactionError);
    expect(() => toBytes({ data: [1, 2] })).toThrow(SwapTransactionError);
    expect(() => toBytes(42)).toThrow(SwapTransactionError);
  });
});
