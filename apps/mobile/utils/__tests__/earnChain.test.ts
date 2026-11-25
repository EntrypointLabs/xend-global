import { PublicKey } from "@solana/web3.js";
import {
  EARN_PROVIDERS,
  readEarnExchangeRate,
  TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  EARN_USDC,
} from "@prydd/smart-account";
import { fetchEarnFromChain } from "@/utils/earnChain";
import { getSolanaConnection } from "@/utils/chainReads";
jest.mock("@/utils/chainReads", () => ({ getSolanaConnection: jest.fn() }));
jest.mock("@prydd/smart-account", () => ({
  ...jest.requireActual("@prydd/smart-account"),
  readEarnExchangeRate: jest.fn(),
}));
const vault = new PublicKey("7i4dwLUBPuNsetEqvfoNgpfgaiJa7X1adBAZZNG7can7");
function token(mint: PublicKey, amount: bigint) {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data);
  vault.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  return { owner: TOKEN_PROGRAM_ID, data };
}
function setup() {
  const rpc = {
    getTokenAccountsByOwner: jest.fn().mockResolvedValue({ value: [] }),
    getAccountInfo: jest.fn().mockResolvedValue(token(EARN_USDC, 10_006_000n)),
  };
  jest
    .mocked(getSolanaConnection)
    .mockReturnValue(rpc as unknown as ReturnType<typeof getSolanaConnection>);
  jest
    .mocked(readEarnExchangeRate)
    .mockResolvedValue({ numerator: 2n, denominator: 1n });
  return rpc;
}
beforeEach(() => jest.clearAllMocks());
it("establishes zero from complete receipt scans without market reads during an outage", async () => {
  const rpc = setup();
  const result = await fetchEarnFromChain(vault.toBase58());
  expect(rpc.getTokenAccountsByOwner).toHaveBeenCalledTimes(2);
  expect(result.products.map((p) => p.positionMinor)).toEqual(["0", "0"]);
  expect(
    result.products.every((p) => !p.available && !p.withdrawAvailable)
  ).toBe(true);
  expect(result.depositableMinor).toBe("10006000");
  expect(result.lifetimeMinor).toBeNull();
  expect(readEarnExchangeRate).not.toHaveBeenCalled();
});
it("values canonical and external receipts with live rates while keeping actions disabled", async () => {
  const rpc = setup(),
    mint = new PublicKey(EARN_PROVIDERS.kamino.receipt);
  rpc.getTokenAccountsByOwner.mockResolvedValueOnce({
    value: [
      {
        pubkey: associatedTokenAddress(vault, mint, TOKEN_PROGRAM_ID),
        account: token(mint, 1_000_000n),
      },
      { pubkey: PublicKey.default, account: token(mint, 2_000_000n) },
    ],
  });
  const result = await fetchEarnFromChain(vault.toBase58());
  expect(result.products[0]).toMatchObject({
    positionMinor: "6000000",
    withdrawableMinor: "2000000",
    available: false,
    withdrawAvailable: false,
  });
});
it("preserves unknown when a receipt scan or a held receipt price fails", async () => {
  const rpc = setup();
  rpc.getTokenAccountsByOwner.mockRejectedValueOnce(
    new Error("RPC unavailable")
  );
  await expect(fetchEarnFromChain(vault.toBase58())).rejects.toThrow(
    "RPC unavailable"
  );
  const mint = new PublicKey(EARN_PROVIDERS.kamino.receipt);
  rpc.getTokenAccountsByOwner.mockResolvedValueOnce({
    value: [{ pubkey: PublicKey.default, account: token(mint, 1n) }],
  });
  jest
    .mocked(readEarnExchangeRate)
    .mockRejectedValueOnce(new Error("Reserve unavailable"));
  await expect(fetchEarnFromChain(vault.toBase58())).rejects.toThrow(
    "Reserve unavailable"
  );
});
