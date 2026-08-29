import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { AccountEventsModule } from '../activity/account-events.module';
import { MailModule } from '../mail/mail.module';
import {
  DrizzleRecoveryChallengeStore,
  RECOVERY_CHALLENGE_STORE,
} from './recovery-challenge.store';
import { RecoveryChallengeService } from './recovery-challenge.service';
import {
  DrizzleRecoverySignerStore,
  RECOVERY_SIGNER_STORE,
} from './recovery-signer.store';
import { EnvRecoveryVault } from './recovery-vault.env';
import { RECOVERY_VAULT } from './recovery-vault.interface';
import { RecoveryService } from './recovery.service';

@Module({
  imports: [DbModule, AccountEventsModule, MailModule],
  providers: [
    RecoveryService,
    RecoveryChallengeService,
    {
      provide: RECOVERY_CHALLENGE_STORE,
      useClass: DrizzleRecoveryChallengeStore,
    },
    { provide: RECOVERY_SIGNER_STORE, useClass: DrizzleRecoverySignerStore },
    { provide: RECOVERY_VAULT, useClass: EnvRecoveryVault },
  ],
  exports: [RecoveryService, RecoveryChallengeService],
})
export class RecoveryModule {}
