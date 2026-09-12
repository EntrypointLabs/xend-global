import {
  NairaTransfersController,
  NairaTransfersLocalController,
} from './banking/transfers.controller';
import { NairaTransfersService } from './banking/transfers.service';
import { UnifiedLocalController } from './unified/unified-local.controller';
import { UnifiedLocalGuard } from './unified/unified-local.guard';
import { UnifiedFiatWorker } from './unified/unified.worker';
import { UnifiedFiatService } from './unified/unified.service';
import { UnifiedFiatController } from './unified/unified.controller';
import { BankingRegistry } from './banking/banking.registry';
import {
  NairaAccountsController,
  NairaAccountsLocalController,
} from './banking/accounts.controller';
import { NairaAccountsService } from './banking/accounts.service';
import { Module } from '@nestjs/common';
import { SolanaModule } from '../solana/solana.module';
import { ObservedBalancesService } from './balances/observed-balances.service';
import {
  ObservedBalancesController,
  ObservedBalancesLocalController,
} from './balances/observed-balances.controller';
import { FiatController } from './fiat.controller';
import { FiatService } from './fiat.service';
import { FiatProviderRegistry } from './fiat-provider.registry';
import { FIAT_PROVIDERS } from './fiat-provider.interface';
import { FIAT_STORE, PgFiatStore } from './fiat.repository';
import { SimulatorFiatProvider } from './providers/simulator-fiat.provider';
import { FonbnkFiatProvider } from './providers/fonbnk-fiat.provider';

@Module({
  imports: [SolanaModule],
  exports: [BankingRegistry],
  controllers: [
    NairaTransfersController,
    NairaTransfersLocalController,
    ObservedBalancesController,
    ObservedBalancesLocalController,
    FiatController,
    UnifiedFiatController,
    UnifiedLocalController,
    NairaAccountsController,
    NairaAccountsLocalController,
  ],
  providers: [
    NairaTransfersService,
    ObservedBalancesService,
    FiatService,
    UnifiedLocalGuard,
    UnifiedFiatService,
    UnifiedFiatWorker,
    BankingRegistry,
    NairaAccountsService,
    FiatProviderRegistry,
    SimulatorFiatProvider,
    FonbnkFiatProvider,
    { provide: FIAT_STORE, useClass: PgFiatStore },
    {
      provide: FIAT_PROVIDERS,
      inject: [SimulatorFiatProvider, FonbnkFiatProvider],
      useFactory: (
        simulator: SimulatorFiatProvider,
        fonbnk: FonbnkFiatProvider,
      ) => [simulator, fonbnk],
    },
  ],
})
export class FiatModule {}
