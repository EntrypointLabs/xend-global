import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TurnkeySdkClient } from './turnkey.client';
import { TURNKEY_API, TurnkeyApi } from './turnkey.interface';
import { TurnkeyService } from './turnkey.service';

@Module({
  providers: [
    TurnkeySdkClient,
    { provide: TURNKEY_API, useExisting: TurnkeySdkClient },
    {
      provide: TurnkeyService,
      inject: [TURNKEY_API, ConfigService],
      // Read, not required. A missing key fails at enrolment rather than at
      // boot, so a deployment without Turnkey credentials still serves.
      useFactory: (api: TurnkeyApi, config: ConfigService) =>
        new TurnkeyService(
          api,
          config.get<string>('TURNKEY_DELEGATED_PUBLIC_KEY') ?? '',
        ),
    },
  ],
  exports: [TurnkeyService],
})
export class TurnkeyModule {}
