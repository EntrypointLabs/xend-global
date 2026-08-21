/**
 * Registers existing Squads vaults on the Helius account-activity webhook.
 *
 * Vault registration runs at Account creation, which does nothing for Accounts
 * that already existed. Their deposits reach the activity feed only when the
 * reconciler replays them, never in real time. This walks squads_accounts and
 * registers each vault once.
 *
 * Idempotent: registerWebhookAddress skips an address the webhook already
 * carries, so a re-run costs one GET per vault and changes nothing. The count
 * reported is therefore "ensured", not "added": the call returns nothing that
 * distinguishes a fresh registration from a skip.
 *
 * Requires HELIUS_WEBHOOK_ID. Without it there is no webhook to add addresses
 * to and every registration fails the same way, which the summary calls out
 * rather than repeating per vault.
 *
 * Usage:
 *   npx ts-node scripts/backfill-vault-webhooks.ts [--dry-run]
 */
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { ConfigModule } from '../src/config/config.module';
import { HeliusAdapter } from '../src/solana/helius.adapter';

/**
 * Deliberately not AppModule: booting the whole app to call one method would
 * also start the Kafka consumers, the crons and the boot replay.
 */
@Module({ imports: [ConfigModule], providers: [HeliusAdapter] })
class BackfillModule {}

interface VaultRow {
  vault_address: string;
  user_id: string;
  smart_account_id: string | null;
}

async function loadVaults(): Promise<VaultRow[]> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    // LEFT JOIN rather than INNER: a vault whose owner has no smart_accounts
    // row is reported instead of silently dropped, since the webhook receiver
    // resolves through that row and could not attribute the delivery anyway.
    const { rows } = await db.query<VaultRow>(
      `SELECT sq.vault_address, sq.user_id, sa.id AS smart_account_id
         FROM squads_accounts sq
         LEFT JOIN smart_accounts sa ON sa.user_id = sq.user_id
        ORDER BY sq.created_at`,
    );
    return rows;
  } finally {
    await db.end();
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  const vaults = await loadVaults();
  if (vaults.length === 0) {
    console.log('No Squads vaults found; nothing to backfill.');
    return;
  }

  const app = await NestFactory.createApplicationContext(BackfillModule, {
    logger: ['error', 'warn'],
  });
  const solana = app.get(HeliusAdapter);

  let ensured = 0;
  let orphaned = 0;
  const failures: { vault: string; reason: string }[] = [];

  try {
    for (const vault of vaults) {
      if (!vault.smart_account_id) {
        orphaned++;
        console.log(
          `SKIP  ${vault.vault_address} (user ${vault.user_id} has no smart_accounts row)`,
        );
        continue;
      }
      if (dryRun) {
        console.log(`WOULD ${vault.vault_address}`);
        continue;
      }
      try {
        await solana.registerWebhookAddress(vault.vault_address);
        ensured++;
        console.log(`OK    ${vault.vault_address}`);
      } catch (err) {
        const reason =
          err instanceof Error ? err.message : JSON.stringify(err ?? null);
        failures.push({ vault: vault.vault_address, reason });
        console.error(`FAIL  ${vault.vault_address}: ${reason}`);
      }
    }
  } finally {
    await app.close();
  }

  console.log(
    `\nvaults=${vaults.length} ensured=${ensured} orphaned=${orphaned} failed=${failures.length}${
      dryRun ? ' (dry run, nothing was changed)' : ''
    }`,
  );

  if (failures.length > 0) {
    if (!process.env.HELIUS_WEBHOOK_ID) {
      console.error(
        '\nHELIUS_WEBHOOK_ID is not set. Create the webhook once (Helius dashboard\n' +
          'or HeliusAdapter.bootstrapWebhook), put the id in the environment, and\n' +
          're-run. Until then no address is watched and the reconciler is the only\n' +
          'path to the activity feed.',
      );
    }
    process.exitCode = 1;
  }
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
