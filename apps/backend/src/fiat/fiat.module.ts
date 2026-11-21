import {
  NairaTransfersController,
  NairaTransfersLocalController,
} from './banking/transfers.controller';
import { NairaTransfersService } from './banking/transfers.service';
import {
  BankRecipientsController,
  BankRecipientsLocalController,
} from './banking/recipients.controller';
import { BankRecipientsService } from './banking/recipients.service';
import { BankNotificationInbox } from './banking/notification-inbox';
import { BankNotificationRequeryService } from './banking/notification-requery.service';
import { NombaWebhookController } from './banking/nomba-webhook.controller';
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
import { PajFiatProvider } from './providers/paj-fiat.provider';
import { PaycrestClient } from './providers/paycrest/paycrest.client';
import { PaycrestFiatProvider } from './providers/paycrest/paycrest-fiat.provider';
import { PayoutBanksService } from './providers/paycrest/payout-banks.service';
import { FiatVerificationService } from './verification/verification.service';
import { FiatWebhookController } from './fiat-webhook.controller';
import { PajModule } from '../settlement/providers/paj/paj.module';

@Module({
  imports: [SolanaModule, PajModule],
  exports: [BankingRegistry],
  controllers: [
    NombaWebhookController,
    NairaTransfersController,
    NairaTransfersLocalController,
    BankRecipientsController,
    BankRecipientsLocalController,
    ObservedBalancesController,
    ObservedBalancesLocalController,
    FiatController,
    FiatWebhookController,
    UnifiedFiatController,
    UnifiedLocalController,
    NairaAccountsController,
    NairaAccountsLocalController,
  ],
  providers: [
    BankNotificationRequeryService,
    BankNotificationInbox,
    NairaTransfersService,
    BankRecipientsService,
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
    PajFiatProvider,
    PaycrestClient,
    PaycrestFiatProvider,
    PayoutBanksService,
    FiatVerificationService,
    { provide: FIAT_STORE, useClass: PgFiatStore },
    {
      provide: FIAT_PROVIDERS,
      inject: [
        SimulatorFiatProvider,
        FonbnkFiatProvider,
        PajFiatProvider,
        PaycrestFiatProvider,
      ],
      useFactory: (
        simulator: SimulatorFiatProvider,
        fonbnk: FonbnkFiatProvider,
        paj: PajFiatProvider,
        paycrest: PaycrestFiatProvider,
      ) => [simulator, fonbnk, paj, paycrest],
    },
  ],
})
export class FiatModule {}
