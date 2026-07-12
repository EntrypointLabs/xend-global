import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RelayerCosignError } from './settlement.errors';

/** The /internal/cosign request body (Phase 3 CosignRequestSchema). */
export interface CosignRequest {
  intentId: string;
  consumerId: string;
  merchantId: string;
  transactionBase64: string;
  expectedSettlementAccount: string;
  expectedMessageBase64?: string;
}

/**
 * Thin client for the Phase 3 fee-payer relayer deployable. The relayer
 * validates and co-signs (never builds the tx). Every internal call carries
 * the shared secret on X-Relayer-Auth and the intent id on X-Correlation-Id,
 * and never follows redirects.
 */
@Injectable()
export class RelayerClient implements OnModuleInit {
  private readonly logger = new Logger(RelayerClient.name);
  private baseUrl!: string;
  private authSecret!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.baseUrl = this.config.getOrThrow<string>('RELAYER_URL');
    this.authSecret = this.config.getOrThrow<string>(
      'RELAYER_INTERNAL_AUTH_SECRET',
    );
  }

  private headers(correlationId: string): Record<string, string> {
    return {
      'X-Relayer-Auth': this.authSecret,
      'X-Correlation-Id': correlationId,
    };
  }

  /**
   * GET /internal/priority-fee. Wire contract of record (supersedes the
   * loose Phase 3 TypeScript sketch): computeUnitPrice crosses the wire as a
   * DECIMAL STRING because JSON cannot carry a bigint. Validated against
   * /^\d+$/ and parsed with BigInt(); anything non-numeric is a
   * RELAYER_COSIGN_FAILED.
   */
  async getPriorityFee(
    correlationId: string,
  ): Promise<{ computeUnitPrice: bigint }> {
    const res = await fetch(`${this.baseUrl}/internal/priority-fee`, {
      method: 'GET',
      headers: this.headers(correlationId),
      redirect: 'manual',
    });
    if (!res.ok) {
      throw new RelayerCosignError(
        `relayer priority-fee failed: ${res.status}`,
      );
    }
    const body = (await res.json()) as { computeUnitPrice?: unknown };
    const raw = body.computeUnitPrice;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
      throw new RelayerCosignError(
        `relayer priority-fee returned a non-numeric computeUnitPrice: ${String(raw)}`,
      );
    }
    return { computeUnitPrice: BigInt(raw) };
  }

  /**
   * POST /internal/cosign. The relayer validates the allowlist / fee-payer /
   * expectedSettlementAccount / expectedMessageBase64 and co-signs +
   * broadcasts. Non-2xx surfaces the relayer's own error code (429 preserves
   * the cap-exceeded code) rather than swallowing it.
   */
  async cosign(
    req: CosignRequest,
    correlationId: string,
  ): Promise<{ signature: string }> {
    const res = await fetch(`${this.baseUrl}/internal/cosign`, {
      method: 'POST',
      headers: {
        ...this.headers(correlationId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
      redirect: 'manual',
    });
    if (!res.ok) {
      let relayerCode: string | undefined;
      try {
        const err = (await res.json()) as { code?: string };
        relayerCode = err.code;
      } catch {
        relayerCode = undefined;
      }
      throw new RelayerCosignError(
        `relayer cosign failed: ${res.status}${relayerCode ? ` (${relayerCode})` : ''}`,
        relayerCode,
      );
    }
    const body = (await res.json()) as { signature: string };
    return { signature: body.signature };
  }

  /** GET /health. Used by the phase checkpoint to verify the fee payer. */
  async health(): Promise<{ feePayer: string }> {
    const res = await fetch(`${this.baseUrl}/health`, {
      method: 'GET',
      headers: this.headers('health'),
      redirect: 'manual',
    });
    if (!res.ok) {
      throw new RelayerCosignError(`relayer health failed: ${res.status}`);
    }
    const body = (await res.json()) as { feePayer: string };
    return { feePayer: body.feePayer };
  }
}
