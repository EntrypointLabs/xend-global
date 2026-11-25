import { PublicKey } from "@solana/web3.js";
import {
  associatedTokenAddress,
  EARN_PROVIDERS,
  EARN_USDC,
  readEarnExchangeRate,
  sharesValue,
  TOKEN_PROGRAM_ID,
} from "@prydd/smart-account";
import { getSolanaConnection } from "@/utils/chainReads";
import { EarnCatalogSchema, type EarnProvider } from "@/utils/earn";
import { IS_MAINNET } from "@/utils/cluster";

/** Public valuation only. Backend outages never enable a money action. */
export async function fetchEarnFromChain(owner: string) {
  const vault = new PublicKey(owner);
  const rpc = getSolanaConnection();
  const balance = (
    mint: PublicKey,
    account: {
      owner: PublicKey;
      data: Buffer;
    }
  ) => {
    if (
      !account.owner.equals(TOKEN_PROGRAM_ID) ||
      account.data.length !== 165 ||
      !new PublicKey(account.data.subarray(0, 32)).equals(mint) ||
      !new PublicKey(account.data.subarray(32, 64)).equals(vault)
    )
      throw new Error("Unable to read Earn balance");
    return account.data.readBigUInt64LE(64);
  };
  const products = await Promise.all(
    (Object.keys(EARN_PROVIDERS) as EarnProvider[]).map(async (id) => {
      const provider = EARN_PROVIDERS[id];
      if (!IS_MAINNET)
        return {
          id,
          provider: provider.name,
          name: "Lending Yield",
          apy: null,
          positionShares: "0",
          positionMinor: "0",
          withdrawableMinor: "0",
          available: false,
          withdrawAvailable: false,
          updatedAt: new Date().toISOString(),
        };
      const mint = new PublicKey(provider.receipt);
      const accounts = await rpc.getTokenAccountsByOwner(vault, { mint });
      const canonical = associatedTokenAddress(vault, mint, TOKEN_PROGRAM_ID);
      let shares = 0n,
        withdrawable = 0n;
      for (const entry of accounts.value) {
        const amount = balance(mint, entry.account);
        shares += amount;
        if (entry.pubkey.equals(canonical)) withdrawable += amount;
      }
      // A complete successful scan establishes zero without relying on the
      // provider's reserve. Held receipts still require a readable live price.
      const price = shares > 0n ? await readEarnExchangeRate(rpc, id) : null;
      return {
        id,
        provider: provider.name,
        name: "Lending Yield",
        apy: null,
        positionShares: shares.toString(),
        positionMinor: price ? sharesValue(shares, price).toString() : "0",
        withdrawableMinor: price
          ? sharesValue(withdrawable, price).toString()
          : "0",
        available: false,
        withdrawAvailable: false,
        updatedAt: new Date().toISOString(),
      };
    })
  );
  const cash = IS_MAINNET
    ? await rpc.getAccountInfo(
        associatedTokenAddress(vault, EARN_USDC, TOKEN_PROGRAM_ID)
      )
    : null;
  return EarnCatalogSchema.parse({
    products,
    depositableMinor: cash ? balance(EARN_USDC, cash).toString() : "0",
    lifetimeMinor: null,
    lastSevenDaysMinor: null,
  });
}
