/**
 * Prints an Account's live spending limit and the route a given amount takes.
 *
 * The one-signature band is whatever the Consumer's own policy says, not the
 * figure an Account is provisioned with: raising it is a settings change, and
 * plenty of Accounts will not be sitting on the default. Read it rather than
 * assume it.
 *
 *   npx ts-node scripts/read-spending-limit.ts --user <userId> [--amount 120]
 */
import { NestFactory } from '@nestjs/core';
import { PublicKey } from '@solana/web3.js';
import {
  deriveAccountAddresses,
  derivePolicyAddress,
  resolveSpendRoute,
} from '@xend/smart-account';
import { AppModule } from '../src/app.module';
import {
  ABOVE_LIMIT_POLICY_SEED,
  SPEND_CHAIN,
  SQUADS_ACCOUNT_STORE,
} from '../src/account/account.interface';
import type {
  SpendChain,
  SquadsAccountStore,
} from '../src/account/account.interface';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const userId = arg('user');
  if (!userId) throw new Error('--user is required');
  const usd = Number(arg('amount') ?? '120');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  try {
    const store = app.get<SquadsAccountStore>(SQUADS_ACCOUNT_STORE);
    const chain = app.get<SpendChain>(SPEND_CHAIN);
    const account = await store.findByUserId(userId);
    if (!account) throw new Error(`no Account for ${userId}`);

    const addresses = deriveAccountAddresses(account.settingsSeed);
    const limits = await chain.readSpendingLimits(account.settingsAddress);
    const mint = process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS as string;

    console.log(`vault           ${addresses.vault.toBase58()}`);
    if (limits.length === 0) {
      console.log('spending limit  none — every Spend takes two signatures');
    }
    for (const limit of limits) {
      console.log(`spending limit  mint=${limit.mint.toBase58()}`);
      console.log(`  max per use   ${Number(limit.maxPerUse) / 1e6}`);
      console.log(
        `  per period    ${Number(limit.maxPerPeriod) / 1e6} (${limit.period})`,
      );
      console.log(`  remaining     ${Number(limit.remainingInPeriod) / 1e6}`);
    }

    const route = resolveSpendRoute(
      {
        mint: new PublicKey(mint),
        amount: BigInt(Math.round(usd * 1e6)),
        destination: addresses.vault,
      },
      limits,
      derivePolicyAddress(addresses.settings, ABOVE_LIMIT_POLICY_SEED),
    );
    console.log(
      `\n$${usd} -> ${route.kind}${route.kind === 'two-signature' ? ` (${route.reason})` : ''}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
