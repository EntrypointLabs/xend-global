import { Logger } from '@nestjs/common';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  deriveAccountAddresses,
  derivePolicyAddress,
  type SpendingLimit,
} from '@xend/smart-account';

import { SPENDING_LIMIT_POLICY_SEED } from './account.interface';
import type { SpendChain } from './account.interface';
import { SpendingLimitResponseSchema } from './dtos';
import { SpendingLimitService } from './spending-limit.service';

const USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const SEED = 7n;
const SETTINGS = deriveAccountAddresses(SEED).settings.toBase58();
const AUTHORITY = Keypair.generate().publicKey.toBase58();

function chain(limits: readonly SpendingLimit[] | Error) {
  const read: string[] = [];
  const spendChain: SpendChain = {
    readSpendingLimits: (settingsAddress) => {
      read.push(settingsAddress);
      return limits instanceof Error
        ? Promise.reject(limits)
        : Promise.resolve(limits);
    },
    compile: () => Promise.reject(new Error('not part of this read')),
    wouldSucceed: () => Promise.reject(new Error('not part of this read')),
    feePayer: AUTHORITY,
  };
  return { spendChain, read };
}

function limit(overrides: Partial<SpendingLimit> = {}): SpendingLimit {
  return {
    policy: derivePolicyAddress(
      deriveAccountAddresses(SEED).settings,
      SPENDING_LIMIT_POLICY_SEED,
    ),
    mint: new PublicKey(USDC),
    maxPerUse: 100_000_000n,
    maxPerPeriod: 100_000_000n,
    remainingInPeriod: 42_500_000n,
    period: 'Daily',
    destinations: [],
    ...overrides,
  };
}

describe('SpendingLimitService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports the caps, what is left and the mint', async () => {
    const { spendChain } = chain([limit()]);

    const result = await new SpendingLimitService(spendChain).forAccount(
      SETTINGS,
    );

    expect(result).toEqual({
      mint: USDC,
      maxPerUse: '100000000',
      maxPerPeriod: '100000000',
      remainingInPeriod: '42500000',
      period: 'Daily',
    });
  });

  it('carries the amounts as integer strings at the mint decimals', async () => {
    // A u64 does not survive JSON's number, and a cap that silently rounds is
    // worse than one that is absent: the app would warn on the wrong amounts.
    const { spendChain } = chain([
      limit({ maxPerUse: 18_446_744_073_709_551_615n }),
    ]);

    const result = await new SpendingLimitService(spendChain).forAccount(
      SETTINGS,
    );

    expect(result?.maxPerUse).toBe('18446744073709551615');
    expect(SpendingLimitResponseSchema.parse(result)).toEqual(result);
  });

  it('reports no limit for an Account that has none yet', async () => {
    const { spendChain } = chain([]);

    // Not an error and not a zero cap. Provisioning creates the policy after
    // the Account, so this is what every Account looks like in between.
    await expect(
      new SpendingLimitService(spendChain).forAccount(SETTINGS),
    ).resolves.toBeNull();
  });

  it('reports no limit rather than failing when the policy cannot be read', async () => {
    const { spendChain } = chain(new Error('rpc down'));

    // The caller needs the vault address and the sub-organization id to do
    // anything at all; losing those to a transient read would take the app
    // down with it. An absent limit only makes the app ask for the second
    // confirmation, which is what an unreadable limit produces anyway.
    await expect(
      new SpendingLimitService(spendChain).forAccount(SETTINGS),
    ).resolves.toBeNull();
  });

  it('reads the limit of the Account it was asked about', async () => {
    const { spendChain, read } = chain([limit()]);

    await new SpendingLimitService(spendChain).forAccount(SETTINGS);

    expect(read).toEqual([SETTINGS]);
  });
});
