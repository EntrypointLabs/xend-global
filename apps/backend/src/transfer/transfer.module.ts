import { Module } from '@nestjs/common';
import { TransferController } from './transfer.controller';
import { TransferService } from './transfer.service';
import { AccountModule } from '../account/account.module';
import { SolanaModule } from '../solana/solana.module';
import { TokensModule } from '../tokens/tokens.module';
import { AccountEventsModule } from '../activity/account-events.module';
import { ActivityModule } from '../activity/activity.module';
import { TurnkeyModule } from '../turnkey/turnkey.module';
import { PreparedModule } from '../prepared/prepared.module';

/**
 * prepare/submit/list endpoints at /transfers/*. DbModule is @Global so
 * it is not imported explicitly; SolanaModule exports SOLANA_RPC, which
 * the service consumes for blockhash + ATA-existence reads + submit.
 */
@Module({
  // TokensModule names the mints on a page of activity. TurnkeyModule carries
  // the enrolled device keys a Spend's presence proof is checked against.
  // ActivityModule's reconciler is armed by a submit and caught up by a list.
  imports: [
    SolanaModule,
    AccountModule,
    TokensModule,
    AccountEventsModule,
    ActivityModule,
    TurnkeyModule,
    PreparedModule,
  ],
  controllers: [TransferController],
  providers: [TransferService],
  exports: [TransferService],
})
export class TransferModule {}
