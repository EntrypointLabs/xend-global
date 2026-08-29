import { Test } from '@nestjs/testing';
import { REDIS_CLIENT } from './redis/redis.constants';

// A missing module import is invisible to tsc and to every spec that hand-lists
// its own providers, so the graph is only ever exercised at boot. Compiling it
// here turns that into a test failure. compile() resolves every provider without
// running onModuleInit, so nothing reaches Postgres or Kafka.
const ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/xend_test',
  JWT_SECRET: 'test-jwt-secret',
  PRIVY_APP_ID: 'test-privy-app-id',
  PRIVY_APP_SECRET: 'test-privy-app-secret',
  // Present so the graph resolves a real mailer. Absent, MailModule refuses to
  // build rather than fall back to logging recovery codes, which is what it is
  // supposed to do everywhere that is not development.
  RESEND_API_KEY: 'test-resend-key',
  HELIUS_API_KEY: 'test-helius-key',
  HELIUS_RPC_URL: 'https://devnet.helius-rpc.com',
  HELIUS_WEBHOOK_SECRET: 'test-helius-webhook-secret',
  EXPO_PUBLIC_USDC_MINT_ADDRESS: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  REDIS_URL: 'redis://localhost:6379',
  KAFKA_BROKERS: 'localhost:9092',
  SETTLEMENT_AUTHORITY_SECRET_KEY: 'test-settlement-authority-secret-key',
  RELAYER_URL: 'http://localhost:8009',
  RELAYER_INTERNAL_AUTH_SECRET: 'test-relayer-auth-secret',
  RELAYER_FEE_PAYER_ADDRESS: 'FeePayer11111111111111111111111111111111111',
  INTERNAL_API_SECRET: 'test-internal-api-secret',
  CHECKOUT_RETURN_URL_SECRET: 'test-checkout-return-url-secret',
};

describe('AppModule', () => {
  it('resolves every provider in the dependency graph', async () => {
    for (const [key, value] of Object.entries(ENV)) {
      process.env[key] ??= value;
    }

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
