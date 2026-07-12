import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  address,
  createSolanaRpc,
  type Base64EncodedWireTransaction,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";

export interface SimulationResult {
  err: unknown;
  logs: readonly string[] | null;
}

/**
 * Minimal kit RPC client for the relayer. Deliberately a thin concrete
 * class (no Symbol token + interface yet): today there is exactly one
 * internal caller and one RPC vendor (Helius), which is the ADR-0010
 * thin-first-caller posture. Promote it to a full SolanaRpc-style seam
 * (mirror apps/backend/src/solana/solana-rpc.interface.ts) when a second
 * implementation or caller appears.
 *
 * Broadcast goes through Helius (primary). Reads (getBalance) may fall back
 * to the public RPC, a small echo of the backend's failover intent
 * (apps/backend/src/solana/failover-solana-rpc.ts). The Helius URL embeds
 * the API key and is never logged.
 */
@Injectable()
export class RelayerRpc implements OnModuleInit {
  private readonly logger = new Logger("RelayerRpc");
  private primary!: Rpc<SolanaRpcApi>;
  private fallback!: Rpc<SolanaRpcApi>;
  private heliusUrl!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.heliusUrl = this.config.getOrThrow<string>("RELAYER_HELIUS_RPC_URL");
    this.primary = createSolanaRpc(this.heliusUrl);
    this.fallback = createSolanaRpc(
      this.config.getOrThrow<string>("RELAYER_SOLANA_PUBLIC_RPC_URL"),
    );
    // Do not log the Helius URL: it carries the API key.
    this.logger.log("relayer.rpc.ready");
  }

  /** Simulate WITHOUT signature verification (fee payer has not signed yet). */
  async simulateTransaction(wireTxBase64: string): Promise<SimulationResult> {
    const res = await this.primary
      .simulateTransaction(wireTxBase64 as Base64EncodedWireTransaction, {
        encoding: "base64",
        sigVerify: false,
        replaceRecentBlockhash: false,
      })
      .send();
    return { err: res.value.err, logs: res.value.logs };
  }

  /** Broadcast the fully-signed transaction; returns the signature. */
  async sendRawTransaction(wireTxBase64: string): Promise<string> {
    const signature = await this.primary
      .sendTransaction(wireTxBase64 as Base64EncodedWireTransaction, {
        encoding: "base64",
      })
      .send();
    return signature;
  }

  /** Fee-payer SOL balance in lamports. Reads fall back to the public RPC. */
  async getBalanceLamports(addr: string): Promise<bigint> {
    try {
      const res = await this.primary.getBalance(address(addr)).send();
      return res.value;
    } catch (primaryErr) {
      this.logger.warn(
        `relayer.rpc.getBalance primary failed, trying fallback: ${String(primaryErr)}`,
      );
      const res = await this.fallback.getBalance(address(addr)).send();
      return res.value;
    }
  }

  /**
   * Dynamic priority-fee estimate (micro-lamports per compute unit) via the
   * Helius getPriorityFeeEstimate RPC method, which is not part of the kit
   * typed API, so it is issued as a raw JSON-RPC call to the same endpoint.
   * The caller (PriorityFeeService) clamps the result to [floor, ceiling].
   */
  async getPriorityFeeEstimate(): Promise<bigint> {
    const res = await fetch(this.heliusUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "relayer-priority-fee",
        method: "getPriorityFeeEstimate",
        params: [{ options: { recommended: true } }],
      }),
    });
    if (!res.ok) {
      throw new Error(`getPriorityFeeEstimate HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      result?: { priorityFeeEstimate?: number };
      error?: unknown;
    };
    if (json.error || json.result?.priorityFeeEstimate == null) {
      throw new Error("getPriorityFeeEstimate returned no estimate");
    }
    return BigInt(Math.ceil(json.result.priorityFeeEstimate));
  }
}
