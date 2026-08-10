import { Module } from '@nestjs/common';
import { TransferController } from './transfer.controller';
import { TransferService } from './transfer.service';
import { AccountModule } from '../account/account.module';
import { SolanaModule } from '../solana/solana.module';

/**
 * prepare/submit/list endpoints at /transfers/*. DbModule is @Global so
 * it is not imported explicitly; SolanaModule exports SOLANA_RPC, which
 * the service consumes for blockhash + ATA-existence reads + submit.
 */
@Module({
  imports: [SolanaModule, AccountModule],
  controllers: [TransferController],
  providers: [TransferService],
  exports: [TransferService],
})
export class TransferModule {}
