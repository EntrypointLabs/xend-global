/**
 * Merchant onboarding at automation level zero (no UI). This IS the four-stage
 * onboarding model executed by hand: it creates/updates a Merchant profile,
 * stamps KYB after off-system checks, and issues test/live API keys through the
 * SAME gate the KeyIssuanceService uses (assertLiveKeyEligible), so the manual
 * pilot and the future merchants.xend.global portal can never drift.
 *
 * Usage:
 *   npx ts-node scripts/issue-merchant-key.ts --name "Acme" --display "Acme Store" --origin https://acme.example --mode test
 *   npx ts-node scripts/issue-merchant-key.ts --merchant-id m_123 --mode live
 *   npx ts-node scripts/issue-merchant-key.ts --merchant-id m_123 --origin https://acme.example
 *   npx ts-node scripts/issue-merchant-key.ts --mark-kyb-verified m_123
 *
 * --origin is the checkout page origin the popup posts its result back to
 * (merchants.allowed_origins). Repeat it for multiple storefronts. Creating a
 * merchant requires at least one: without it the popup callback has no valid
 * target and silently never reaches the store.
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
  origins: string[];
}

/**
 * Normalize to a bare origin, mirroring the SDK's checkoutOrigin rule: https
 * only (http allowed for localhost), no path. Prevents storing a value the
 * popup's exact-origin postMessage target would then reject.
 */
function assertBareOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`--origin must be a valid URL: ${value}`);
  }
  const isLocalhost =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost)) {
    throw new Error(
      `--origin must be https (http allowed only for localhost): ${value}`,
    );
  }
  if (url.origin !== value.replace(/\/$/, '')) {
    throw new Error(`--origin must be a bare origin with no path: ${value}`);
  }
  return url.origin;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: 'test', origins: [] };
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
      case '--origin': {
        const value = next();
        if (!value) throw new Error('--origin requires a value');
        args.origins.push(assertBareOrigin(value));
        break;
      }
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
      if (args.origins.length === 0) {
        throw new Error(
          'provide at least one --origin (the checkout page origin, e.g. https://store.example); popup callbacks are undeliverable to an originless merchant',
        );
      }
      merchantId = createId();
      await client.query(
        `INSERT INTO merchants (id, name, display_name, allowed_origins) VALUES ($1, $2, $3, $4)`,
        [merchantId, args.name, args.display, args.origins],
      );
      console.log(
        `Created merchant ${merchantId} (kyb_status=pending, origins=${args.origins.join(', ')})`,
      );
    } else if (args.origins.length > 0) {
      const res = await client.query(
        `UPDATE merchants SET allowed_origins = $2, updated_at = now() WHERE id = $1 RETURNING id`,
        [merchantId, args.origins],
      );
      if (res.rowCount === 0) {
        throw new Error(`merchant ${merchantId} not found`);
      }
      console.log(
        `Updated allowed_origins for ${merchantId}: ${args.origins.join(', ')}`,
      );
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
