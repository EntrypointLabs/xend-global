/**
 * What the Capability API says about a Payment before anyone signs anything.
 *
 *   npx ts-node scripts/check-capacity.ts --user <userId> --usdc 5
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { CapacityService } from '../src/capability/capacity.service';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const userId = arg('user');
  if (!userId) throw new Error('--user is required');
  const usdc = Number(arg('usdc') ?? '5');
  const raw = BigInt(Math.round(usdc * 1e6)).toString();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  try {
    const capacity = app.get(CapacityService);
    const snapshot = await capacity.getCapability(userId);
    console.log(`vault    ${snapshot.accountAddress}`);
    console.log(`balance  ${Number(snapshot.balanceRaw) / 1e6} USDC`);
    console.log(
      `tier     ${snapshot.tier} per-payment ${Number(snapshot.limits.perPaymentMaxRaw) / 1e6}`,
    );
    try {
      await capacity.checkCapacity(userId, raw);
      console.log(`\n$${usdc} -> allowed`);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      console.log(`\n$${usdc} -> refused ${e.code}: ${e.message}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
