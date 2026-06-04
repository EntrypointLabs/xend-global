import { Module } from '@nestjs/common';
import { FailoverSolanaRpc } from './failover-solana-rpc';
import { HeliusAdapter } from './helius.adapter';
import { PublicMainnetAdapter } from './public-mainnet.adapter';
import { SOLANA_RPC } from './solana-rpc.interface';

/**
 * Exposes the SolanaRpc seam via `SOLANA_RPC`, bound to
 * `FailoverSolanaRpc` (HeliusAdapter primary + PublicMainnetAdapter
 * fallback). Consumers receive the composed wrapper; they never see the
 * individual adapters and cannot accidentally bypass the failover policy.
 */
@Module({
  providers: [
    HeliusAdapter,
    PublicMainnetAdapter,
    FailoverSolanaRpc,
    {
      provide: SOLANA_RPC,
      useExisting: FailoverSolanaRpc,
    },
  ],
  exports: [SOLANA_RPC],
})
export class SolanaModule {}
