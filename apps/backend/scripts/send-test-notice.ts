/**
 * Sends one real notification to a Consumer's registered devices.
 *
 * For checking a delivery path is alive, which otherwise means reading
 * somebody's notification shade and guessing. Goes through the real service,
 * so the device lookup, the payload the app routes on, and the provider are
 * all the ones production uses.
 *
 *   npx ts-node scripts/send-test-notice.ts --user <userId>
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { NotificationsService } from '../src/notifications/notifications.service';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const userId = arg('user');
  if (!userId) throw new Error('--user is required');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    await app.get(NotificationsService).notifyPaymentNeedsApproval(userId, {
      merchantName: arg('merchant') ?? 'Sabi Market',
      amount: arg('amount') ?? '₦200,000',
    });
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
