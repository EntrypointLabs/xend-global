import { Inject, Injectable } from "@nestjs/common";
import { RELAYER_CONFIG, type RelayerConfig } from "../relayer-config";
import { CapExceededError } from "../cosign/cosign.errors";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface FeeEntry {
  ts: number;
  lamports: bigint;
}

/**
 * In-memory sliding-window abuse caps (single-instance pilot). These are
 * defense-in-depth: the primary domain caps live in the Identity and
 * Capability API (Phase 2); the relayer enforces its own from day one per
 * REQ-ANTI-DRAIN. When the relayer scales past one instance, these move to
 * Redis (the ADR 0012 / ARCHITECTURE.md 1.4 re-introduction trigger).
 */
@Injectable()
export class CapsService {
  private readonly consumerPayments = new Map<string, number[]>();
  private readonly merchantPayments = new Map<string, number[]>();
  private readonly consumerFees = new Map<string, FeeEntry[]>();
  private globalFees: FeeEntry[] = [];

  constructor(@Inject(RELAYER_CONFIG) private readonly cfg: RelayerConfig) {}

  /**
   * Reject if the next payment would exceed a cap, otherwise reserve a
   * payment slot for the consumer and merchant. Reserving on check (not on
   * broadcast) closes the window where concurrent requests both pass.
   */
  checkAndReserve(params: { consumerId: string; merchantId: string }): void {
    const now = Date.now();
    const consumerCount = this.prunedCount(
      this.consumerPayments,
      params.consumerId,
      now,
      HOUR_MS,
    );
    if (consumerCount + 1 > this.cfg.perConsumerPaymentsPerHour) {
      throw new CapExceededError("per-consumer payments/hour cap exceeded");
    }
    const merchantCount = this.prunedCount(
      this.merchantPayments,
      params.merchantId,
      now,
      HOUR_MS,
    );
    if (merchantCount + 1 > this.cfg.perMerchantPaymentsPerHour) {
      throw new CapExceededError("per-merchant payments/hour cap exceeded");
    }
    if (
      this.consumerFeesToday(params.consumerId, now) >=
      this.cfg.perConsumerFeeLamportsPerDay
    ) {
      throw new CapExceededError("per-consumer fee-lamports/day cap exceeded");
    }
    if (this.globalFeesToday(now) >= this.cfg.globalFeeLamportsPerDay) {
      throw new CapExceededError("global fee-lamports/day cap exceeded");
    }

    this.consumerPayments.get(params.consumerId)!.push(now);
    this.merchantPayments.get(params.merchantId)!.push(now);
  }

  /** Record actual fee spend after a successful broadcast. */
  recordSpend(params: { consumerId: string; feeLamports: bigint }): void {
    const now = Date.now();
    const entry = { ts: now, lamports: params.feeLamports };
    const list = this.consumerFees.get(params.consumerId) ?? [];
    list.push(entry);
    this.consumerFees.set(params.consumerId, list);
    this.globalFees.push(entry);
  }

  /** Total global fee spend in the last 24h (drives the spend-slope alert). */
  globalFeeLamportsToday(): bigint {
    return this.globalFeesToday(Date.now());
  }

  private prunedCount(
    map: Map<string, number[]>,
    key: string,
    now: number,
    windowMs: number,
  ): number {
    const cutoff = now - windowMs;
    const pruned = (map.get(key) ?? []).filter((ts) => ts > cutoff);
    map.set(key, pruned);
    return pruned.length;
  }

  private consumerFeesToday(consumerId: string, now: number): bigint {
    const cutoff = now - DAY_MS;
    const pruned = (this.consumerFees.get(consumerId) ?? []).filter(
      (e) => e.ts > cutoff,
    );
    this.consumerFees.set(consumerId, pruned);
    return pruned.reduce((sum, e) => sum + e.lamports, 0n);
  }

  private globalFeesToday(now: number): bigint {
    const cutoff = now - DAY_MS;
    this.globalFees = this.globalFees.filter((e) => e.ts > cutoff);
    return this.globalFees.reduce((sum, e) => sum + e.lamports, 0n);
  }
}
