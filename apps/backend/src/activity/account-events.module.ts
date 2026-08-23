import { Module } from '@nestjs/common';

import { DbModule } from '../db/db.module';
import {
  ACCOUNT_EVENT_STORE,
  DrizzleAccountEventStore,
} from './account-event.store';
import { AccountEventsService } from './account-events.service';

/**
 * Depends on the database and nothing else.
 *
 * Deliberately a leaf: recovery, account and anything else that records an
 * event imports this, so it can never import them back.
 */
@Module({
  imports: [DbModule],
  providers: [
    AccountEventsService,
    { provide: ACCOUNT_EVENT_STORE, useClass: DrizzleAccountEventStore },
  ],
  exports: [AccountEventsService],
})
export class AccountEventsModule {}
