import {
  PriorityFeeService,
  PRIORITY_FEE_FLOOR_MICRO_LAMPORTS,
} from "./priority-fee.service";
import type { RelayerConfig } from "../relayer-config";
import type { RelayerRpc } from "../rpc/relayer-rpc";

const cfg = { maxComputeUnitPrice: 1_000_000n } as RelayerConfig;

function makeRpc(estimate: bigint | Error): RelayerRpc {
  return {
    getPriorityFeeEstimate: jest
      .fn()
      .mockImplementation(() =>
        estimate instanceof Error
          ? Promise.reject(estimate)
          : Promise.resolve(estimate),
      ),
  } as unknown as RelayerRpc;
}

describe("PriorityFeeService", () => {
  it("clamps an estimate above the ceiling down to the ceiling", async () => {
    const svc = new PriorityFeeService(cfg, makeRpc(10_000_000_000n));
    const { computeUnitPrice } = await svc.estimate();
    expect(computeUnitPrice).toBe(1_000_000n);
  });

  it("clamps an estimate below the floor up to the floor", async () => {
    const svc = new PriorityFeeService(cfg, makeRpc(10n));
    const { computeUnitPrice } = await svc.estimate();
    expect(computeUnitPrice).toBe(PRIORITY_FEE_FLOOR_MICRO_LAMPORTS);
  });

  it("falls back to the floor when the estimate call fails", async () => {
    const svc = new PriorityFeeService(cfg, makeRpc(new Error("rpc down")));
    const { computeUnitPrice } = await svc.estimate();
    expect(computeUnitPrice).toBe(PRIORITY_FEE_FLOOR_MICRO_LAMPORTS);
  });
});
