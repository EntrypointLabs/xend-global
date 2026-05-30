import { Module } from '@nestjs/common';
import { FailoverSolanaRpc } from './failover-solana-rpc';
import { HeliusAdapter } from './helius.adapter';
import { PublicMainnetAdapter } from './public-mainnet.adapter';
import { SOLANA_RPC } from './solana-rpc.interface';

/**
 * SolanaModule — exposes the SolanaRpc seam via `SOLANA_RPC`.
 *
 * The binding is `FailoverSolanaRpc`, which composes HeliusAdapter
 * (primary) and PublicMainnetAdapter (fallback). Consumers receive the
 * composed wrapper; they never see the individual adapters and cannot
 * accidentally bypass the failover policy.
 *
 * In Phase 0 every adapter throws on every method; nothing consumes
 * `SOLANA_RPC` yet, so DI registration is the entire point of this module
 * today.
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
