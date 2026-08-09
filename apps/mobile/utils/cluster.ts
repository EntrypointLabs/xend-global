export type SolanaCluster = "mainnet" | "devnet";

const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const DEFAULT_RPC: Record<SolanaCluster, string> = {
  mainnet: "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
};

/**
 * Which Solana network this build talks to.
 *
 * **Defaults to mainnet on purpose.** Every value here used to fall back to
 * devnet, so a production build with an unset variable pointed at a test network
 * while looking completely normal. A Consumer deposited real USDC on mainnet, the
 * app was watching devnet, and the balance never appeared. Failing safe means
 * defaulting to the network where the money actually is; a developer who wants
 * devnet has to ask for it.
 */
export const CLUSTER: SolanaCluster =
  process.env.EXPO_PUBLIC_SOLANA_CLUSTER === "devnet" ? "devnet" : "mainnet";

export const IS_MAINNET = CLUSTER === "mainnet";

export const SOLANA_RPC_URL =
  process.env.EXPO_PUBLIC_SOLANA_RPC_URL ?? DEFAULT_RPC[CLUSTER];

/**
 * The USDC mint for this cluster.
 *
 * A function rather than a constant because several modules (and the tests)
 * vary `EXPO_PUBLIC_USDC_MINT_ADDRESS` at runtime. Everything that needs the
 * mint calls this, so there is exactly one answer: a build where one module
 * thought USDC was the devnet mint and another thought it was the mainnet one
 * showed the Consumer's spending balance as an investment.
 *
 * An explicit override wins, but a mint belonging to the other network is
 * rejected rather than honoured, since that is the misconfiguration that hid a
 * real deposit.
 */
export function getUsdcMint(): string {
  const configured = process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS;
  const expected = IS_MAINNET ? MAINNET_USDC : DEVNET_USDC;

  if (!configured) return expected;

  const wrongNetwork =
    (IS_MAINNET && configured === DEVNET_USDC) ||
    (!IS_MAINNET && configured === MAINNET_USDC);
  if (wrongNetwork) {
    console.error(
      `[cluster] EXPO_PUBLIC_USDC_MINT_ADDRESS is the ${
        IS_MAINNET ? "devnet" : "mainnet"
      } USDC mint but this build targets ${CLUSTER}. Deposits will not appear. Using the ${CLUSTER} mint instead.`
    );
    return expected;
  }
  return configured;
}
