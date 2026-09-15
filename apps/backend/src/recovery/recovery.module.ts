import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbModule } from '../db/db.module';
import { AccountEventsModule } from '../activity/account-events.module';
import { MailModule } from '../mail/mail.module';
import { AwsKmsClient, KMS_CLIENT } from './kms.client';
import {
  DrizzleRecoveryChallengeStore,
  RECOVERY_CHALLENGE_STORE,
} from './recovery-challenge.store';
import { RecoveryChallengeService } from './recovery-challenge.service';
import {
  DrizzleRecoverySignerStore,
  RECOVERY_SIGNER_STORE,
} from './recovery-signer.store';
import { KmsRecoveryVault } from './recovery-vault.aws-kms';
import { EnvRecoveryVault } from './recovery-vault.env';
import { RECOVERY_VAULT, type RecoveryVault } from './recovery-vault.interface';
import { RecoveryService } from './recovery.service';

export function selectRecoveryVault(
  config: ConfigService,
  env: EnvRecoveryVault,
  kms: KmsRecoveryVault,
): RecoveryVault {
  const provider = config.get<string>('RECOVERY_VAULT_PROVIDER') ?? 'env';
  switch (provider) {
    case 'env':
      return env;
    case 'aws-kms':
      return kms;
    default:
      throw new Error(`unknown RECOVERY_VAULT_PROVIDER: ${provider}`);
  }
}

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
    { provide: KMS_CLIENT, useClass: AwsKmsClient },
    EnvRecoveryVault,
    KmsRecoveryVault,
    {
      provide: RECOVERY_VAULT,
      inject: [ConfigService, EnvRecoveryVault, KmsRecoveryVault],
      useFactory: selectRecoveryVault,
    },
  ],
  exports: [RecoveryService, RecoveryChallengeService],
})
export class RecoveryModule {}
