import { Keypair, PublicKey } from '@solana/web3.js';
import {
  deriveAccountAddresses,
  derivePolicyAddress,
  type SpendingLimit,
} from '@xend/smart-account';

import type { SettlementAuthoritySigner } from '../settlement/settlement-authority.interface';
import { AccountCreationError } from './account.errors';
import {
  ABOVE_LIMIT_POLICY_SEED,
  SPENDING_LIMIT_POLICY_SEED,
} from './account.interface';
import type {
  SpendChain,
  SquadsAccountRow,
  SquadsAccountStore,
} from './account.interface';
import { SpendService } from './spend.service';

/** Any token program will do here; these tests never reach the program. */
const TOKEN_PROGRAM_ID_FAKE = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);

const USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const SEED = 7n;
const PRIMARY = Keypair.generate().publicKey.toBase58();
const APPROVAL = Keypair.generate().publicKey.toBase58();
const DESTINATION = Keypair.generate().publicKey.toBase58();
const AUTHORITY = Keypair.generate().publicKey.toBase58();

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
    withUserLock: <T>(_userId: string, fn: () => Promise<T>) => fn(),
  };
}

function chain(
  limits: readonly SpendingLimit[] | Error = [],
  { programAccepts = false }: { programAccepts?: boolean } = {},
) {
  const read: string[] = [];
  const simulated: unknown[] = [];
  const spendChain: SpendChain = {
    wouldSucceed: (instruction) => {
      simulated.push(instruction);
      return Promise.resolve(programAccepts);
    },
    readSpendingLimits: (settingsAddress) => {
      read.push(settingsAddress);
      return limits instanceof Error
        ? Promise.reject(limits)
        : Promise.resolve(limits);
    },
    compile: () =>
      Promise.resolve({
        unsignedTxBase64: 'dHg=',
        messageBase64: 'bXNn',
        blockhash: 'BlockHash11111111111111111111111111111111111',
        lastValidBlockHeight: 100,
      }),
    tokenProgramFor: () => Promise.resolve(TOKEN_PROGRAM_ID_FAKE),
    createDestinationTokenAccount: () => Promise.resolve(null),
    feePayer: AUTHORITY,
  };
  return { spendChain, read, simulated };
}

function authority() {
  const sent: string[] = [];
  const signer: SettlementAuthoritySigner = {
    address: AUTHORITY,
    signAndSend: (wireTxBase64) => {
      sent.push(wireTxBase64);
      return Promise.resolve('signature-1');
    },
  };
  return { signer, sent };
}

function limit(overrides: Partial<SpendingLimit> = {}): SpendingLimit {
  return {
    policy: derivePolicyAddress(
      deriveAccountAddresses(SEED).settings,
      SPENDING_LIMIT_POLICY_SEED,
    ),
    mint: new PublicKey(USDC),
    maxPerUse: 100_000_000n,
    maxPerPeriod: 500_000_000n,
    remainingInPeriod: 500_000_000n,
    period: 'Daily',
    destinations: [],
    ...overrides,
  };
}

const request = {
  userId: 'user-1',
  destination: DESTINATION,
  mint: USDC,
  amountRaw: '1000000',
  decimals: 6,
};

/** The same Spend in native SOL, for the tests that are about SOL. */
const nativeRequest = {
  ...request,
  mint: PublicKey.default.toBase58(),
  decimals: 9,
};

function service(
  spendChain: SpendChain,
  row: SquadsAccountRow | null = account,
) {
  return new SpendService(store(row), spendChain, authority().signer);
}

describe('SpendService.prepare', () => {
  it('needs two signatures when the Account has no spending limit', async () => {
    const { spendChain } = chain([]);

    const result = await service(spendChain).prepare(nativeRequest);

    // The safe direction: an unknown limit state forces more signatures, not
    // fewer.
    expect(result.route).toBe('two-signature');
    expect(result.needsApprovalSignature).toBe(true);
  });

  it('needs one signature when a limit admits the Spend', async () => {
    const { spendChain } = chain([limit()]);

    const result = await service(spendChain).prepare(request);

    expect(result.route).toBe('spending-limit');
    expect(result.needsApprovalSignature).toBe(false);
  });

  it('falls back to two signatures above the per-use cap', async () => {
    const { spendChain } = chain([limit({ maxPerUse: 10n })]);

    const result = await service(spendChain).prepare(nativeRequest);

    expect(result.route).toBe('two-signature');
    expect(result.needsApprovalSignature).toBe(true);
  });

  it('falls back to two signatures once the period is spent', async () => {
    const { spendChain } = chain([limit({ remainingInPeriod: 10n })]);

    const result = await service(spendChain).prepare(nativeRequest);

    expect(result.route).toBe('two-signature');
  });

  it('takes one signature when the program says the period has rolled over', async () => {
    // The stored counter is refilled by the program as a side effect of a Spend
    // executing under the limit. Two-signature Spends run under a different
    // policy and never touch it, so a Consumer who exhausts the limit reads
    // zero forever and would never route one-signature again.
    const { spendChain, simulated } = chain(
      [limit({ remainingInPeriod: 0n })],
      {
        programAccepts: true,
      },
    );

    const result = await service(spendChain).prepare(request);

    expect(result.route).toBe('spending-limit');
    expect(result.needsApprovalSignature).toBe(false);
    expect(simulated).toHaveLength(1);
  });

  it('stays on two signatures when the program refuses', async () => {
    // The limit has to be on the same mint as the Spend, or the route never
    // reaches the optimistic recheck this test is about.
    const { spendChain, simulated } = chain(
      [limit({ mint: PublicKey.default, remainingInPeriod: 0n })],
      {
        programAccepts: false,
      },
    );

    const result = await service(spendChain).prepare(nativeRequest);

    expect(result.route).toBe('two-signature');
    expect(simulated).toHaveLength(1);
  });

  it('does not ask the program about a cap that never refills', async () => {
    // maxPerUse bounds a single Spend and no amount of waiting changes it, so
    // asking costs a round trip to be told what the stored value already said.
    const { spendChain, simulated } = chain([limit({ maxPerUse: 1n })], {
      programAccepts: true,
    });

    const result = await service(spendChain).prepare(nativeRequest);

    expect(result.route).toBe('two-signature');
    expect(simulated).toHaveLength(0);
  });

  it('does not ask the program when there is no limit at all', async () => {
    const { spendChain, simulated } = chain([], { programAccepts: true });

    const result = await service(spendChain).prepare(nativeRequest);

    expect(result.route).toBe('two-signature');
    expect(simulated).toHaveLength(0);
  });

  it('reads the limits of the Account being spent from', async () => {
    const { spendChain, read } = chain([]);

    await service(spendChain).prepare(nativeRequest);

    // The limit is a policy derived from this Account's settings, so reading
    // any other Account's would decide the route from the wrong balance.
    expect(read).toEqual([account.settingsAddress]);
  });

  it('fails the Spend when the limits cannot be read', async () => {
    const { spendChain } = chain(new Error('rpc down'));

    // A read that failed is not an answer. Turning it into an empty list would
    // settle the route from a state nobody observed, and would be
    // indistinguishable from an Account that genuinely has no limit.
    await expect(service(spendChain).prepare(request)).rejects.toThrow(
      'rpc down',
    );
  });

  it('pays the fee from the key that completes the Spend', async () => {
    const { spendChain } = chain([]);
    const { signer } = authority();

    await new SpendService(store(), spendChain, signer).prepare(nativeRequest);

    // The fee payer's signature slot is the one submit fills. Compiled against
    // any other key, S1 included, the Spend reaches the cluster still missing
    // it, and S1 has no lamports to pay with anyway.
    expect(spendChain.feePayer).toBe(signer.address);
    expect(spendChain.feePayer).not.toBe(PRIMARY);
  });

  it('prepares a token Spend that lands on the two-signature route', async () => {
    // The route built a SystemProgram.transfer whatever the mint said, so it
    // had to refuse rather than move SOL while the intent and the transfer row
    // both said USDC. It carries a token transfer now.
    const { spendChain } = chain([], { programAccepts: false });

    const prepared = await service(spendChain).prepare(request);

    expect(prepared.route).toBe('two-signature');
    expect(prepared.needsApprovalSignature).toBe(true);
  });

  it('refuses to prepare a Spend for a Consumer with no Account', async () => {
    const { spendChain } = chain([]);

    await expect(
      service(spendChain, null).prepare(request),
    ).rejects.toBeInstanceOf(AccountCreationError);
  });

  it('routes the two-signature path through the above-limit policy', async () => {
    const addresses = deriveAccountAddresses(SEED);
    const expected = derivePolicyAddress(
      addresses.settings,
      ABOVE_LIMIT_POLICY_SEED,
    );
    const { spendChain } = chain([]);

    const result = await service(spendChain).prepare(nativeRequest);

    // Not the Settings. A time-locked Settings cannot carry a synchronous
    // Spend at all, so routing there would make every above-limit Spend fail.
    expect(result.route).toBe('two-signature');
    expect(expected.equals(addresses.settings)).toBe(false);
  });
});

describe('SpendService.submit', () => {
  it('completes the Spend with the fee payer signature before broadcasting', async () => {
    const { spendChain } = chain([]);
    const { signer, sent } = authority();

    const signature = await new SpendService(
      store(),
      spendChain,
      signer,
    ).submit('c2lnbmVk');

    // The device cannot fill the fee payer's slot, so a Spend that skipped
    // this would reach the cluster missing its first signature.
    expect(sent).toEqual(['c2lnbmVk']);
    expect(signature).toBe('signature-1');
  });
});
