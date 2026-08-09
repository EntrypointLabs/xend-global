/// <reference types="jest" />
import type { TransferRow } from "@/utils/apiClient";
import {
  securityActivityEntry,
  ActivityEntry,
  groupIntoSections,
  mapTransferRowToActivityEntry,
  statusLabel,
} from "@/utils/activity";
import {
  selectDecimalsByMint,
  selectStablecoinTotal,
  selectUsdc,
} from "@/utils/balances";

const SELF = "SelfWallet1111111111111111111111111111111111";
const OTHER = "OtherWallet22222222222222222222222222222222";
const USDC_MINT = "UsdcMint00000000000000000000000000000000000";
const USDT_MINT = "UsdtMint11111111111111111111111111111111111";

function makeRow(overrides: Partial<TransferRow> = {}): TransferRow {
  return {
    id: "t1",
    direction: "SEND",
    mint: USDC_MINT,
    amountRaw: "1000000",
    fromAddress: SELF,
    toAddress: OTHER,
    status: "CONFIRMED",
    signature: "sig-1",
    memo: null,
    kind: "transfer",
    merchantName: null,
    createdAt: "2026-07-02T10:00:00.000Z",
    confirmedAt: "2026-07-02T10:00:05.000Z",
    ...overrides,
  };
}

function makeEntry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: "e1",
    direction: "send",
    status: "confirmed",
    kind: "transfer",
    merchantName: null,
    mint: USDC_MINT,
    amountRaw: "1000000",
    decimals: 6,
    self: SELF,
    counterparty: OTHER,
    signature: "sig-1",
    memo: null,
    createdAt: "2026-07-02T10:00:00.000Z",
    confirmedAt: "2026-07-02T10:00:05.000Z",
    ...overrides,
  };
}

describe("mapTransferRowToActivityEntry", () => {
  const ctx = { selfAddress: SELF, decimalsByMint: { [USDC_MINT]: 6 } };

  it("maps a SEND: counterparty is the recipient, direction lower-cased", () => {
    const entry = mapTransferRowToActivityEntry(
      makeRow({ direction: "SEND", fromAddress: SELF, toAddress: OTHER }),
      ctx
    );
    expect(entry.direction).toBe("send");
    expect(entry.counterparty).toBe(OTHER);
    expect(entry.self).toBe(SELF);
  });

  it("maps a RECEIVE: counterparty is the sender", () => {
    const entry = mapTransferRowToActivityEntry(
      makeRow({ direction: "RECEIVE", fromAddress: OTHER, toAddress: SELF }),
      ctx
    );
    expect(entry.direction).toBe("receive");
    expect(entry.counterparty).toBe(OTHER);
  });

  it("maps a self-send: counterparty is still the recipient (self)", () => {
    const entry = mapTransferRowToActivityEntry(
      makeRow({ direction: "SEND", fromAddress: SELF, toAddress: SELF }),
      ctx
    );
    expect(entry.direction).toBe("send");
    expect(entry.counterparty).toBe(SELF);
  });

  it.each([
    ["PENDING", "pending"],
    ["CONFIRMED", "confirmed"],
    ["FAILED", "failed"],
  ] as const)("lower-cases status %s -> %s", (raw, expected) => {
    const entry = mapTransferRowToActivityEntry(makeRow({ status: raw }), ctx);
    expect(entry.status).toBe(expected);
  });

  it("defaults decimals to 6 when the mint is absent from the lookup", () => {
    const entry = mapTransferRowToActivityEntry(
      makeRow({ mint: "UnknownMint" }),
      { selfAddress: SELF, decimalsByMint: {} }
    );
    expect(entry.decimals).toBe(6);
  });

  it("uses the per-mint decimals override when present", () => {
    const entry = mapTransferRowToActivityEntry(
      makeRow({ mint: "WeirdMint" }),
      { selfAddress: SELF, decimalsByMint: { WeirdMint: 9 } }
    );
    expect(entry.decimals).toBe(9);
  });

  it("preserves a null signature", () => {
    const entry = mapTransferRowToActivityEntry(
      makeRow({ signature: null }),
      ctx
    );
    expect(entry.signature).toBeNull();
  });

  it("carries the raw amount and memo through unchanged", () => {
    const entry = mapTransferRowToActivityEntry(
      makeRow({ amountRaw: "42", memo: "lunch" }),
      ctx
    );
    expect(entry.amountRaw).toBe("42");
    expect(entry.memo).toBe("lunch");
  });

  it("maps a payment row to kind=payment, carrying the merchant name through", () => {
    const entry = mapTransferRowToActivityEntry(
      makeRow({ kind: "payment", merchantName: "Cafe Neo" }),
      ctx
    );
    expect(entry.kind).toBe("payment");
    expect(entry.merchantName).toBe("Cafe Neo");
  });

  it("maps a plain transfer row to kind=transfer with a null merchant name", () => {
    const entry = mapTransferRowToActivityEntry(makeRow(), ctx);
    expect(entry.kind).toBe("transfer");
    expect(entry.merchantName).toBeNull();
  });
});

describe("groupIntoSections", () => {
  it("buckets by UTC day and orders sections newest day first", () => {
    const jul1 = makeEntry({ id: "a", createdAt: "2026-07-01T09:00:00.000Z" });
    const jul2 = makeEntry({ id: "b", createdAt: "2026-07-02T09:00:00.000Z" });
    const sections = groupIntoSections([jul1, jul2]);
    expect(sections.map((s) => s.title)).toEqual(["2026-07-02", "2026-07-01"]);
    expect(sections[0].data).toHaveLength(1);
    expect(sections[1].data).toHaveLength(1);
  });

  it("sorts rows within a day newest first (createdAt desc, id desc)", () => {
    const early = makeEntry({ id: "a", createdAt: "2026-07-02T08:00:00.000Z" });
    const late = makeEntry({ id: "b", createdAt: "2026-07-02T20:00:00.000Z" });
    const tieLowId = makeEntry({
      id: "m",
      createdAt: "2026-07-02T12:00:00.000Z",
    });
    const tieHighId = makeEntry({
      id: "z",
      createdAt: "2026-07-02T12:00:00.000Z",
    });
    // Deliberately unsorted input.
    const sections = groupIntoSections([early, tieLowId, late, tieHighId]);
    expect(sections).toHaveLength(1);
    expect(sections[0].data.map((e) => e.id)).toEqual(["b", "z", "m", "a"]);
  });

  it("returns an empty array for no entries", () => {
    expect(groupIntoSections([])).toEqual([]);
  });
});

describe("statusLabel", () => {
  it("labels a pending row as Sending…", () => {
    expect(statusLabel(makeEntry({ status: "pending" }))).toBe("Sending…");
  });

  it("labels a failed row as Failed regardless of direction", () => {
    expect(
      statusLabel(makeEntry({ status: "failed", direction: "receive" }))
    ).toBe("Failed");
  });

  it("labels a confirmed send as Sent", () => {
    expect(
      statusLabel(makeEntry({ status: "confirmed", direction: "send" }))
    ).toBe("Sent");
  });

  it("labels a confirmed receive as Received", () => {
    expect(
      statusLabel(makeEntry({ status: "confirmed", direction: "receive" }))
    ).toBe("Received");
  });

  it("labels a confirmed payment as Paid", () => {
    expect(
      statusLabel(makeEntry({ kind: "payment", status: "confirmed" }))
    ).toBe("Paid");
  });

  it("labels a pending payment as Paying…", () => {
    expect(statusLabel(makeEntry({ kind: "payment", status: "pending" }))).toBe(
      "Paying…"
    );
  });
});

describe("balance selectors", () => {
  const originalUsdc = process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS;
  const originalUsdt = process.env.EXPO_PUBLIC_USDT_MINT_ADDRESS;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS = USDC_MINT;
    process.env.EXPO_PUBLIC_USDT_MINT_ADDRESS = USDT_MINT;
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS = originalUsdc;
    process.env.EXPO_PUBLIC_USDT_MINT_ADDRESS = originalUsdt;
  });

  const tokens = [
    { mint: USDC_MINT, amountRaw: "1500000", decimals: 6, symbol: "USDC" },
    { mint: USDT_MINT, amountRaw: "2250000", decimals: 6, symbol: "USDT" },
    {
      mint: "OtherCoinMint",
      amountRaw: "9999000000",
      decimals: 6,
      symbol: "X",
    },
  ];

  describe("selectStablecoinTotal", () => {
    it("sums recognized stablecoins and ignores other mints", () => {
      // 1.5 USDC + 2.25 USDT = 3.75; the 9999 non-stablecoin is excluded.
      expect(selectStablecoinTotal(tokens)).toBe(3.75);
    });

    it("only counts USDC when USDT is unset", () => {
      delete process.env.EXPO_PUBLIC_USDT_MINT_ADDRESS;
      expect(selectStablecoinTotal(tokens)).toBe(1.5);
    });

    it("handles large u64 amounts without precision loss", () => {
      const big = [
        {
          mint: USDC_MINT,
          amountRaw: "1000000000000",
          decimals: 6,
          symbol: "USDC",
        },
      ];
      expect(selectStablecoinTotal(big)).toBe(1000000);
    });

    it("defaults to 0 for undefined tokens", () => {
      expect(selectStablecoinTotal(undefined)).toBe(0);
    });
  });

  describe("selectUsdc", () => {
    it("returns the USDC holding as a number", () => {
      expect(selectUsdc(tokens)).toBe(1.5);
    });

    it("returns 0 when there is no USDC holding", () => {
      expect(
        selectUsdc([
          {
            mint: USDT_MINT,
            amountRaw: "2250000",
            decimals: 6,
            symbol: "USDT",
          },
        ])
      ).toBe(0);
    });

    it("returns 0 when the USDC mint env is unset", () => {
      delete process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS;
      expect(selectUsdc(tokens)).toBe(0);
    });

    it("returns 0 for undefined tokens", () => {
      expect(selectUsdc(undefined)).toBe(0);
    });
  });

  describe("selectDecimalsByMint", () => {
    it("builds a mint -> decimals lookup", () => {
      expect(selectDecimalsByMint(tokens)).toEqual({
        [USDC_MINT]: 6,
        [USDT_MINT]: 6,
        OtherCoinMint: 6,
      });
    });

    it("returns an empty object for undefined tokens", () => {
      expect(selectDecimalsByMint(undefined)).toEqual({});
    });
  });
});

describe("security activity", () => {
  const entry = securityActivityEntry({
    id: "sec-1",
    label: "Added Recovery Key",
    at: "2026-08-05T10:00:00.000Z",
    self: "SelfAddr",
  });

  it("labels itself with the change rather than a money verb", () => {
    expect(statusLabel(entry)).toBe("Added Recovery Key");
  });

  it("falls back when no label is supplied", () => {
    expect(statusLabel({ ...entry, securityLabel: undefined })).toBe(
      "Account updated"
    );
  });

  it("carries no amount, so it cannot be read as money moving", () => {
    expect(entry.amountRaw).toBe("0");
    expect(entry.mint).toBe("");
  });

  it("groups into the feed alongside transfers", () => {
    const sections = groupIntoSections([entry]);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.data[0]!.id).toBe("sec-1");
  });
});
