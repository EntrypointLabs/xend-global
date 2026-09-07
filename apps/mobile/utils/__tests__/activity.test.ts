/// <reference types="jest" />
import type { AwaitingPayment, TransferRow } from "@/utils/apiClient";
import {
  arrivalLabel,
  awaitingPaymentActivityEntry,
  securityActivityEntry,
  mapAccountEventToActivityEntry,
  ActivityEntry,
  groupIntoSections,
  mapTransferRowToActivityEntry,
  statusLabel,
} from "@/utils/activity";
import { describeToken } from "@/utils/tokens";
import {
  formatMoney,
  formatUsdFromString,
  selectDecimalsByMint,
  selectPortfolio,
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
    it("counts USDC only, because Cash is USDC", () => {
      // USDT is a holding, not spending money, so it belongs to Investments.
      expect(selectStablecoinTotal(tokens)).toBe(1.5);
    });

    it("still counts USDC only when USDT is unset", () => {
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

  describe("mapTransferRowToActivityEntry decimals", () => {
    const row = {
      id: "t1",
      direction: "RECEIVE",
      mint: "So11111111111111111111111111111111111111112",
      amountRaw: "5000000000",
      fromAddress: "them",
      toAddress: "us",
      status: "CONFIRMED",
      signature: "sig",
      memo: null,
      kind: "transfer",
      merchantName: null,
      createdAt: "2026-08-19T00:00:00.000Z",
      confirmedAt: "2026-08-19T00:00:00.000Z",
    } as unknown as TransferRow;

    it("uses the row's own decimals over what the Consumer holds today", () => {
      // The holdings lookup is deliberately wrong here: a token already sent
      // away is absent from it, and taking its answer renders 5 SOL as 5,000.
      const entry = mapTransferRowToActivityEntry(
        { ...row, decimals: 9 } as TransferRow,
        { selfAddress: "us", decimalsByMint: {} }
      );
      expect(entry.decimals).toBe(9);
    });

    it("falls back to the holdings lookup for a row indexed before decimals were stored", () => {
      const entry = mapTransferRowToActivityEntry(row, {
        selfAddress: "us",
        decimalsByMint: { [row.mint]: 9 },
      });
      expect(entry.decimals).toBe(9);
    });
  });

  describe("token identity on an activity row", () => {
    const SOL = "So11111111111111111111111111111111111111112";
    const base = {
      id: "t1",
      direction: "RECEIVE",
      mint: SOL,
      amountRaw: "5000000000",
      decimals: 9,
      fromAddress: "them",
      toAddress: "us",
      status: "CONFIRMED",
      signature: "sig",
      memo: null,
      kind: "transfer",
      merchantName: null,
      createdAt: "2026-08-19T00:00:00.000Z",
      confirmedAt: "2026-08-19T00:00:00.000Z",
    } as unknown as TransferRow;

    it("keeps the row's own logo when the Consumer holds none of the token", () => {
      // Convert every SOL to USDC and the holdings map has nothing left to
      // name it with; the row still does.
      const entry = mapTransferRowToActivityEntry(
        {
          ...base,
          tokenIconUrl: "https://example.test/sol.png",
        } as TransferRow,
        { selfAddress: "us", decimalsByMint: {}, iconsByMint: {} }
      );
      expect(entry.iconUrl).toBe("https://example.test/sol.png");
    });

    it("falls back to the holdings map for a row indexed before identity was carried", () => {
      const entry = mapTransferRowToActivityEntry(base, {
        selfAddress: "us",
        decimalsByMint: {},
        iconsByMint: { [SOL]: "https://example.test/held.png" },
      });
      expect(entry.iconUrl).toBe("https://example.test/held.png");
    });

    it("keeps our own name for SOL over the index's", () => {
      const entry = mapTransferRowToActivityEntry(
        {
          ...base,
          tokenName: "Wrapped SOL",
          tokenSymbol: "SOL",
        } as TransferRow,
        { selfAddress: "us", decimalsByMint: {} }
      );
      // The renderer resolves through describeToken, where our naming wins.
      expect(
        describeToken(entry.mint, entry.tokenSymbol, entry.tokenName)
      ).toEqual({ name: "Solana", symbol: "SOL" });
    });
  });

  describe("arrivalLabel", () => {
    const SOL = "So11111111111111111111111111111111111111112";
    const row = (over: Record<string, unknown>) =>
      ({
        id: "t",
        direction: "RECEIVE",
        mint: SOL,
        amountRaw: "5000000000",
        decimals: 9,
        status: "CONFIRMED",
        ...over,
      }) as unknown as TransferRow;

    it("names the amount and the asset, not the dollars", () => {
      expect(arrivalLabel(row({}))).toBe("Received 5 SOL");
    });

    it("scales by the row's own decimals", () => {
      expect(
        arrivalLabel(
          row({ mint: USDC_MINT, amountRaw: "10000000", decimals: 6 })
        )
      ).toBe("Received 10 USDC");
    });

    it("omits a ticker it does not have", () => {
      expect(
        arrivalLabel(
          row({ mint: "SomeUnknownMint", amountRaw: "1000000", decimals: 6 })
        )
      ).toBe("Received 1");
    });
  });

  describe("formatUsdFromString", () => {
    it("renders a stored decimal string as money", () => {
      expect(formatUsdFromString("500.000000")).toBe("$500.00");
      expect(formatUsdFromString("1234.5")).toBe("$1,234.50");
    });

    it("renders nothing for a value it cannot read", () => {
      expect(formatUsdFromString("not-a-number")).toBe("");
    });
  });

  describe("selectPortfolio", () => {
    it("puts USDT in Investments, not Cash", () => {
      const held = [
        { mint: USDC_MINT, amountRaw: "20000000", decimals: 6, symbol: "USDC" },
        {
          mint: USDT_MINT,
          amountRaw: "5000000",
          decimals: 6,
          symbol: "USDT",
          usdValue: 5,
        },
      ];
      const p = selectPortfolio(held);
      expect(p.cashUsd).toBe(20);
      expect(p.investmentsUsd).toBe(5);
    });

    const priced = [
      { mint: USDC_MINT, amountRaw: "20000000", decimals: 6, symbol: "USDC" },
      {
        mint: "So11111111111111111111111111111111111111112",
        amountRaw: "5000000000",
        decimals: 9,
        symbol: "SOL",
        usdValue: 408.58,
      },
    ];

    it("counts cash at face value and investments at their priced value", () => {
      expect(selectPortfolio(priced)).toEqual({
        cashUsd: 20,
        investmentsUsd: 408.58,
        hasUnpricedHoldings: false,
      });
    });

    it("never prices a stablecoin off usdValue", () => {
      // A quoted 0.9997 would make a 20 USDC balance read as $19.99 in the one
      // place a Consumer expects the number to be exact.
      const depegged = [
        {
          mint: USDC_MINT,
          amountRaw: "20000000",
          decimals: 6,
          symbol: "USDC",
          usdValue: 19.994,
        },
      ];
      expect(selectPortfolio(depegged).cashUsd).toBe(20);
    });

    it("flags an unpriced holding instead of counting it as worthless", () => {
      const unpriced = [
        {
          mint: "OtherCoinMint",
          amountRaw: "9999000000",
          decimals: 6,
          symbol: "X",
          usdValue: null,
        },
      ];
      expect(selectPortfolio(unpriced)).toEqual({
        cashUsd: 0,
        investmentsUsd: 0,
        hasUnpricedHoldings: true,
      });
    });

    it("ignores a closed token account lingering at zero", () => {
      const closed = [
        {
          mint: "OtherCoinMint",
          amountRaw: "0",
          decimals: 6,
          symbol: "X",
          usdValue: null,
        },
      ];
      expect(selectPortfolio(closed)).toEqual({
        cashUsd: 0,
        investmentsUsd: 0,
        hasUnpricedHoldings: false,
      });
    });

    it("returns zeros for undefined tokens", () => {
      expect(selectPortfolio(undefined)).toEqual({
        cashUsd: 0,
        investmentsUsd: 0,
        hasUnpricedHoldings: false,
      });
    });
  });

  describe("formatMoney", () => {
    it("formats to two decimals with a thousands separator, no symbol", () => {
      // BalanceView adds the "$" and greys the decimals.
      expect(formatMoney(428.58)).toBe("428.58");
      expect(formatMoney(1234.5)).toBe("1,234.50");
      expect(formatMoney(0)).toBe("0.00");
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

describe("mapAccountEventToActivityEntry", () => {
  const base = {
    id: "evt-1",
    subject: "a@example.com",
    previousSubject: null,
    signature: "5xSig",
    occurredAt: "2026-08-22T15:31:00.000Z",
  };

  it("prefixes the id so it cannot collide with a transfer", () => {
    const entry = mapAccountEventToActivityEntry(
      { ...base, kind: "recovery_key_added" },
      "SELF"
    );

    // The feed keys on `id` alone and these come from a different table.
    expect(entry.id).toBe("event:evt-1");
  });

  it("reads as a security entry, not a zero-value transfer", () => {
    const entry = mapAccountEventToActivityEntry(
      { ...base, kind: "recovery_key_added" },
      "SELF"
    );

    expect(entry.kind).toBe("security");
    expect(entry.amountRaw).toBe("0");
    expect(statusLabel(entry)).toBe("Added Recovery Key");
    expect(entry.securitySubject).toBe("a@example.com");
  });

  it("says which way a recovery key went", () => {
    const removed = mapAccountEventToActivityEntry(
      { ...base, kind: "recovery_key_removed" },
      "SELF"
    );

    expect(statusLabel(removed)).toBe("Removed Recovery Key");
  });

  it("distinguishes a first name from a rename", () => {
    const named = mapAccountEventToActivityEntry(
      {
        ...base,
        kind: "wallet_renamed",
        subject: "Gift",
        previousSubject: null,
      },
      "SELF"
    );
    const renamed = mapAccountEventToActivityEntry(
      {
        ...base,
        kind: "wallet_renamed",
        subject: "Gift",
        previousSubject: "Wallet",
      },
      "SELF"
    );

    expect(statusLabel(named)).toBe("Named Wallet");
    expect(statusLabel(renamed)).toBe("Renamed Wallet");
  });

  it("dates the entry when it happened", () => {
    const entry = mapAccountEventToActivityEntry(
      { ...base, kind: "recovery_key_added" },
      "SELF"
    );

    // Not when it was recorded: a key that landed on chain yesterday is
    // written when the app next polls, and the feed should say yesterday.
    expect(entry.createdAt).toBe(base.occurredAt);
  });
});

describe("awaitingPaymentActivityEntry", () => {
  const payment: AwaitingPayment = {
    reference: "pi_1",
    merchantDisplayName: "Sabi Market",
    displayCurrency: "NGN",
    displayAmountMinor: "4500000",
    deferredAt: "2026-08-29T10:00:00.000Z",
    expiresAt: "2026-08-29T11:00:00.000Z",
  };

  it("asks for approval rather than reporting a Payment that happened", () => {
    const entry = awaitingPaymentActivityEntry(payment, "SELF");

    expect(entry.kind).toBe("awaiting");
    expect(statusLabel(entry)).toBe("Needs your approval");
    expect(entry.merchantName).toBe("Sabi Market");
  });

  it("carries the Merchant's own currency, not a token amount", () => {
    // Nothing has moved, so there is no settlement figure to render. Putting a
    // token amount here would show a number no Payment has produced.
    const entry = awaitingPaymentActivityEntry(payment, "SELF");

    expect(entry.displayCurrency).toBe("NGN");
    expect(entry.displayAmountMinor).toBe("4500000");
    expect(entry.amountRaw).toBe("0");
    expect(entry.mint).toBe("");
  });

  it("dates the entry when the Consumer was asked", () => {
    // Not when it was rendered: a timestamp computed here moves on every
    // render and drifts between the row's position and the day it files under.
    const entry = awaitingPaymentActivityEntry(payment, "SELF");

    expect(entry.createdAt).toBe(payment.deferredAt);
  });

  it("keys apart from the transfers beside it", () => {
    // The list keys on id alone, and these come from a different source than
    // the rows they are merged with.
    const entry = awaitingPaymentActivityEntry(payment, "SELF");

    expect(entry.id).toBe("awaiting:pi_1");
  });

  it("sits in the feed with the transfers, newest first", () => {
    const older = securityActivityEntry({
      id: "event:1",
      label: "Added Recovery Key",
      at: "2026-08-29T09:00:00.000Z",
      self: "SELF",
    });
    const sections = groupIntoSections([
      older,
      awaitingPaymentActivityEntry(payment, "SELF"),
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0].data.map((row) => row.id)).toEqual([
      "awaiting:pi_1",
      "event:1",
    ]);
  });
});
