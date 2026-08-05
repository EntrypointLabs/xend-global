import { Inject, Injectable, Logger } from "@nestjs/common";
import { RELAYER_CONFIG, type RelayerConfig } from "../relayer-config";
import { RelayerRpc } from "../rpc/relayer-rpc";

/** Static floor for the priority fee (micro-lamports per compute unit). */
export const PRIORITY_FEE_FLOOR_MICRO_LAMPORTS = 1000n;

/**
 * Dynamic priority-fee estimation clamped to [floor, ceiling]. The estimate
 * comes from Helius getPriorityFeeEstimate; the hard ceiling is the same
 * cfg.maxComputeUnitPrice the co-sign path enforces (PITFALLS.md 4.3). This
 * is consumed by the Phase 4 build layer via GET /internal/priority-fee. If
 * the estimate call fails, the floor is used so a payment is never blocked
 * on a fee-oracle hiccup.
 */
@Injectable()
export class PriorityFeeService {
  private readonly logger = new Logger("PriorityFee");

  constructor(
    @Inject(RELAYER_CONFIG) private readonly cfg: RelayerConfig,
    private readonly rpc: RelayerRpc,
  ) {}

  async estimate(): Promise<{ computeUnitPrice: bigint }> {
    let raw: bigint;
    try {
      raw = await this.rpc.getPriorityFeeEstimate();
    } catch (err) {
      this.logger.warn(
        `relayer.priority_fee.estimate_failed using floor: ${String(err)}`,
      );
      raw = PRIORITY_FEE_FLOOR_MICRO_LAMPORTS;
    }
    return { computeUnitPrice: this.clamp(raw) };
  }

  private clamp(value: bigint): bigint {
    if (value < PRIORITY_FEE_FLOOR_MICRO_LAMPORTS) {
      return PRIORITY_FEE_FLOOR_MICRO_LAMPORTS;
    }
    if (value > this.cfg.maxComputeUnitPrice) {
      return this.cfg.maxComputeUnitPrice;
    }
    return value;
  }
}
