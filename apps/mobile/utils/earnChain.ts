import { PublicKey } from "@solana/web3.js";
import {
  associatedTokenAddress,
  EARN_PROVIDERS,
  EARN_USDC,
  earnAsset,
  earnAssetsFor,
  readEarnExchangeRate,
  sharesValue,
  TOKEN_PROGRAM_ID,
  type EarnAssetId,
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
    },
    tokenProgram: PublicKey = TOKEN_PROGRAM_ID
  ) => {
    if (
      !account.owner.equals(tokenProgram) ||
      account.data.length < 165 ||
      !new PublicKey(account.data.subarray(0, 32)).equals(mint) ||
      !new PublicKey(account.data.subarray(32, 64)).equals(vault)
    )
      throw new Error("Unable to read Earn balance");
    return account.data.readBigUInt64LE(64);
  };
  const readAsset = async (id: EarnProvider, assetId: EarnAssetId) => {
    const asset = earnAsset(id, assetId);
    const accounts = await rpc.getTokenAccountsByOwner(vault, {
      mint: asset.receipt,
    });
    const canonical = associatedTokenAddress(
      vault,
      asset.receipt,
      asset.tokenProgram
    );
    let shares = 0n,
      withdrawable = 0n;
    for (const entry of accounts.value) {
      const amount = balance(asset.receipt, entry.account, asset.tokenProgram);
      shares += amount;
      if (entry.pubkey.equals(canonical)) withdrawable += amount;
    }
    // A complete successful scan establishes zero without relying on the
    // provider's reserve. Held receipts still require a readable live price.
    const price =
      shares > 0n ? await readEarnExchangeRate(rpc, id, assetId) : null;
    const value = price ? sharesValue(shares, price) : 0n;
    const dollars = asset.mint.equals(EARN_USDC);
    return {
      shares: shares.toString(),
      mint: asset.mint.toBase58(),
      symbol: asset.symbol,
      name: asset.name,
      iconUrl: null,
      decimals: asset.decimals,
      apy: null,
      positionRaw: value.toString(),
      // Only USDC has a dollar value without the price service.
      positionUsd:
        dollars || value === 0n ? (Number(value) / 1e6).toFixed(6) : null,
      withdrawableRaw: price
        ? sharesValue(withdrawable, price).toString()
        : "0",
      lifetimeEarnedRaw: null,
      lastSevenDaysEarnedRaw: null,
      lifetimeEarnedUsd: null,
      lastSevenDaysEarnedUsd: null,
      depositableRaw: "0",
      available: false,
      withdrawAvailable: false,
    };
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
      // Every token the product lends, so a holding in one the backend
      // would have priced is never read as an empty position.
      const assets = await Promise.all(
        earnAssetsFor(id).map((assetId) => readAsset(id, assetId))
      );
      const usdc = assets.find((a) => a.mint === EARN_USDC.toBase58())!;
      return {
        id,
        provider: provider.name,
        name: "Lending Yield",
        apy: null,
        positionShares: usdc.shares,
        positionMinor: usdc.positionRaw,
        withdrawableMinor: usdc.withdrawableRaw,
        available: false,
        withdrawAvailable: false,
        updatedAt: new Date().toISOString(),
        assets: assets.map(({ shares: _shares, ...row }) => row),
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
