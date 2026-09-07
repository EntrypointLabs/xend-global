import { Test } from '@nestjs/testing';
import { REDIS_CLIENT } from './redis/redis.constants';
import { applyAppModuleTestEnv } from './app.module.test-env';

// A missing module import is invisible to tsc and to every spec that hand-lists
// its own providers, so the graph is only ever exercised at boot. Compiling it
// here turns that into a test failure. compile() resolves every provider without
// running onModuleInit, so nothing reaches Postgres or Kafka.
describe('AppModule', () => {
  it('resolves every provider in the dependency graph', async () => {
    applyAppModuleTestEnv();

    // Loaded after the env is set: ConfigModule validates during forRoot(),
    // which runs as soon as this module is loaded.
    const { AppModule } =
      jest.requireActual<typeof import('./app.module')>('./app.module');

    // ioredis dials on construction, unlike the Postgres and Kafka clients.
    // Not closed afterwards: no client ever opened, and the shutdown hooks
    // assume an onModuleInit that compile() deliberately skips.
    await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS_CLIENT)
      .useValue({ quit: jest.fn().mockResolvedValue('OK') })
      .compile();
  });
});
