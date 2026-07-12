import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { EventsModule } from '../events/events.module';
import { CountersModule } from '../counters/counters.module';
import { SESSION_STORE } from './session-store.interface';
import { RedisSessionStore } from './redis-session-store';
import { SessionService } from './session.service';
import { SessionController } from './session.controller';

/**
 * Merchant-scoped Sessions. RATE_COUNTER comes from the shared CountersModule,
 * NOT from the capability engine, so this module never imports it and the
 * module graph stays acyclic with no forwardRef.
 */
@Module({
  imports: [RedisModule, EventsModule, CountersModule],
  providers: [
    RedisSessionStore,
    { provide: SESSION_STORE, useExisting: RedisSessionStore },
    SessionService,
  ],
  controllers: [SessionController],
  exports: [SessionService],
})
export class SessionModule {}
