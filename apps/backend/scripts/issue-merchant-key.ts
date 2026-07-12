/**
 * Merchant onboarding at automation level zero (no UI). This IS the four-stage
 * onboarding model executed by hand: it creates/updates a Merchant profile,
 * stamps KYB after off-system checks, and issues test/live API keys through the
 * SAME gate the KeyIssuanceService uses (assertLiveKeyEligible), so the manual
 * pilot and the future merchants.xend.global portal can never drift.
 *
 * Usage:
 *   npx ts-node scripts/issue-merchant-key.ts --name "Acme" --display "Acme Store" --mode test
 *   npx ts-node scripts/issue-merchant-key.ts --merchant-id m_123 --mode live
 *   npx ts-node scripts/issue-merchant-key.ts --mark-kyb-verified m_123
 *
 * The raw key is printed to stdout exactly once. It is not recoverable; only
 * its SHA-256 hash and a display fingerprint are stored.
 */
import { Client } from 'pg';
import { createId } from '@paralleldrive/cuid2';
import { generateApiKey } from '../src/merchant/api-key.util';
import { assertLiveKeyEligible } from '../src/merchant/key-issuance.service';

interface Args {
  name?: string;
  display?: string;
  mode: 'test' | 'live';
  merchantId?: string;
  markKybVerified?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: 'test' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = () => argv[++i];
    switch (flag) {
      case '--name':
        args.name = next();
        break;
      case '--display':
        args.display = next();
        break;
      case '--mode': {
        const value = next();
        if (value !== 'test' && value !== 'live') {
          throw new Error('--mode must be test or live');
        }
        args.mode = value;
        break;
      }
      case '--merchant-id':
        args.merchantId = next();
        break;
      case '--mark-kyb-verified':
        args.markKybVerified = next();
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const client = new Client({ connectionString });
  await client.connect();
  try {
    if (args.markKybVerified) {
      const res = await client.query(
        `UPDATE merchants SET kyb_status = 'verified', kyb_verified_at = now(), updated_at = now() WHERE id = $1 RETURNING id`,
        [args.markKybVerified],
      );
      if (res.rowCount === 0) {
        throw new Error(`merchant ${args.markKybVerified} not found`);
      }
      console.log(`KYB verified for merchant ${args.markKybVerified}`);
      return;
    }

    let merchantId = args.merchantId;
    if (!merchantId) {
      if (!args.name || !args.display) {
        throw new Error(
          'provide --merchant-id, or --name and --display to create a merchant',
        );
      }
      merchantId = createId();
      await client.query(
        `INSERT INTO merchants (id, name, display_name) VALUES ($1, $2, $3)`,
        [merchantId, args.name, args.display],
      );
      console.log(`Created merchant ${merchantId} (kyb_status=pending)`);
    }

    const merchantRes = await client.query<{ kyb_status: string }>(
      `SELECT kyb_status FROM merchants WHERE id = $1`,
      [merchantId],
    );
    if (merchantRes.rowCount === 0) {
      throw new Error(`merchant ${merchantId} not found`);
    }
    const merchant = { kybStatus: merchantRes.rows[0].kyb_status };

    if (args.mode === 'live') {
      const accountRes = await client.query<{
        provider_reference: string | null;
      }>(
        `SELECT provider_reference FROM settlement_accounts WHERE merchant_id = $1`,
        [merchantId],
      );
      const account =
        accountRes.rowCount && accountRes.rowCount > 0
          ? { providerReference: accountRes.rows[0].provider_reference }
          : null;
      // The single shared gate: throws KYB_NOT_VERIFIED or
      // SETTLEMENT_DESTINATION_MISSING with a clear message.
      assertLiveKeyEligible(merchant, account);
    }

    const key = generateApiKey(args.mode);
    await client.query(
      `INSERT INTO api_keys (id, merchant_id, key_hash, key_prefix, fingerprint, mode) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        createId(),
        merchantId,
        key.keyHash,
        key.keyPrefix,
        key.fingerprint,
        key.mode,
      ],
    );

    console.log('');
    console.log(`Merchant:    ${merchantId}`);
    console.log(`Mode:        ${key.mode}`);
    console.log(`Fingerprint: ${key.fingerprint}`);
    console.log('');
    console.log('API key (store this now, it is not recoverable):');
    console.log(key.raw);
    console.log('');
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
