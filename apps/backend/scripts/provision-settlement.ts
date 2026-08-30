/**
 * Provisions a Merchant's settlement endpoint: the stage of onboarding that
 * gives them somewhere to be paid into.
 *
 * Manual, like the rest of merchant onboarding, and separate from key issuance
 * because it moves lamports: the direct-USDC provider creates a per-Merchant
 * token account owned by the settlement authority, and the authority pays its
 * rent. Nothing else calls it, so a Merchant with keys and no endpoint takes
 * payments right up to the moment one has to settle.
 *
 * Usage:
 *   npx ts-node scripts/provision-settlement.ts --merchant-id m_123
 *   npx ts-node scripts/provision-settlement.ts --merchant-id m_123 --currency NGN
 *
 * Idempotent: an already-provisioned endpoint is returned unchanged.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SettlementProvisioningService } from '../src/settlement/settlement-provisioning.service';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const merchantId = arg('merchant-id');
  if (!merchantId) {
    throw new Error('--merchant-id is required');
  }
  const currency = arg('currency') ?? 'USDC';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const provisioning = app.get(SettlementProvisioningService);
    const result = await provisioning.provisionOrLink(merchantId, { currency });
    console.log(
      `merchant=${merchantId} provider=${result.provider} address=${result.address} newly_provisioned=${result.provisioned}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
