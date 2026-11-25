/// <reference types="jest" />
import { receivedBySwap, type BalanceChanges } from "@/utils/swapOutcome";

const VAULT = "Vault1111111111111111111111111111111111111";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

const token = (
  mint: string,
  owner: string,
  amount: string,
  accountIndex = 2
) => ({
  accountIndex,
  mint,
  owner,
  uiTokenAmount: { amount },
});

const changes = (partial: Partial<BalanceChanges>): BalanceChanges => ({
  accountKeys: ["FeePayer", VAULT],
  preBalances: [5_000_000, 15_000_000],
  postBalances: [5_000_000, 15_000_000],
  preTokenBalances: [],
  postTokenBalances: [],
  ...partial,
});

describe("receivedBySwap", () => {
  it("reads a token that lands in an account the vault keeps", () => {
    expect(
      receivedBySwap(
        changes({
          preTokenBalances: [
            token(JUP, VAULT, "1000"),
            token(JUP, "other", "9"),
          ],
          postTokenBalances: [
            token(JUP, VAULT, "4000"),
            token(JUP, "other", "1"),
          ],
        }),
        VAULT,
        JUP
      )
    ).toBe("3000");
  });

  it("reads SOL left as plain SOL by a wrapped account opened and closed in the swap", () => {
    expect(
      receivedBySwap(
        changes({ postBalances: [5_000_000, 21_342_817] }),
        VAULT,
        SOL
      )
    ).toBe("6342817");
  });

  it("reads SOL that lands in a wrapped account the vault keeps", () => {
    expect(
      receivedBySwap(
        changes({
          preTokenBalances: [token(SOL, VAULT, "0")],
          postTokenBalances: [token(SOL, VAULT, "6342817")],
        }),
        VAULT,
        SOL
      )
    ).toBe("6342817");
  });

  it("does not count the rent of a wrapped account the swap closed", () => {
    // The vault held a wrapped SOL account with 0.001 SOL in it. The swap
    // closed it, so its tokens, its 0.00203928 SOL of rent and the 0.0063
    // SOL bought all land in the vault as plain SOL.
    const rent = 2_039_280;
    expect(
      receivedBySwap(
        {
          accountKeys: ["FeePayer", VAULT, "VaultWsol"],
          preBalances: [5_000_000, 15_000_000, rent + 1_000_000],
          postBalances: [
            5_000_000,
            15_000_000 + 1_000_000 + rent + 6_342_817,
            0,
          ],
          preTokenBalances: [token(SOL, VAULT, "1000000", 2)],
          postTokenBalances: [],
        },
        VAULT,
        SOL
      )
    ).toBe("6342817");
  });

  it("says nothing rather than a wrong figure when nothing arrived", () => {
    expect(
      receivedBySwap(
        changes({
          preTokenBalances: [token(USDC, VAULT, "5000000")],
          postTokenBalances: [token(USDC, VAULT, "4000000")],
        }),
        VAULT,
        USDC
      )
    ).toBeNull();
  });
});
