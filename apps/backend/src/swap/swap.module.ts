import { Module } from '@nestjs/common';

import { SpendModule } from '../account/spend.module';
import { SettlementAuthorityModule } from '../settlement/settlement-authority.module';
import { JupiterSwapAdapter } from './jupiter-swap.adapter';
import { JupiterSwapTokensAdapter } from './jupiter-swap-tokens.adapter';
import { Web3SwapChain } from './swap-chain.web3';
import { SwapController } from './swap.controller';
import { DrizzleSwapRecords } from './swap-records.drizzle';
import { SWAP_CHAIN, SWAP_PROVIDER, SWAP_RECORDS } from './swap.interface';
import { SwapService } from './swap.service';
import { SWAP_TOKEN_DIRECTORY } from './swap-tokens.interface';

@Module({
  imports: [SpendModule, SettlementAuthorityModule],
  controllers: [SwapController],
  providers: [
    SwapService,
    { provide: SWAP_PROVIDER, useClass: JupiterSwapAdapter },
    { provide: SWAP_CHAIN, useClass: Web3SwapChain },
    { provide: SWAP_RECORDS, useClass: DrizzleSwapRecords },
    { provide: SWAP_TOKEN_DIRECTORY, useClass: JupiterSwapTokensAdapter },
  ],
})
export class SwapModule {}
