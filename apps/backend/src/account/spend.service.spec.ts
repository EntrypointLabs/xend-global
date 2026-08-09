import { Keypair, PublicKey } from '@solana/web3.js';
import {
  deriveAccountAddresses,
  derivePolicyAddress,
  type SpendingLimit,
} from '@xend/smart-account';

import { AccountCreationError } from './account.errors';
import { ABOVE_LIMIT_POLICY_SEED } from './account.interface';
import type {
  SpendChain,
  SquadsAccountRow,
  SquadsAccountStore,
} from './account.interface';
import { SpendService } from './spend.service';

const USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const SEED = 7n;
const PRIMARY = Keypair.generate().publicKey.toBase58();
const APPROVAL = Keypair.generate().publicKey.toBase58();
const DESTINATION = Keypair.generate().publicKey.toBase58();

const account: SquadsAccountRow = {
  userId: 'user-1',
  settingsSeed: SEED,
  settingsAddress: deriveAccountAddresses(SEED).settings.toBase58(),
  vaultAddress: deriveAccountAddresses(SEED).vault.toBase58(),
  primarySigner: PRIMARY,
  approvalSigner: APPROVAL,
  approvalSubOrgId: 'suborg-1',
};

function store(row: SquadsAccountRow | null = account): SquadsAccountStore {
  return {
    findByUserId: () => Promise.resolve(row),
    insert: (r) => Promise.resolve(r),
    findUserEmail: () => Promise.resolve('consumer@example.com'),
  };
}

function chain(limits: readonly SpendingLimit[] = []) {
  const compiled: { feePayer: string }[] = [];
  const spendChain: SpendChain = {
    readSpendingLimits: () => Promise.resolve(limits),
    compile: (params) => {
      compiled.push({ feePayer: params.feePayer.toBase58() });
      return Promise.resolve({
        unsignedTxBase64: 'dHg=',
        messageBase64: 'bXNn',
      });
    },
  };
  return { spendChain, compiled };
}

const request = {
  userId: 'user-1',
  destination: DESTINATION,
  mint: USDC,
  amountRaw: '1000000',
  decimals: 6,
};

describe('SpendService.prepare', () => {
  it('needs two signatures when the Account has no spending limit', async () => {
    const { spendChain } = chain([]);

    const result = await new SpendService(store(), spendChain).prepare(request);

    // The safe direction: an unknown limit state forces more signatures, not
    // fewer.
    expect(result.route).toBe('two-signature');
    expect(result.needsApprovalSignature).toBe(true);
  });

  it('needs one signature when a limit admits the Spend', async () => {
    const addresses = deriveAccountAddresses(SEED);
    const { spendChain } = chain([
      {
        policy: derivePolicyAddress(addresses.settings, 1n),
        mint: new PublicKey(USDC),
        maxPerUse: 100_000_000n,
        remainingInPeriod: 500_000_000n,
        destinations: [],
      },
    ]);

    const result = await new SpendService(store(), spendChain).prepare(request);

    expect(result.route).toBe('spending-limit');
    expect(result.needsApprovalSignature).toBe(false);
  });

  it('falls back to two signatures above the per-use cap', async () => {
    const addresses = deriveAccountAddresses(SEED);
    const { spendChain } = chain([
      {
        policy: derivePolicyAddress(addresses.settings, 1n),
        mint: new PublicKey(USDC),
        maxPerUse: 10n,
        remainingInPeriod: 500_000_000n,
        destinations: [],
      },
    ]);

    const result = await new SpendService(store(), spendChain).prepare(request);

    expect(result.route).toBe('two-signature');
  });

  it('pays the fee from the primary signer', async () => {
    const { spendChain, compiled } = chain([]);

    await new SpendService(store(), spendChain).prepare(request);

    // The vault is a PDA with no key and the relayer's allowlist excludes the
    // Squads program, so S1 is the only thing that can pay today.
    expect(compiled[0].feePayer).toBe(PRIMARY);
  });

  it('refuses to prepare a Spend for a Consumer with no Account', async () => {
    const { spendChain } = chain([]);

    await expect(
      new SpendService(store(null), spendChain).prepare(request),
    ).rejects.toBeInstanceOf(AccountCreationError);
  });

  it('routes the two-signature path through the above-limit policy', async () => {
    const addresses = deriveAccountAddresses(SEED);
    const expected = derivePolicyAddress(
      addresses.settings,
      ABOVE_LIMIT_POLICY_SEED,
    );
    const { spendChain } = chain([]);

    const result = await new SpendService(store(), spendChain).prepare(request);

    // Not the Settings. A time-locked Settings cannot carry a synchronous
    // Spend at all, so routing there would make every above-limit Spend fail.
    expect(result.route).toBe('two-signature');
    expect(expected.equals(addresses.settings)).toBe(false);
  });
});
