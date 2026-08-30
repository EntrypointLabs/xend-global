import { Module } from '@nestjs/common';

import { AccountEventsModule } from '../activity/account-events.module';
import { AttestationModule } from '../attestation/attestation.module';
import { DbModule } from '../db/db.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RecoveryModule } from '../recovery/recovery.module';
import { SettlementModule } from '../settlement/settlement.module';
import { SolanaModule } from '../solana/solana.module';
import { TurnkeyModule } from '../turnkey/turnkey.module';
import { AccountController } from './account.controller';
import { AccountChangeService } from './account-change.service';
import { DeviceRotationService } from './device-rotation.service';
import { AccountChangeWatcher } from './account-change.watcher';
import { Web3AccountChain } from './account-chain.web3';
import { Web3ProvisioningChain } from './provisioning-chain.web3';
import { ProvisioningService } from './provisioning.service';
import { RecoveryChangeService } from './recovery-change.service';
import { SpendModule } from './spend.module';
import { SpendingLimitService } from './spending-limit.service';
import { SweepService } from './sweep.service';
import { ACCOUNT_CHAIN, PROVISIONING_CHAIN } from './account.interface';
import { AccountService } from './account.service';

@Module({
  imports: [
    DbModule,
    TurnkeyModule,
    SettlementModule,
    AttestationModule,
    SolanaModule,
    RecoveryModule,
    NotificationsModule,
    AccountEventsModule,
    SpendModule,
  ],
  controllers: [AccountController],
  providers: [
    AccountService,
    SpendingLimitService,
    SweepService,
    ProvisioningService,
    AccountChangeService,
    AccountChangeWatcher,
    RecoveryChangeService,
    DeviceRotationService,
    { provide: ACCOUNT_CHAIN, useClass: Web3AccountChain },
    { provide: PROVISIONING_CHAIN, useClass: Web3ProvisioningChain },
  ],
  exports: [
    AccountService,
    SpendModule,
    SpendingLimitService,
    SweepService,
    ProvisioningService,
    AccountChangeService,
    RecoveryChangeService,
    DeviceRotationService,
  ],
})
export class AccountModule {}
