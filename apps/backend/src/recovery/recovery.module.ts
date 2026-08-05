import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import {
  DrizzleRecoverySignerStore,
  RECOVERY_SIGNER_STORE,
} from './recovery-signer.store';
import { EnvRecoveryVault } from './recovery-vault.env';
import { RECOVERY_VAULT } from './recovery-vault.interface';
import { RecoveryService } from './recovery.service';

@Module({
  imports: [DbModule],
  providers: [
    RecoveryService,
    { provide: RECOVERY_SIGNER_STORE, useClass: DrizzleRecoverySignerStore },
    { provide: RECOVERY_VAULT, useClass: EnvRecoveryVault },
  ],
  exports: [RecoveryService],
})
export class RecoveryModule {}
