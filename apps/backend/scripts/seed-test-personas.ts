/**
 * Seeds a sandbox merchant (test API key + webhook endpoint) and three funded
 * test-Consumer personas for the pilot merchant's integration week and the
 * devnet E2E (the Stripe-test-cards analog):
 *
 *   happy-path          — balance and tier comfortably above a standard test payment
 *   insufficient-balance — near-zero USDC (rejected before settlement)
 *   over-tier-limit     — balance fine, but a payment above the tier per-payment cap
 *
 * Runs against DATABASE_URL (a test cluster). It creates the identities and
 * prints their ids + Account addresses + the sandbox key and webhook secret;
 * funding the devnet Accounts with USDC is a manual runbook step (Circle devnet
 * faucet mint, cluster-scoped) where automation is not possible.
 *
 * Usage:
 *   npx ts-node scripts/seed-test-personas.ts --webhook-url https://example.test/hook
 */
import { Client } from 'pg';
import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import { generateApiKey } from '../src/merchant/api-key.util';

interface Persona {
  label: string;
  email: string;
  fundingNote: string;
}

const PERSONAS: Persona[] = [
  {
    label: 'happy-path',
    email: 'happy-path@personas.test',
    fundingNote: 'Fund with USDC comfortably above a standard test payment.',
  },
  {
    label: 'insufficient-balance',
    email: 'insufficient-balance@personas.test',
    fundingNote: 'Leave near-zero USDC so capacity rejects before settlement.',
  },
  {
    label: 'over-tier-limit',
    email: 'over-tier-limit@personas.test',
    fundingNote:
      'Fund normally; test a payment above the tier per-payment cap to trigger the tier rejection.',
  },
];

function parseWebhookUrl(argv: string[]): string {
  const idx = argv.indexOf('--webhook-url');
  return idx >= 0 && argv[idx + 1]
    ? argv[idx + 1]
    : 'https://example.test/webhook';
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const webhookUrl = parseWebhookUrl(process.argv.slice(2));

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const merchantId = createId();
    await client.query(
      `INSERT INTO merchants (id, name, display_name, allowed_origins) VALUES ($1, $2, $3, $4)`,
      [
        merchantId,
        'Sandbox Merchant',
        'Sandbox Store',
        ['https://sandbox.test'],
      ],
    );

    const key = generateApiKey('test');
    await client.query(
      `INSERT INTO api_keys (id, merchant_id, key_hash, key_prefix, fingerprint, mode) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        createId(),
        merchantId,
        key.keyHash,
        key.keyPrefix,
        key.fingerprint,
        'test',
      ],
    );

    const webhookSecret = 'whsec_' + randomBytes(24).toString('base64url');
    await client.query(
      `INSERT INTO webhook_endpoints (id, merchant_id, url, secret_primary, mode) VALUES ($1, $2, $3, $4, $5)`,
      [createId(), merchantId, webhookUrl, webhookSecret, 'test'],
    );

    console.log('');
    console.log('Sandbox merchant');
    console.log(`  merchant_id:    ${merchantId}`);
    console.log(`  api_key:        ${key.raw}`);
    console.log(`  webhook_url:    ${webhookUrl}`);
    console.log(`  webhook_secret: ${webhookSecret}`);
    console.log('');

    for (const persona of PERSONAS) {
      const userId = createId();
      // A deterministic placeholder Account address per persona; the human
      // replaces/funds the real devnet Account. cuid2-derived so it is unique
      // and does not collide with a real key.
      const accountAddress = `DEVNET_${persona.label}_${createId().slice(0, 8)}`;
      await client.query(
        `INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`,
        [userId, persona.email],
      );
      const [{ id: resolvedUserId }] = (
        await client.query<{ id: string }>(
          `SELECT id FROM users WHERE email = $1`,
          [persona.email],
        )
      ).rows;
      await client.query(
        `INSERT INTO smart_accounts (id, user_id, wallet_address, provider, provider_user_id) VALUES ($1, $2, $3, 'privy', $4) ON CONFLICT (user_id) DO NOTHING`,
        [
          createId(),
          resolvedUserId,
          accountAddress,
          `provider_${persona.label}`,
        ],
      );

      console.log(`Persona: ${persona.label}`);
      console.log(`  consumer_id:     ${resolvedUserId}`);
      console.log(`  account_address: ${accountAddress}`);
      console.log(`  funding:         ${persona.fundingNote}`);
      console.log('');
    }

    console.log(
      'Runbook: fund the happy-path and over-tier Accounts on devnet via the Circle USDC faucet (cluster-scoped mint). insufficient-balance stays near zero.',
    );
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
