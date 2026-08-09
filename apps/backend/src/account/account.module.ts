import { Module } from '@nestjs/common';

import { DbModule } from '../db/db.module';
import { SettlementModule } from '../settlement/settlement.module';
import { TurnkeyModule } from '../turnkey/turnkey.module';
import { Web3AccountChain } from './account-chain.web3';
import { ACCOUNT_CHAIN, SQUADS_ACCOUNT_STORE } from './account.interface';
import { AccountService } from './account.service';
import { DrizzleSquadsAccountStore } from './squads-account.store';

@Module({
  imports: [DbModule, TurnkeyModule, SettlementModule],
  providers: [
    AccountService,
    { provide: ACCOUNT_CHAIN, useClass: Web3AccountChain },
    { provide: SQUADS_ACCOUNT_STORE, useClass: DrizzleSquadsAccountStore },
  ],
  exports: [AccountService],
})
export class AccountModule {}
