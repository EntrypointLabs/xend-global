import { Module, OnModuleInit } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { MetricsAuthGuard } from './metrics-auth.guard';
import { MetricsController } from './metrics.controller';
import { startDefaultMetrics } from './metrics';

/**
 * Prometheus exposition. Domain counters are plain module exports in
 * metrics.ts so a service increments one with an import rather than a
 * constructor dependency; this module owns the scrape route, the request
 * duration interceptor and the default Node collectors.
 */
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsAuthGuard,
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
})
export class MetricsModule implements OnModuleInit {
  onModuleInit(): void {
    startDefaultMetrics();
  }
}
