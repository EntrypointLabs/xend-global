import { Module } from '@nestjs/common';

import { DbModule } from '../db/db.module';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  ACCOUNT_EVENT_STORE,
  DrizzleAccountEventStore,
} from './account-event.store';
import { AccountEventsService } from './account-events.service';

/**
 * Depends on the database and the channels a notice goes out on, nothing else.
 *
 * Deliberately a leaf: recovery, account and anything else that records an
 * event imports this, so it can never import them back.
 */
@Module({
  imports: [DbModule, NotificationsModule],
  providers: [
    AccountEventsService,
    { provide: ACCOUNT_EVENT_STORE, useClass: DrizzleAccountEventStore },
  ],
  exports: [AccountEventsService],
})
export class AccountEventsModule {}
