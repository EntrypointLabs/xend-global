import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { MetricsAuthGuard } from './metrics-auth.guard';
import { metricsRegistry } from './metrics';

/** Prometheus scrape target. Exempt from throttling so a scrape interval never trips the limit. */
@Controller('metrics')
@SkipThrottle()
@UseGuards(MetricsAuthGuard)
export class MetricsController {
  @Get()
  @Header('Content-Type', metricsRegistry.contentType)
  scrape(): Promise<string> {
    return metricsRegistry.metrics();
  }
}
