import { TurnkeyModule } from '../turnkey/turnkey.module';
import { EARN_RECORDS, DrizzleEarnRecords } from './earn-records';
import { DbModule } from '../db/db.module';
import { Module } from '@nestjs/common';
import { SpendModule } from '../account/spend.module';
import { SettlementAuthorityModule } from '../settlement/settlement-authority.module';
import { Web3SwapChain } from '../swap/swap-chain.web3';
import { EarnController } from './earn.controller';
import { EarnService } from './earn.service';
@Module({
  imports: [SpendModule, SettlementAuthorityModule, TurnkeyModule, DbModule],
  controllers: [EarnController],
  providers: [
    EarnService,
    Web3SwapChain,
    { provide: EARN_RECORDS, useClass: DrizzleEarnRecords },
  ],
})
export class EarnModule {}
