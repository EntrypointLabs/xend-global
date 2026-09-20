/**
 * Provisions a Merchant's settlement endpoint: the stage of onboarding that
 * gives them somewhere to be paid into.
 *
 * Manual pilot onboarding. Requires the Merchant's verified receiving wallet.
 * The authority pays rent to initialize the Merchant-owned USDC token account;
 * it does not acquire ownership. This command can spend SOL, so run only once
 * the intended Merchant, network and receiving wallet have been verified.
 *
 * Usage:
 *   npx ts-node scripts/provision-settlement.ts --merchant-id m_123 --merchant-address PUBLIC_KEY
 *
 * Idempotent for the same destination; conflicting existing destinations fail.
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
  const merchantAddress = arg('merchant-address');
  if (currency !== 'USDC' || !merchantAddress) {
    throw new Error(
      'The USDC pilot requires --merchant-address and currency USDC',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const provisioning = app.get(SettlementProvisioningService);
    const result = await provisioning.provisionOrLink(merchantId, {
      currency,
      merchantAddress,
    });
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
