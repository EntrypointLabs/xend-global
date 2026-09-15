import { Module, OnApplicationShutdown } from '@nestjs/common';
import { shutdownTracing } from './otel';

/** Flushes and closes the tracing SDK when the app shuts down. Startup is in main.ts, before Nest loads. */
@Module({})
export class TracingModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownTracing();
  }
}
