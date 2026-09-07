import { Module } from '@nestjs/common';

import { DbModule } from '../db/db.module';
import { SettlementAuthorityModule } from '../settlement/settlement-authority.module';
import { SPEND_CHAIN, SQUADS_ACCOUNT_STORE } from './account.interface';
import { Web3SpendChain } from './spend-chain.web3';
import { SpendService } from './spend.service';
import { DrizzleSquadsAccountStore } from './squads-account.store';

/**
 * The Spend path, separated from the rest of the Account so settlement can
 * reach it.
 *
 * A Payment to a Merchant and a Send to a person are the same movement out of
 * the same vault, decided by the same policies. They were built as two paths
 * because Checkout predates the Account, and one of them silently kept drawing
 * on the Privy wallet after the money moved. Sharing this module is what stops
 * that happening twice.
 */
@Module({
  imports: [DbModule, SettlementAuthorityModule],
  providers: [
    SpendService,
    { provide: SPEND_CHAIN, useClass: Web3SpendChain },
    { provide: SQUADS_ACCOUNT_STORE, useClass: DrizzleSquadsAccountStore },
  ],
  exports: [SpendService, SPEND_CHAIN, SQUADS_ACCOUNT_STORE],
})
export class SpendModule {}
