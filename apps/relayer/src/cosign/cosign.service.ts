import { Inject, Injectable, Logger } from "@nestjs/common";
import { RELAYER_CONFIG, type RelayerConfig } from "../relayer-config";
import {
  FEE_PAYER_SIGNER,
  type FeePayerSigner,
} from "../signer/signer.interface";
import { RelayerRpc } from "../rpc/relayer-rpc";
import { CapsService } from "../caps/caps.service";
import { BroadcastFailedError, SimulationFailedError } from "./cosign.errors";
import { validateSettlementTransaction } from "./tx-validation";
import type { CosignRequest, CosignResponse } from "./dtos";

/** Bounded in-memory replay guard capacity. */
const REPLAY_GUARD_MAX = 10_000;

/**
 * Orchestrates a co-sign: replay guard -> caps -> validate -> simulate ->
 * sign LAST -> broadcast -> record. The relayer signs only after validating
 * the fully-assembled bytes and a clean simulation, so nothing can be
 * appended after its checks (ARCHITECTURE.md 5.2).
 */
@Injectable()
export class CosignService {
  private readonly logger = new Logger("Cosign");

  /**
   * Relayer-side defense-in-depth ONLY: a bounded LRU of intentId ->
   * broadcast signature. A repeated intentId short-circuits and returns the
   * recorded signature without re-validating, re-signing, or re-broadcasting
   * (mirrors the submit idempotency posture at transfer.service.ts:293-308).
   * The AUTHORITATIVE per-intent single-live-attempt guard and ambiguous-
   * retry resolution are Phase 4's payment_attempts partial unique index and
   * attempt registry, which also supplies expectedMessageBase64.
   */
  private readonly replayGuard = new Map<string, string>();

  constructor(
    @Inject(RELAYER_CONFIG) private readonly cfg: RelayerConfig,
    @Inject(FEE_PAYER_SIGNER) private readonly signer: FeePayerSigner,
    private readonly rpc: RelayerRpc,
    private readonly caps: CapsService,
  ) {}

  async cosign(
    req: CosignRequest,
    correlationId: string,
  ): Promise<CosignResponse> {
    const replayed = this.replayGuard.get(req.intentId);
    if (replayed) {
      this.logOutcome(correlationId, req, {
        outcome: "replayed",
        signature: replayed,
      });
      return { signature: replayed, status: "BROADCAST", correlationId };
    }

    try {
      this.caps.checkAndReserve({
        consumerId: req.consumerId,
        merchantId: req.merchantId,
      });

      const validated = validateSettlementTransaction(
        req.transactionBase64,
        this.cfg,
        {
          settlementAccount: req.expectedSettlementAccount,
          messageBase64: req.expectedMessageBase64,
        },
      );

      // Simulate BEFORE signing. Any simulation error rejects with no sign
      // and no broadcast.
      let sim: { err: unknown };
      try {
        sim = await this.rpc.simulateTransaction(req.transactionBase64);
      } catch (err) {
        throw new SimulationFailedError(
          `simulation RPC failed: ${String(err)}`,
        );
      }
      if (sim.err) {
        throw new SimulationFailedError(
          `simulation returned an error: ${JSON.stringify(sim.err)}`,
        );
      }

      // Fee payer partial-signs LAST, then broadcast.
      const signed = await this.signer.signTransaction(req.transactionBase64);
      let signature: string;
      try {
        signature = await this.rpc.sendRawTransaction(signed);
      } catch (err) {
        throw new BroadcastFailedError(`broadcast RPC failed: ${String(err)}`);
      }

      this.caps.recordSpend({
        consumerId: req.consumerId,
        feeLamports: validated.estimatedFeeLamports,
      });
      this.remember(req.intentId, signature);

      this.logOutcome(correlationId, req, {
        outcome: "broadcast",
        signature,
        computePrice: validated.computeUnitPrice,
      });
      return { signature, status: "BROADCAST", correlationId };
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : "UNKNOWN";
      this.logOutcome(correlationId, req, {
        outcome: "rejected",
        reason: code,
      });
      throw err;
    }
  }

  private remember(intentId: string, signature: string): void {
    if (this.replayGuard.size >= REPLAY_GUARD_MAX) {
      const oldest = this.replayGuard.keys().next().value;
      if (oldest !== undefined) this.replayGuard.delete(oldest);
    }
    this.replayGuard.set(intentId, signature);
  }

  private logOutcome(
    correlationId: string,
    req: CosignRequest,
    extra: {
      outcome: "broadcast" | "rejected" | "replayed";
      signature?: string;
      reason?: string;
      computePrice?: bigint;
    },
  ): void {
    const parts = [
      `relayer.cosign correlation_id=${correlationId}`,
      `intent_id=${req.intentId}`,
      `consumer_id=${req.consumerId}`,
      `merchant_id=${req.merchantId}`,
    ];
    if (extra.signature) parts.push(`signature=${extra.signature}`);
    if (extra.computePrice !== undefined) {
      parts.push(`compute_price=${extra.computePrice}`);
    }
    if (extra.reason) parts.push(`reason=${extra.reason}`);
    parts.push(`outcome=${extra.outcome}`);
    this.logger.log(parts.join(" "));
  }
}
