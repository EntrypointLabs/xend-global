import { ConfigService } from '@nestjs/config';

/**
 * Settlement runtime configuration, assembled once at boot from validated
 * env (see config.module.ts). The authority address is derived from the
 * settlement authority signer rather than read from env, so it can never
 * drift from the key that actually owns the pilot settlement accounts.
 */
export interface SettlementConfig {
  cluster: 'devnet' | 'mainnet';
  /** Cluster-scoped USDC mint (EXPO_PUBLIC_USDC_MINT_ADDRESS). */
  usdcMint: string;
  /** Direct-USDC endpoint owner + pilot attribution root (the authority pubkey). */
  authorityAddress: string;
  /** Base URL of the Phase 3 relayer deployable. */
  relayerUrl: string;
  /** The relayer fee payer (transaction payerKey). */
  relayerFeePayerAddress: string;
  /** Active-poll cadence on the confirmation hot path. */
  confirmPollIntervalMs: number;
  /** Active-poll ceiling before handing off to the 30s sweep. */
  confirmBudgetMs: number;
}

function requireNonEmpty(config: ConfigService, key: string): string {
  const value = config.getOrThrow<string>(key);
  if (!value) {
    throw new Error(`${key} must be non-empty`);
  }
  return value;
}

/**
 * Load the settlement config from env. `authorityAddress` is supplied by
 * the caller (derived from the settlement authority signer at boot) so it
 * stays coupled to the signing key, not a separately-configured string.
 */
export function loadSettlementConfig(
  config: ConfigService,
  authorityAddress: string,
): SettlementConfig {
  if (!authorityAddress) {
    throw new Error('settlement authority address must be non-empty');
  }
  return {
    cluster: requireNonEmpty(config, 'SOLANA_CLUSTER') as 'devnet' | 'mainnet',
    usdcMint: requireNonEmpty(config, 'EXPO_PUBLIC_USDC_MINT_ADDRESS'),
    authorityAddress,
    relayerUrl: requireNonEmpty(config, 'RELAYER_URL'),
    relayerFeePayerAddress: requireNonEmpty(
      config,
      'RELAYER_FEE_PAYER_ADDRESS',
    ),
    confirmPollIntervalMs: config.getOrThrow<number>(
      'SETTLEMENT_CONFIRM_POLL_INTERVAL_MS',
    ),
    confirmBudgetMs: config.getOrThrow<number>('SETTLEMENT_CONFIRM_BUDGET_MS'),
  };
}
