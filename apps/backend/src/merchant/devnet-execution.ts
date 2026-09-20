import type { ConfigService } from '@nestjs/config';

/** Test-token execution is never a production KYB approval. */
export function devnetExecutionEnabled(config?: ConfigService): boolean {
  return (
    config?.get('NODE_ENV') === 'development' &&
    config.get('SOLANA_CLUSTER') === 'devnet' &&
    config.get('DEVNET_PAYMENTS_ENABLED') === true
  );
}
