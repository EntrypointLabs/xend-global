import { Global, Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { ConsumerAuthGuard } from './consumer-auth.guard';
import { EntrySessionService } from './entry-session.service';
import {
  DrizzleEntrySessionStore,
  ENTRY_SESSION_STORE,
} from './entry-session.store';

/**
 * Global because the guard is applied by every module with a Consumer route,
 * and a guard's dependencies are resolved from the module the controller
 * lives in. Listing this in each of them would make forgetting one a boot
 * failure, which is a worse way to find out than not having to remember.
 */
@Global()
@Module({
  imports: [DbModule],
  providers: [
    EntrySessionService,
    ConsumerAuthGuard,
    { provide: ENTRY_SESSION_STORE, useClass: DrizzleEntrySessionStore },
  ],
  exports: [EntrySessionService, ConsumerAuthGuard],
})
export class EntrySessionModule {}
