import { Module } from '@nestjs/common';
import { TransferController } from './transfer.controller';
import { TransferService } from './transfer.service';
import { SolanaModule } from '../solana/solana.module';

/**
 * TransferModule — Phase 1 prepare/submit/list endpoints.
 *
 * Mounted at /transfers/* alongside the legacy /transactions/* module
 * (which stays alive until Phase 5). DbModule is @Global so we do not
 * import it explicitly; SolanaModule exports SOLANA_RPC which the
 * service consumes for blockhash + ATA-existence reads + submit.
 *
 * Spec: docs/specs/migration-already-built-features.md §5.4.
 * Plan:  .claude/plans/xend-grid-migration/phases/phase-1-backend-wallet-plumbing/PLAN.md
 */
@Module({
  imports: [SolanaModule],
  controllers: [TransferController],
  providers: [TransferService],
  exports: [TransferService],
})
export class TransferModule {}
