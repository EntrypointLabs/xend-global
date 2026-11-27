import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { shutdownPostHogLogs } from './posthog-logger';
import { ServerAnalytics } from './server-analytics.service';

@Global()
@Module({
  providers: [ServerAnalytics],
  exports: [ServerAnalytics],
})
export class AnalyticsModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownPostHogLogs();
  }
}
