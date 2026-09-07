import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DbModule } from '../db/db.module';
import {
  APPROVAL_SIGNER_STORE,
  DrizzleApprovalSignerStore,
  type ApprovalSignerStore,
} from './approval-signer.store';
import { TurnkeySdkClient } from './turnkey.client';
import { TURNKEY_API, TurnkeyApi } from './turnkey.interface';
import { TurnkeyService } from './turnkey.service';

@Module({
  imports: [DbModule],
  providers: [
    TurnkeySdkClient,
    { provide: TURNKEY_API, useExisting: TurnkeySdkClient },
    { provide: APPROVAL_SIGNER_STORE, useClass: DrizzleApprovalSignerStore },
    {
      provide: TurnkeyService,
      inject: [TURNKEY_API, ConfigService, APPROVAL_SIGNER_STORE],
      // Read, not required. A missing key fails at enrolment rather than at
      // boot, so a deployment without Turnkey credentials still serves.
      useFactory: (
        api: TurnkeyApi,
        config: ConfigService,
        store: ApprovalSignerStore,
      ) =>
        new TurnkeyService(
          api,
          config.get<string>('TURNKEY_DELEGATED_PUBLIC_KEY') ?? '',
          store,
        ),
    },
  ],
  // The store is exported as well as the service: TransferModule reads the
  // enrolled device keys to check presence proofs, and has no business going
  // through TurnkeyService to do it.
  exports: [TurnkeyService, APPROVAL_SIGNER_STORE],
})
export class TurnkeyModule {}
