/**
 * Read-only preflight, run from apps/backend:
 * node --env-file=.env -r ts-node/register scripts/check-payment-fees.ts \
 *   --payer <public-address> --reserve-lamports <buffer> \
 *   --fee-budget-lamports <maximum-planned-fees> --new-token-accounts <count>
 *
 * Does not load a signing key, broadcast, request an airdrop, or charge USDC.
 * The budget is supplied by the operator, not an exact RPC fee estimate.
 * Re-run immediately before testing; this snapshot does not reserve SOL
 * against concurrent transactions. Account rent covers classic SPL ATAs only.
 */
import { createSolanaRpc, address } from '@solana/kit';

function required(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--'))
    throw new Error(`--${name} is required`);
  return value;
}

function integer(name: string): bigint {
  const value = required(name);
  if (!/^(0|[1-9][0-9]*)$/.test(value))
    throw new Error(`--${name} must be a non-negative integer`);
  return BigInt(value);
}

async function main() {
  const payer = address(required('payer'));
  const reserve = integer('reserve-lamports');
  const fees = integer('fee-budget-lamports');
  const accounts = integer('new-token-accounts');
  if (reserve === 0n || fees === 0n)
    throw new Error('Reserve and fee budget must both be positive');
  const cluster = process.env.SOLANA_CLUSTER;
  // Fixed public endpoints prevent accidental cross-cluster env overrides.
  const endpoint =
    cluster === 'devnet'
      ? 'https://api.devnet.solana.com'
      : cluster === 'mainnet'
        ? 'https://api.mainnet-beta.solana.com'
        : undefined;
  if (!endpoint) throw new Error('SOLANA_CLUSTER must be devnet or mainnet');
  const rpc = createSolanaRpc(endpoint);
  const [balance, rent] = await Promise.all([
    rpc.getBalance(payer, { commitment: 'confirmed' }).send(),
    rpc
      .getMinimumBalanceForRentExemption(165n, { commitment: 'confirmed' })
      .send(),
  ]);
  const requiredLamports = reserve + fees + accounts * rent;
  const shortfall =
    requiredLamports > balance.value ? requiredLamports - balance.value : 0n;
  console.log(
    JSON.stringify(
      {
        kind: 'read-only-fee-budget-preflight',
        cluster,
        payer,
        observedAt: new Date().toISOString(),
        slot: balance.context.slot.toString(),
        balanceLamports: balance.value.toString(),
        reserveLamports: reserve.toString(),
        feeBudgetLamports: fees.toString(),
        newTokenAccounts: accounts.toString(),
        rentPerTokenAccountLamports: rent.toString(),
        requiredLamports: requiredLamports.toString(),
        shortfallLamports: shortfall.toString(),
        sufficientForBudget: shortfall === 0n,
      },
      null,
      2,
    ),
  );
  if (shortfall > 0n) process.exitCode = 2;
}

void main().catch(() => {
  // RPC errors can contain URLs. Never echo credential-bearing environment.
  console.error(
    'Fee preflight failed. Check arguments, cluster and RPC availability.',
  );
  process.exitCode = 1;
});
