import type { ConfigService } from "@nestjs/config";

/**
 * The single typed abuse-control surface for the relayer.
 *
 * Every field maps one-to-one onto a Kora config knob, which is the
 * insurance recorded in docs/specs/relayer-kora-adopt-vs-build.md: if the
 * operator ever adopts Kora, the static fields move into Kora's TOML and
 * only the pinned-message / expected-destination / domain-caps shim stays
 * in NestJS. The object is assembled once at boot from validated env plus
 * the fee-payer address derived from the signer.
 *
 *   RelayerConfig field            -> Kora config knob
 *   programAllowlist               -> program allowlist
 *   usdcMint                       -> token / mint restriction
 *   maxFeeLamportsPerTx            -> max_allowed_lamports fee cap
 *   maxComputeUnitPrice and Units  -> fee-payer policy compute ceilings
 *   per-Consumer and per-merchant  -> per-account rate limits
 *     payment counts
 *   fee-lamports-per-day fields    -> per-account and global spend caps
 *   feePayerAddress (never a       -> fee-payer policy
 *     writable non-fee account)
 *   minFeePayerBalanceLamports     -> operational alert threshold
 */
export interface RelayerConfig {
  cluster: "devnet" | "mainnet";
  /** Cluster-scoped USDC mint; the only mint the relayer will co-sign. */
  usdcMint: string;
  /** Fee-payer public key, derived from the signer at boot. */
  feePayerAddress: string;
  /** Programs the co-sign path accepts: ComputeBudget, Token, ATA. */
  programAllowlist: string[];
  /** micro-lamports per compute unit hard ceiling. */
  maxComputeUnitPrice: bigint;
  /** Compute-unit limit hard ceiling. */
  maxComputeUnits: number;
  /** Total transaction fee hard ceiling in lamports. */
  maxFeeLamportsPerTx: bigint;
  perConsumerPaymentsPerHour: number;
  perConsumerFeeLamportsPerDay: bigint;
  perMerchantPaymentsPerHour: number;
  /** Drives the spend-slope alert in the balance monitor. */
  globalFeeLamportsPerDay: bigint;
  /** Drives the fee-payer SOL balance alert. */
  minFeePayerBalanceLamports: bigint;
}

/** DI token for the assembled, immutable RelayerConfig. */
export const RELAYER_CONFIG = Symbol("RelayerConfig");

/** SPL Token program. */
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
/** Associated Token program. */
export const ASSOCIATED_TOKEN_PROGRAM =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
/** ComputeBudget program. */
export const COMPUTE_BUDGET_PROGRAM =
  "ComputeBudget111111111111111111111111111111";

/**
 * Assemble the RelayerConfig from validated env plus the fee-payer address.
 * Pure: no I/O, no DI. The System program is deliberately absent from the
 * allowlist (see tx-validation.ts for why a System transfer is the drain
 * vector this relayer refuses on the payment hot path).
 */
export function buildRelayerConfig(
  config: ConfigService,
  feePayerAddress: string,
): RelayerConfig {
  return {
    cluster: config.getOrThrow<"devnet" | "mainnet">("SOLANA_CLUSTER"),
    usdcMint: config.getOrThrow<string>("USDC_MINT"),
    feePayerAddress,
    programAllowlist: [
      COMPUTE_BUDGET_PROGRAM,
      TOKEN_PROGRAM,
      ASSOCIATED_TOKEN_PROGRAM,
    ],
    maxComputeUnitPrice: BigInt(
      config.getOrThrow<string>("RELAYER_MAX_COMPUTE_UNIT_PRICE"),
    ),
    maxComputeUnits: Number(
      config.getOrThrow<string>("RELAYER_MAX_COMPUTE_UNITS"),
    ),
    maxFeeLamportsPerTx: BigInt(
      config.getOrThrow<string>("RELAYER_MAX_FEE_LAMPORTS_PER_TX"),
    ),
    perConsumerPaymentsPerHour: Number(
      config.getOrThrow<string>("RELAYER_PER_CONSUMER_PAYMENTS_PER_HOUR"),
    ),
    perConsumerFeeLamportsPerDay: BigInt(
      config.getOrThrow<string>("RELAYER_PER_CONSUMER_FEE_LAMPORTS_PER_DAY"),
    ),
    perMerchantPaymentsPerHour: Number(
      config.getOrThrow<string>("RELAYER_PER_MERCHANT_PAYMENTS_PER_HOUR"),
    ),
    globalFeeLamportsPerDay: BigInt(
      config.getOrThrow<string>("RELAYER_GLOBAL_FEE_LAMPORTS_PER_DAY"),
    ),
    minFeePayerBalanceLamports: BigInt(
      config.getOrThrow<string>("RELAYER_MIN_SOL_BALANCE_LAMPORTS"),
    ),
  };
}
