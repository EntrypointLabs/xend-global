import { ConfigService } from '@nestjs/config';

import {
  ABOVE_LIMIT_POLICY_SEED,
  SPENDING_LIMIT_POLICY_SEED,
} from './account.interface';
import type {
  ProposalState,
  ProvisioningChain,
  SquadsAccountRow,
  SquadsAccountStore,
} from './account.interface';
import { ProvisioningService } from './provisioning.service';

const USER = 'user-1';
const PRIMARY = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
const APPROVAL = 'GkP9xL7mQwR2sT4vB6nH8jC3dF5aZ1yU2eW4rK6tN9pM';
const SETTINGS = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const ACCOUNT: SquadsAccountRow = {
  userId: USER,
  settingsSeed: 42n,
  settingsAddress: SETTINGS,
  vaultAddress: 'Vau1t111111111111111111111111111111111111111',
  primarySigner: PRIMARY,
  approvalSigner: APPROVAL,
  approvalSubOrgId: 'suborg-1',
};

const store: SquadsAccountStore = {
  findByUserId: () => Promise.resolve(ACCOUNT),
  insert: (row) => Promise.resolve(row),
  findUserEmail: () => Promise.resolve('consumer@example.com'),
  withUserLock: <T>(_userId: string, fn: () => Promise<T>) => fn(),
};

const config = {
  getOrThrow: () => USDC,
} as unknown as ConfigService;

interface ChainState {
  timeLockSeconds?: number;
  transactionIndex?: bigint;
  policies?: bigint[];
  proposal?: ProposalState | null;
}

function fakeChain(state: ChainState = {}) {
  const compiled: { instructions: unknown[] }[] = [];
  const submitted: string[] = [];

  const chain: ProvisioningChain = {
    readSettings: () =>
      Promise.resolve({
        timeLockSeconds: state.timeLockSeconds ?? 0,
        transactionIndex: state.transactionIndex ?? 0n,
      }),
    policyExists: (_settings, seed) =>
      Promise.resolve((state.policies ?? []).includes(seed)),
    readProposal: () => Promise.resolve(state.proposal ?? null),
    compile: (params) => {
      compiled.push({ instructions: params.instructions });
      return Promise.resolve({
        unsignedTxBase64: 'unsigned',
        messageBase64: 'message',
        blockhash: 'hash',
        lastValidBlockHeight: 100,
      });
    },
    submit: (tx) => {
      submitted.push(tx);
      return Promise.resolve('sig-1');
    },
  };

  return { chain, compiled, submitted };
}

function service(chain: ProvisioningChain) {
  return new ProvisioningService(store, chain, config);
}

describe('ProvisioningService.prepareNext', () => {
  it('starts with the spending-limit policy', async () => {
    const { chain } = fakeChain();

    const plan = await service(chain).prepareNext(USER);

    expect(plan).toMatchObject({
      done: false,
      change: 'spending-limit',
      step: 'propose',
      needsApprovalSignature: false,
    });
  });

  it('moves to the above-limit policy once the limit exists', async () => {
    const { chain } = fakeChain({ policies: [SPENDING_LIMIT_POLICY_SEED] });

    const plan = await service(chain).prepareNext(USER);

    expect(plan.change).toBe('above-limit');
  });

  it('raises the time lock only after both policies exist', async () => {
    const { chain } = fakeChain({
      policies: [SPENDING_LIMIT_POLICY_SEED, ABOVE_LIMIT_POLICY_SEED],
    });

    // The lock goes on last. Doing it first would leave the Account unable to
    // add a policy until the lock elapsed, and every Spend runs under one.
    const plan = await service(chain).prepareNext(USER);

    expect(plan.change).toBe('time-lock');
  });

  it('reports done once both policies exist and the lock is on', async () => {
    const { chain } = fakeChain({
      policies: [SPENDING_LIMIT_POLICY_SEED, ABOVE_LIMIT_POLICY_SEED],
      timeLockSeconds: 86400,
    });

    await expect(service(chain).prepareNext(USER)).resolves.toEqual({
      done: true,
      needsApprovalSignature: false,
    });
  });

  it('asks the primary to approve a proposal nobody has approved', async () => {
    const { chain } = fakeChain({
      transactionIndex: 3n,
      proposal: { approved: [], settled: false },
    });

    const plan = await service(chain).prepareNext(USER);

    expect(plan.step).toBe('approve-primary');
    expect(plan.needsApprovalSignature).toBe(false);
  });

  it('asks the approval signer second, and flags that it needs S2', async () => {
    const { chain } = fakeChain({
      transactionIndex: 3n,
      proposal: { approved: [PRIMARY], settled: false },
    });

    const plan = await service(chain).prepareNext(USER);

    expect(plan.step).toBe('approve-approval');
    // The only step in the whole sequence that costs a biometric prompt.
    expect(plan.needsApprovalSignature).toBe(true);
  });

  it('executes once both signers have approved', async () => {
    const { chain } = fakeChain({
      transactionIndex: 3n,
      proposal: { approved: [PRIMARY, APPROVAL], settled: false },
    });

    const plan = await service(chain).prepareNext(USER);

    expect(plan.step).toBe('execute');
    expect(plan.needsApprovalSignature).toBe(false);
  });

  it('starts the next change at a fresh index once the last one settled', async () => {
    const { chain, compiled } = fakeChain({
      transactionIndex: 3n,
      // Executed, rejected or cancelled: index 3 is spent either way.
      proposal: { approved: [PRIMARY, APPROVAL], settled: true },
      policies: [SPENDING_LIMIT_POLICY_SEED],
    });

    const plan = await service(chain).prepareNext(USER);

    expect(plan.step).toBe('propose');
    expect(plan.change).toBe('above-limit');
    expect(compiled).toHaveLength(1);
  });

  it('never asks the Consumer to pay, because they have funded nothing yet', async () => {
    const { chain, compiled } = fakeChain({
      transactionIndex: 3n,
      proposal: { approved: [PRIMARY], settled: false },
    });

    await service(chain).prepareNext(USER);

    // The fee payer is picked inside the chain (the settlement authority), so
    // the service must not name one. Paying from S1 killed every step before
    // it reached the program: provisioning runs before a Consumer has any SOL.
    expect(compiled[0]).not.toHaveProperty('feePayer');
  });

  it('refuses to provision a Consumer with no Account', async () => {
    const { chain } = fakeChain();
    const empty: SquadsAccountStore = {
      ...store,
      findByUserId: () => Promise.resolve(null),
    };

    await expect(
      new ProvisioningService(empty, chain, config).prepareNext(USER),
    ).rejects.toThrow(/No Account/);
  });
});

describe('ProvisioningService.submit', () => {
  it('forwards the signed transaction and returns its signature', async () => {
    const { chain, submitted } = fakeChain();

    await expect(service(chain).submit(USER, 'signed-tx')).resolves.toBe(
      'sig-1',
    );
    expect(submitted).toEqual(['signed-tx']);
  });
});
