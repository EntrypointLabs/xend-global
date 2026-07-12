import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { BalanceMonitorService } from "./balance-monitor.service";
import type { RelayerConfig } from "../relayer-config";
import type { RelayerRpc } from "../rpc/relayer-rpc";
import type { CapsService } from "../caps/caps.service";

const cfg = {
  feePayerAddress: "FEE",
  minFeePayerBalanceLamports: 100_000_000n,
  globalFeeLamportsPerDay: 1_000_000_000n,
} as RelayerConfig;

function makeDeps(balance: bigint, spentToday = 0n) {
  const rpc = {
    getBalanceLamports: jest.fn().mockResolvedValue(balance),
  } as unknown as RelayerRpc;
  const caps = {
    globalFeeLamportsToday: jest.fn().mockReturnValue(spentToday),
  } as unknown as CapsService;
  const config = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;
  return { rpc, caps, config };
}

describe("BalanceMonitorService", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  it("emits a low-balance alert when below the threshold", async () => {
    const { rpc, caps, config } = makeDeps(50_000_000n);
    const svc = new BalanceMonitorService(cfg, rpc, caps, config);
    await svc.check();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("relayer.balance.alert level=low"),
    );
  });

  it("does not emit a balance alert when above the threshold", async () => {
    const { rpc, caps, config } = makeDeps(500_000_000n);
    const svc = new BalanceMonitorService(cfg, rpc, caps, config);
    await svc.check();
    const alerted = warnSpy.mock.calls.some((call) =>
      String(call[0]).includes("relayer.balance.alert"),
    );
    expect(alerted).toBe(false);
  });
});
