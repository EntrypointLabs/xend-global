import { Module } from '@nestjs/common';
import { FiatController } from './fiat.controller';
import { FiatService } from './fiat.service';
import { FiatProviderRegistry } from './fiat-provider.registry';
import { FIAT_PROVIDERS } from './fiat-provider.interface';
import { FIAT_STORE, PgFiatStore } from './fiat.repository';
import { SimulatorFiatProvider } from './providers/simulator-fiat.provider';
import { FonbnkFiatProvider } from './providers/fonbnk-fiat.provider';

@Module({
  controllers: [FiatController],
  providers: [
    FiatService,
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
