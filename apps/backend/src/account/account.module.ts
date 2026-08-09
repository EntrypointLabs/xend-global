import { Module } from '@nestjs/common';

import { AttestationModule } from '../attestation/attestation.module';
import { DbModule } from '../db/db.module';
import { SettlementModule } from '../settlement/settlement.module';
import { TurnkeyModule } from '../turnkey/turnkey.module';
import { AccountController } from './account.controller';
import { Web3AccountChain } from './account-chain.web3';
import { Web3SpendChain } from './spend-chain.web3';
import { SpendService } from './spend.service';
import {
  ACCOUNT_CHAIN,
  SPEND_CHAIN,
  SQUADS_ACCOUNT_STORE,
} from './account.interface';
import { AccountService } from './account.service';
import { DrizzleSquadsAccountStore } from './squads-account.store';

@Module({
  imports: [DbModule, TurnkeyModule, SettlementModule, AttestationModule],
  controllers: [AccountController],
  providers: [
    AccountService,
    SpendService,
    { provide: ACCOUNT_CHAIN, useClass: Web3AccountChain },
    { provide: SPEND_CHAIN, useClass: Web3SpendChain },
    { provide: SQUADS_ACCOUNT_STORE, useClass: DrizzleSquadsAccountStore },
  ],
  exports: [AccountService, SpendService],
})
export class AccountModule {}
