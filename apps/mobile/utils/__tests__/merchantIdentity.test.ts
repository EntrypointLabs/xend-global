import {
  ListSessionsResponseSchema,
  TransferRowSchema,
} from "@/utils/apiClient";
import { mapTransferRowToActivityEntry } from "@/utils/activity";
import { resolveMerchantMark } from "@/utils/merchantCategory";

jest.mock("@/utils/errors", () => ({
  handleError: jest.fn(),
  ErrorCode: {},
  ENTRY_SESSION_SEND_MESSAGE: "",
}));
jest.mock("@/utils/toast", () => ({ showToast: jest.fn() }));
jest.mock("@/utils/storage/authStorage", () => ({
  AuthStorage: { getToken: jest.fn() },
}));
jest.mock("@/utils/devSeed", () => ({ SEED_DEMO: false }));

describe("resolveMerchantMark", () => {
  it("shows the logo while it has not failed", () => {
    expect(
      resolveMerchantMark({
        logoUrl: "https://cdn.test/uber.png",
        category: "transport",
        logoFailed: false,
      })
    ).toEqual({ kind: "logo", uri: "https://cdn.test/uber.png" });
  });

  it("falls back to the category when the logo fails to load", () => {
    expect(
      resolveMerchantMark({
        logoUrl: "https://cdn.test/404.png",
        category: "food_drink",
        logoFailed: true,
      })
    ).toEqual({ kind: "category", category: "food_drink" });
  });

  it("uses the category when there is no logo at all", () => {
    expect(
      resolveMerchantMark({
        logoUrl: null,
        category: "groceries",
        logoFailed: false,
      })
    ).toEqual({ kind: "category", category: "groceries" });
  });

  it("treats a blank logo URL as no logo", () => {
    expect(
      resolveMerchantMark({ logoUrl: "  ", category: null, logoFailed: false })
    ).toEqual({ kind: "generic" });
  });

  it("falls back to the storefront when the logo fails and there is no category", () => {
    expect(
      resolveMerchantMark({
        logoUrl: "https://cdn.test/404.png",
        category: undefined,
        logoFailed: true,
      })
    ).toEqual({ kind: "generic" });
  });
});

const baseRow = {
  id: "t1",
  direction: "SEND",
  mint: "Mint",
  amountRaw: "8000000",
  fromAddress: "Self",
  toAddress: "Shop",
  status: "CONFIRMED",
  signature: null,
  memo: null,
  kind: "payment",
  merchantName: "Prydd Shop",
  createdAt: "2026-11-20T10:00:00.000Z",
  confirmedAt: null,
};

describe("TransferRowSchema merchant identity", () => {
  it("still parses a row from a backend that predates the fields", () => {
    const row = TransferRowSchema.parse(baseRow);
    expect(row.merchantLogoUrl).toBeUndefined();
    expect(row.merchantCategory).toBeUndefined();
  });

  it("reads the logo and category", () => {
    const row = TransferRowSchema.parse({
      ...baseRow,
      merchantLogoUrl: "https://cdn.test/shop.png",
      merchantCategory: "shopping",
    });
    expect(row.merchantLogoUrl).toBe("https://cdn.test/shop.png");
    expect(row.merchantCategory).toBe("shopping");
  });

  it("reads a category this build does not know as none instead of rejecting the row", () => {
    const row = TransferRowSchema.parse({
      ...baseRow,
      merchantCategory: "pets",
    });
    expect(row.merchantCategory).toBeNull();
  });

  it("carries the identity onto a Payment entry and not onto a plain transfer", () => {
    const ctx = { selfAddress: "Self", decimalsByMint: {} };
    const payment = mapTransferRowToActivityEntry(
      TransferRowSchema.parse({
        ...baseRow,
        merchantLogoUrl: "https://cdn.test/shop.png",
        merchantCategory: "shopping",
      }),
      ctx
    );
    expect(payment.merchantLogoUrl).toBe("https://cdn.test/shop.png");
    expect(payment.merchantCategory).toBe("shopping");

    const transfer = mapTransferRowToActivityEntry(
      TransferRowSchema.parse({
        ...baseRow,
        kind: "transfer",
        merchantName: null,
        merchantLogoUrl: "https://cdn.test/shop.png",
        merchantCategory: "shopping",
      }),
      ctx
    );
    expect(transfer.merchantLogoUrl).toBeNull();
    expect(transfer.merchantCategory).toBeNull();
  });
});

describe("ListSessionsResponseSchema merchant identity", () => {
  const session = {
    id: "s1",
    merchantDisplayName: "Prydd Shop",
    createdAt: "2026-11-20T10:00:00.000Z",
    lastUsedAt: "2026-11-21T10:00:00.000Z",
    expiresAt: "2026-12-20T10:00:00.000Z",
  };

  it("parses sessions with and without the new fields", () => {
    const { sessions } = ListSessionsResponseSchema.parse({
      sessions: [
        session,
        {
          ...session,
          id: "s2",
          merchantLogoUrl: null,
          merchantCategory: "food_drink",
        },
      ],
    });
    expect(sessions[0].merchantLogoUrl).toBeUndefined();
    expect(sessions[1].merchantLogoUrl).toBeNull();
    expect(sessions[1].merchantCategory).toBe("food_drink");
  });
});
