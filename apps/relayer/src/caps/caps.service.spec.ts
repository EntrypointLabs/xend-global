import { CapsService } from "./caps.service";
import { CapExceededError } from "../cosign/cosign.errors";
import type { RelayerConfig } from "../relayer-config";

function makeCfg(overrides: Partial<RelayerConfig> = {}): RelayerConfig {
  return {
    cluster: "devnet",
    usdcMint: "USDC",
    feePayerAddress: "FEE",
    programAllowlist: [],
    maxComputeUnitPrice: 1_000_000n,
    maxComputeUnits: 400_000,
    maxFeeLamportsPerTx: 50_000n,
    perConsumerPaymentsPerHour: 1000,
    perConsumerFeeLamportsPerDay: 1_000_000_000n,
    perMerchantPaymentsPerHour: 1000,
    globalFeeLamportsPerDay: 1_000_000_000n,
    minFeePayerBalanceLamports: 0n,
    ...overrides,
  };
}

describe("CapsService", () => {
  it("throws on the (N+1)th payment for the per-Consumer payments/hour cap", () => {
    const caps = new CapsService(makeCfg({ perConsumerPaymentsPerHour: 2 }));
    caps.checkAndReserve({ consumerId: "c1", merchantId: "m1" });
    caps.checkAndReserve({ consumerId: "c1", merchantId: "m1" });
    expect(() =>
      caps.checkAndReserve({ consumerId: "c1", merchantId: "m1" }),
    ).toThrow(CapExceededError);
  });

  it("throws on the (N+1)th payment for the per-merchant payments/hour cap", () => {
    const caps = new CapsService(makeCfg({ perMerchantPaymentsPerHour: 2 }));
    caps.checkAndReserve({ consumerId: "a", merchantId: "m1" });
    caps.checkAndReserve({ consumerId: "b", merchantId: "m1" });
    expect(() =>
      caps.checkAndReserve({ consumerId: "c", merchantId: "m1" }),
    ).toThrow(CapExceededError);
  });

  it("throws when the per-Consumer fee-lamports/day cap is reached", () => {
    const caps = new CapsService(
      makeCfg({ perConsumerFeeLamportsPerDay: 1000n }),
    );
    caps.checkAndReserve({ consumerId: "c1", merchantId: "m1" });
    caps.recordSpend({ consumerId: "c1", feeLamports: 1000n });
    expect(() =>
      caps.checkAndReserve({ consumerId: "c1", merchantId: "m1" }),
    ).toThrow(CapExceededError);
  });

  it("throws when the global fee-lamports/day cap is reached", () => {
    const caps = new CapsService(makeCfg({ globalFeeLamportsPerDay: 1000n }));
    caps.recordSpend({ consumerId: "other", feeLamports: 1000n });
    expect(() =>
      caps.checkAndReserve({ consumerId: "fresh", merchantId: "m1" }),
    ).toThrow(CapExceededError);
  });

  it("reports the global fee spent today", () => {
    const caps = new CapsService(makeCfg());
    caps.recordSpend({ consumerId: "c1", feeLamports: 700n });
    caps.recordSpend({ consumerId: "c2", feeLamports: 300n });
    expect(caps.globalFeeLamportsToday()).toBe(1000n);
  });
});
