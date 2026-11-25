/// <reference types="jest" />
import type { AwaitingPayment, TransferRow } from "@/utils/apiClient";
import {
  arrivalLabel,
  activityDetailTimestamp,
  earnReceiptLabel,
  awaitingPaymentActivityEntry,
  securityActivityEntry,
  mapAccountEventToActivityEntry,
  ActivityEntry,
  groupIntoSections,
  isSwapRentRefund,
  mapTransferRowToActivityEntry,
  mapTransferRowsToActivityEntries,
  pendingSwapEntries,
  statusLabel,
  swapAmountLabel,
  swapPairLabel,
  swapVenueLabel,
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

describe("activityDetailTimestamp", () => {
  it("shows chain confirmation time rather than a delayed indexer's insertion time", () => {
    expect(
      activityDetailTimestamp({
        status: "confirmed",
        createdAt: "2026-09-19T16:50:09.878Z",
        confirmedAt: "2026-09-19T15:46:49.000Z",
      })
    ).toBe("2026-09-19T15:46:49.000Z");
  });
  it("keeps creation time when confirmation is unavailable", () => {
    expect(
      activityDetailTimestamp({
        status: "pending",
        createdAt: "2026-09-19T15:46:49.000Z",
        confirmedAt: null,
      })
    ).toBe("2026-09-19T15:46:49.000Z");
  });
});

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
      ).toBe("Received $10.00");
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

    expect(statusLabel(named)).toBe("Named Account");
    expect(statusLabel(renamed)).toBe("Renamed Account");
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
    usdcSettlementRaw: "30000000",
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

describe("a swap in the feed", () => {
  const SOL = "So11111111111111111111111111111111111111112";
  const ctx = { selfAddress: SELF, decimalsByMint: {} };

  it("reads as a swap on both sides rather than a send and a receive", () => {
    const paid = mapTransferRowToActivityEntry(makeRow({ swap: true }), ctx);
    const received = mapTransferRowToActivityEntry(
      makeRow({ swap: true, direction: "RECEIVE", mint: SOL }),
      ctx
    );
    expect(statusLabel(paid)).toBe("Swapped");
    expect(statusLabel(received)).toBe("Swapped");
    expect(
      statusLabel(
        mapTransferRowToActivityEntry(
          makeRow({ swap: true, status: "PENDING" }),
          ctx
        )
      )
    ).toBe("Swapping…");
  });

  it("leaves an ordinary send worded as a send", () => {
    expect(statusLabel(mapTransferRowToActivityEntry(makeRow(), ctx))).toBe(
      "Sent"
    );
  });

  it("hides the rent a swap repays, and nothing else of that size", () => {
    const refund = makeRow({ swap: true, mint: SOL, amountRaw: "2039280" });
    expect(isSwapRentRefund(refund)).toBe(true);
    expect(isSwapRentRefund({ ...refund, swap: undefined })).toBe(false);
    expect(isSwapRentRefund({ ...refund, direction: "RECEIVE" })).toBe(false);
    expect(isSwapRentRefund({ ...refund, amountRaw: "1000000000" })).toBe(
      false
    );
  });
});

describe("a swap shown as one trade", () => {
  const SOL = "So11111111111111111111111111111111111111112";
  const ctx = { selfAddress: SELF, decimalsByMint: {} };
  const side = (mint: string, amountRaw: string, decimals: number | null) => ({
    mint,
    amountRaw,
    decimals,
    tokenName: null,
    tokenSymbol: null,
    tokenIconUrl: null,
  });
  const details = {
    pay: { ...side(USDC_MINT, "1000000", 6), tokenSymbol: "USDC" },
    receive: side(SOL, "6342817", 9),
    venues: ["AlphaQ", "SolFi V2", "AlphaQ"],
  };
  const leg = (overrides: Partial<TransferRow>) =>
    makeRow({ swap: true, swapDetails: details, ...overrides });

  it("makes one entry of a swap whose paid side came twice and received side never", () => {
    const entries = mapTransferRowsToActivityEntries(
      [leg({ id: "a" }), leg({ id: "b" })],
      ctx
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].swap).toMatchObject({
      pay: { mint: USDC_MINT, amountRaw: "1000000", decimals: 6 },
      receive: { mint: SOL, amountRaw: "6342817", decimals: 9 },
    });
  });

  it("shows what moved when the chain reported a side once", () => {
    const [entry] = mapTransferRowsToActivityEntries(
      [
        leg({ id: "a" }),
        leg({ id: "b", direction: "RECEIVE", mint: SOL, amountRaw: "6300000" }),
      ],
      ctx
    );
    expect(entry.swap?.receive.amountRaw).toBe("6300000");
  });

  it("keeps ordinary rows and other swaps apart", () => {
    const entries = mapTransferRowsToActivityEntries(
      [
        leg({ id: "a" }),
        makeRow({ id: "plain", signature: "sig-plain" }),
        leg({ id: "c", signature: "sig-2" }),
      ],
      ctx
    );
    expect(entries.map((e) => e.id).sort()).toEqual(["a", "c", "plain"]);
  });

  it("still hides the rent a swap repays", () => {
    const entries = mapTransferRowsToActivityEntries(
      [leg({ id: "a" }), leg({ id: "rent", mint: SOL, amountRaw: "2039280" })],
      ctx
    );
    expect(entries.map((e) => e.id)).toEqual(["a"]);
  });

  it("names the pair, each venue once, and short amounts", () => {
    const [entry] = mapTransferRowsToActivityEntries([leg({})], ctx);
    expect(swapPairLabel(entry.swap!)).toBe("USDC → SOL");
    expect(swapVenueLabel(entry.swap!)).toBe("via AlphaQ + 1 more");
    expect(swapAmountLabel(entry.swap!.receive)).toBe("0.00634 SOL");
    expect(swapAmountLabel(entry.swap!.pay)).toBe("$1.00");
    expect(
      swapAmountLabel({ mint: SOL, amountRaw: "12616000000", decimals: 9 })
    ).toBe("12.616 SOL");
  });

  it("leaves out an amount whose precision was never recorded", () => {
    const WBTC = "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh";
    const [entry] = mapTransferRowsToActivityEntries(
      [
        leg({
          swapDetails: {
            ...details,
            receive: side(WBTC, "100000", null),
          },
        }),
      ],
      ctx
    );
    expect(entry.swap?.receive.decimals).toBeNull();
    expect(swapAmountLabel(entry.swap!.receive)).toBeNull();
    expect(swapAmountLabel(entry.swap!.pay)).toBe("$1.00");
  });

  it("knows SOL's precision without being told", () => {
    const [entry] = mapTransferRowsToActivityEntries(
      [
        leg({
          swapDetails: { ...details, receive: side(SOL, "6342817", null) },
        }),
      ],
      ctx
    );
    expect(swapAmountLabel(entry.swap!.receive)).toBe("0.00634 SOL");
  });

  it("says nothing of the route when it was not kept", () => {
    const [entry] = mapTransferRowsToActivityEntries(
      [leg({ swapDetails: { ...details, venues: [] } })],
      ctx
    );
    expect(swapVenueLabel(entry.swap!)).toBeNull();
  });
});

describe("a swap still on its way", () => {
  const SOL = "So11111111111111111111111111111111111111112";
  const sent = {
    account: SELF,
    signature: "sig-sent",
    createdAt: "2026-07-02T10:00:00.000Z",
    pay: {
      mint: USDC_MINT,
      amountRaw: "1000000",
      decimals: 6,
      symbol: "USDC",
      name: "USD Coin",
    },
    receive: { mint: SOL, decimals: 9, symbol: "SOL", name: "Solana" },
    venues: ["AlphaQ", "SolFi V2", "AlphaQ"],
  };

  it("shows from the moment it is sent, paid amount exact and received unknown", () => {
    const [entry] = pendingSwapEntries([sent], [], SELF);
    expect(entry.status).toBe("pending");
    expect(statusLabel(entry)).toBe("Swapping…");
    expect(swapPairLabel(entry.swap!)).toBe("USDC → SOL");
    expect(swapVenueLabel(entry.swap!)).toBe("via AlphaQ + 1 more");
    expect(swapAmountLabel(entry.swap!.pay)).toBe("$1.00");
    expect(swapAmountLabel(entry.swap!.receive)).toBeNull();
  });

  it("gives way once the feed reports the swap", () => {
    expect(
      pendingSwapEntries([sent], [makeRow({ signature: "sig-sent" })], SELF)
    ).toEqual([]);
    expect(
      pendingSwapEntries([sent], [makeRow({ signature: "other" })], SELF)
    ).toHaveLength(1);
  });

  it("settles the moment this phone sees it land, amount to follow", () => {
    const [entry] = pendingSwapEntries([{ ...sent, settled: true }], [], SELF);
    expect(entry.status).toBe("confirmed");
    expect(entry.swap?.receiving).toBe(true);
    expect(swapAmountLabel(entry.swap!.receive)).toBeNull();
  });

  it("shows what came back once it is read", () => {
    const [entry] = pendingSwapEntries(
      [{ ...sent, settled: true, receivedRaw: "6342817" }],
      [],
      SELF
    );
    expect(entry.swap?.receiving).toBe(false);
    expect(swapAmountLabel(entry.swap!.receive)).toBe("0.00634 SOL");
  });

  it("is shown only to the Account that sent it", () => {
    expect(pendingSwapEntries([sent], [], "someone-else")).toEqual([]);
  });

  it("says it is swapping where the route is not known", () => {
    const [entry] = pendingSwapEntries([{ ...sent, venues: [] }], [], SELF);
    expect(swapVenueLabel(entry.swap!)).toBeNull();
  });
});

describe("an Earn deposit or withdrawal", () => {
  const JL_USDC = "JlUsdcMint111111111111111111111111111111111";
  const VAULT = "JupLendVault1111111111111111111111111111111";
  const ctx = { selfAddress: SELF, decimalsByMint: {} };
  const deposit = {
    provider: "jupiter" as const,
    action: "deposit" as const,
    amountRaw: "15000000",
  };
  const usdcOut = (over: Partial<TransferRow> = {}) =>
    makeRow({
      id: "usdc-out",
      signature: "sig-earn",
      mint: USDC_MINT,
      amountRaw: "15000000",
      toAddress: VAULT,
      earn: deposit,
      ...over,
    });
  const receiptIn = (over: Partial<TransferRow> = {}) =>
    makeRow({
      id: "jl-in",
      signature: "sig-earn",
      direction: "RECEIVE",
      mint: JL_USDC,
      amountRaw: "14040000",
      fromAddress: VAULT,
      tokenSymbol: "jlUSDC",
      usdValue: "15.00",
      earn: deposit,
      ...over,
    });

  const originalUsdc = process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS;
  beforeEach(() => {
    process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS = USDC_MINT;
  });
  afterAll(() => {
    process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS = originalUsdc;
  });

  it("is one entry for both legs, standing on the USDC leg", () => {
    const entries = mapTransferRowsToActivityEntries(
      [receiptIn(), usdcOut()],
      ctx
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "usdc-out",
      direction: "send",
      mint: USDC_MINT,
      amountRaw: "15000000",
      decimals: 6,
      usdValue: null,
      earn: deposit,
    });
  });

  it("never shows the receipt token, even when it is the only leg indexed", () => {
    const [entry, ...rest] = mapTransferRowsToActivityEntries(
      [receiptIn()],
      ctx
    );
    expect(rest).toHaveLength(0);
    expect(entry).toMatchObject({
      id: "jl-in",
      direction: "send",
      mint: USDC_MINT,
      amountRaw: "15000000",
      tokenSymbol: "USDC",
      counterparty: "",
      earn: deposit,
    });
    expect(
      describeToken(entry.mint, entry.tokenSymbol, entry.tokenName).symbol
    ).toBe("USDC");
  });

  it("keeps separate operations and ordinary rows apart", () => {
    const withdrawal = {
      provider: "kamino" as const,
      action: "redeem" as const,
      amountRaw: "5000000",
    };
    const entries = mapTransferRowsToActivityEntries(
      [
        receiptIn(),
        usdcOut(),
        makeRow({
          id: "usdc-in",
          signature: "sig-wd",
          direction: "RECEIVE",
          earn: withdrawal,
        }),
        makeRow({ id: "plain", signature: "sig-plain" }),
      ],
      ctx
    );
    expect(entries.map((e) => e.id).sort()).toEqual([
      "plain",
      "usdc-in",
      "usdc-out",
    ]);
    const wd = entries.find((e) => e.id === "usdc-in")!;
    expect(wd).toMatchObject({
      direction: "receive",
      amountRaw: "5000000",
      earn: withdrawal,
    });
  });

  it("reads as the action in the row and provider plus action on the receipt", () => {
    const [entry] = mapTransferRowsToActivityEntries([usdcOut()], ctx);
    expect(statusLabel(entry)).toBe("Deposit");
    expect(earnReceiptLabel(entry.earn!)).toBe("Jupiter Lend Deposit");
    const [wd] = mapTransferRowsToActivityEntries(
      [
        makeRow({
          direction: "RECEIVE",
          earn: { provider: "kamino", action: "redeem", amountRaw: "1" },
        }),
      ],
      ctx
    );
    expect(statusLabel(wd)).toBe("Withdrawal");
    expect(earnReceiptLabel(wd.earn!)).toBe("Kamino Withdrawal");
    expect(statusLabel({ ...entry, status: "pending" })).toBe("Depositing…");
    expect(statusLabel({ ...entry, status: "failed" })).toBe("Failed");
  });
});
