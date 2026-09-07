import type { ConfigService } from "@nestjs/config";
import {
  buildRelayerConfig,
  ClusterMintMismatchError,
  USDC_MINT_BY_CLUSTER,
} from "./relayer-config";

const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function env(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    SOLANA_CLUSTER: "devnet",
    USDC_MINT: DEVNET_USDC,
    RELAYER_MAX_COMPUTE_UNIT_PRICE: "1000000",
    RELAYER_MAX_COMPUTE_UNITS: "400000",
    RELAYER_MAX_FEE_LAMPORTS_PER_TX: "50000",
    RELAYER_PER_CONSUMER_PAYMENTS_PER_HOUR: "20",
    RELAYER_PER_CONSUMER_FEE_LAMPORTS_PER_DAY: "2000000",
    RELAYER_PER_MERCHANT_PAYMENTS_PER_HOUR: "500",
    RELAYER_GLOBAL_FEE_LAMPORTS_PER_DAY: "200000000",
    RELAYER_MIN_SOL_BALANCE_LAMPORTS: "100000000",
    ...overrides,
  };
  return {
    getOrThrow: (key: string) => {
      if (!(key in values)) throw new Error(`missing ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;
}

describe("buildRelayerConfig", () => {
  it("pins the well-known mints per cluster", () => {
    expect(USDC_MINT_BY_CLUSTER).toEqual({
      devnet: DEVNET_USDC,
      mainnet: MAINNET_USDC,
    });
  });

  it("boots devnet with the devnet USDC mint", () => {
    const cfg = buildRelayerConfig(env(), "FEE");
    expect(cfg.cluster).toBe("devnet");
    expect(cfg.usdcMint).toBe(DEVNET_USDC);
    expect(cfg.feePayerAddress).toBe("FEE");
  });

  it("boots mainnet with the mainnet USDC mint", () => {
    const cfg = buildRelayerConfig(
      env({ SOLANA_CLUSTER: "mainnet", USDC_MINT: MAINNET_USDC }),
      "FEE",
    );
    expect(cfg.usdcMint).toBe(MAINNET_USDC);
  });

  it("refuses to boot mainnet with the devnet mint", () => {
    expect(() =>
      buildRelayerConfig(
        env({ SOLANA_CLUSTER: "mainnet", USDC_MINT: DEVNET_USDC }),
        "FEE",
      ),
    ).toThrow(ClusterMintMismatchError);
  });

  it("refuses to boot devnet with the mainnet mint", () => {
    expect(() =>
      buildRelayerConfig(env({ USDC_MINT: MAINNET_USDC }), "FEE"),
    ).toThrow(/not USDC on devnet/);
  });

  it("refuses a mint that is USDC nowhere", () => {
    expect(() =>
      buildRelayerConfig(
        env({ USDC_MINT: "So11111111111111111111111111111111111111112" }),
        "FEE",
      ),
    ).toThrow(ClusterMintMismatchError);
  });
});
