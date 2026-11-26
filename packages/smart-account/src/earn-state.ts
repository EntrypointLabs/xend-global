import { PublicKey, type Connection } from "@solana/web3.js";
import {
  EARN_PROVIDERS,
  EARN_USDC,
  earnAsset,
  type EarnAssetId,
  type EarnProviderId,
} from "./earn.js";

export interface EarnExchangeRate {
  numerator: bigint;
  denominator: bigint;
}
const key = (bytes: Uint8Array, offset: number) =>
  new PublicKey(bytes.slice(offset, offset + 32));
function integer(bytes: Uint8Array, offset: number, length: number): bigint {
  if (offset + length > bytes.length) throw new Error("Truncated Earn state");
  let n = 0n;
  for (let i = length - 1; i >= 0; i--)
    n = (n << 8n) | BigInt(bytes[offset + i]!);
  return n;
}
/** Recorded chain price, deliberately excluding optimistic interest forecasts. */
export function decodeEarnExchangeRate(
  provider: EarnProviderId,
  data: Uint8Array,
  asset: EarnAssetId = "USDC",
): EarnExchangeRate {
  const p = EARN_PROVIDERS[provider];
  const a = earnAsset(provider, asset);
  const expected =
    provider === "kamino"
      ? [43, 242, 204, 202, 26, 247, 59, 127]
      : [135, 199, 82, 16, 249, 131, 182, 241];
  if (data.length < 8 || expected.some((v, i) => data[i] !== v))
    throw new Error("Unexpected lending state discriminator");
  let numerator: bigint, denominator: bigint;
  if (provider === "kamino") {
    if (
      !key(data, 32).equals(
        new PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"),
      ) ||
      !key(data, 128).equals(EARN_USDC) ||
      !key(data, 2560).equals(new PublicKey(p.receipt))
    )
      throw new Error("Kamino market does not match");
    const l = 128;
    const sf = 1n << 60n;
    numerator =
      integer(data, l + 96, 8) * sf +
      integer(data, l + 104, 16) -
      integer(data, l + 216, 16) -
      integer(data, l + 232, 16) -
      integer(data, l + 248, 16);
    denominator = integer(data, 2592, 8) * sf;
  } else {
    if (!key(data, 8).equals(a.mint) || !key(data, 40).equals(a.receipt))
      throw new Error("Jupiter market does not match");
    numerator = integer(data, 115, 8);
    denominator = 1_000_000_000_000n;
  }
  if (numerator <= 0n || denominator <= 0n)
    throw new Error("Earn exchange rate unavailable");
  return { numerator, denominator };
}
export async function readEarnExchangeRate(
  connection: Connection,
  provider: EarnProviderId,
  asset: EarnAssetId = "USDC",
): Promise<EarnExchangeRate> {
  const p = EARN_PROVIDERS[provider];
  const info = await connection.getAccountInfo(
    earnAsset(provider, asset).reserve,
    "confirmed",
  );
  if (!info || !info.owner.equals(new PublicKey(p.program)))
    throw new Error("Lending account owner mismatch");
  return decodeEarnExchangeRate(provider, info.data, asset);
}
export function sharesValue(shares: bigint, price: EarnExchangeRate): bigint {
  return (shares * price.numerator) / price.denominator;
}
export function sharesForValue(value: bigint, price: EarnExchangeRate): bigint {
  return (value * price.denominator + price.numerator - 1n) / price.numerator;
}
export function depositShares(value: bigint, price: EarnExchangeRate): bigint {
  return (value * price.denominator) / price.numerator;
}
