/**
 * Enough environment for the whole module graph to compile under test.
 *
 * Nothing here is reached: compile() resolves providers without running
 * onModuleInit, so no client dials out. The values only have to satisfy the
 * config validation that runs as soon as `app.module` is loaded, which is why
 * the module is required after these are set rather than imported.
 */
export const APP_MODULE_TEST_ENV: Record<string, string> = {
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

export function applyAppModuleTestEnv(): void {
  for (const [key, value] of Object.entries(APP_MODULE_TEST_ENV)) {
    process.env[key] ??= value;
  }
}
