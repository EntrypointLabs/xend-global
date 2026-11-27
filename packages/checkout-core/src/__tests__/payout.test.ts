import { describe, expect, it } from "vitest";

import {
  PAYOUT_WALLET_PATH,
  PayoutWalletConfigError,
  payoutWalletFile,
  payoutWalletResponse,
} from "../payout/payout";

const WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

describe("payoutWalletFile", () => {
  it("names the wallet for each network given", () => {
    expect(payoutWalletFile({ mainnet: WALLET })).toEqual({
      payoutWallets: { mainnet: WALLET },
    });
  });

  it("drops networks left empty", () => {
    expect(payoutWalletFile({ mainnet: WALLET, devnet: "  " })).toEqual({
      payoutWallets: { mainnet: WALLET },
    });
  });

  it("refuses a value that is not a Solana address", () => {
    expect(() => payoutWalletFile({ devnet: "0xabc" })).toThrow(
      PayoutWalletConfigError,
    );
  });

  it("refuses a file with no wallet at all", () => {
    expect(() => payoutWalletFile({})).toThrow("no payout wallet");
  });
});

describe("payoutWalletResponse", () => {
  it("serves the file so the Prydd checkout can read it", async () => {
    const response = payoutWalletResponse({ devnet: WALLET });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({
      payoutWallets: { devnet: WALLET },
    });
  });

  it("lives at the path Prydd reads", () => {
    expect(PAYOUT_WALLET_PATH).toBe("/.well-known/prydd.json");
  });
});
