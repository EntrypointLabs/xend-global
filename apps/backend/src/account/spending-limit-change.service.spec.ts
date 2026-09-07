import type { ConfigService } from '@nestjs/config';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  deriveAccountAddresses,
  derivePolicyAddress,
  type SpendingLimit,
} from '@xend/smart-account';

import type { AccountEventsService } from '../activity/account-events.service';
import { InMemoryPreparedTxStore } from '../prepared/prepared-tx.memory';
import type { RecoveryService } from '../recovery/recovery.service';
import { SpendingLimitChangeError } from './account.errors';
import {
  ABOVE_LIMIT_POLICY_SEED,
  SPENDING_LIMIT_POLICY_SEED,
  type ProposalState,
  type ProvisioningChain,
  type SquadsAccountRow,
  type SquadsAccountStore,
} from './account.interface';
import { SpendingLimitChangeService } from './spending-limit-change.service';

const USER = 'user-1';
const SEED = 42n;
const ADDRESSES = deriveAccountAddresses(SEED);
const PRIMARY = Keypair.generate().publicKey;
const APPROVAL = Keypair.generate().publicKey;
const AUTHORITY = Keypair.generate().publicKey.toBase58();
const MINT = Keypair.generate().publicKey;
const CONFIG = {
  getOrThrow: () => MINT.toBase58(),
} as unknown as ConfigService;
const DAY = 24 * 60 * 60;
const ALL_PERMISSIONS = 7;

const ACCOUNT: SquadsAccountRow = {
  userId: USER,
  settingsSeed: SEED,
  settingsAddress: ADDRESSES.settings.toBase58(),
  vaultAddress: ADDRESSES.vault.toBase58(),
  primarySigner: PRIMARY.toBase58(),
  approvalSigner: APPROVAL.toBase58(),
  approvalSubOrgId: 'suborg-1',
};

function limit(over: Partial<SpendingLimit> = {}): SpendingLimit {
  return {
    policy: derivePolicyAddress(ADDRESSES.settings, SPENDING_LIMIT_POLICY_SEED),
    mint: MINT,
    maxPerUse: 100_000_000n,
    maxPerPeriod: 100_000_000n,
    remainingInPeriod: 40_000_000n,
    period: 'Daily',
    destinations: [],
    ...over,
  };
}

function store(row: SquadsAccountRow | null = ACCOUNT) {
  let current = row;
  const patches: Partial<SquadsAccountRow>[] = [];
  const accounts: SquadsAccountStore = {
    findByUserId: () => Promise.resolve(current),
    insert: (r) => Promise.resolve(r),
    listAll: () => Promise.resolve([]),
    findUserEmail: () => Promise.resolve('consumer@example.com'),
    withUserLock: <T>(_userId: string, fn: () => Promise<T>) => fn(),
    updateByUserId: (_userId, patch) => {
      patches.push(patch);
      current = { ...(current as SquadsAccountRow), ...patch };
      return Promise.resolve(current);
    },
  };
  return { accounts, patches };
}

interface ChainState {
  transactionIndex?: bigint;
  proposal?: Partial<ProposalState> | null;
  spendingLimit?: SpendingLimit | null;
  /** Whether the Account has been provisioned, so the seed after the limit is spent. */
  aboveLimit?: boolean;
  /** The last seed the program assigned, which the next policy has to follow. */
  policySeed?: bigint | null;
}

function fakeChain(state: ChainState = {}) {
  const compiled: { instructions: { programId: PublicKey }[] }[] = [];
  const submitted: string[] = [];
  /** Which policy seed each limit read resolved to. */
  const readsAt: bigint[] = [];

  const chain: ProvisioningChain = {
    rentPayer: AUTHORITY,
    readSettings: () =>
      Promise.resolve({
        timeLockSeconds: DAY,
        transactionIndex: state.transactionIndex ?? 4n,
        policySeed: state.policySeed ?? null,
        signers: [
          { key: PRIMARY, permissions: { mask: ALL_PERMISSIONS } },
          { key: APPROVAL, permissions: { mask: ALL_PERMISSIONS } },
        ],
      }),
    readSpendingLimit: (_settings, seed) => {
      readsAt.push(seed);
      return state.spendingLimit === null
        ? Promise.reject(new Error('no policy account'))
        : Promise.resolve(state.spendingLimit ?? limit());
    },
    policyExists: (_settings, seed) =>
      Promise.resolve(
        seed === ABOVE_LIMIT_POLICY_SEED
          ? (state.aboveLimit ?? state.spendingLimit !== null)
          : state.spendingLimit !== null,
      ),
    readProposal: () =>
      Promise.resolve(
        state.proposal
          ? {
              approved: [],
              rejected: [],
              settled: false,
              status: 'Active',
              statusTimestamp: null,
              ...state.proposal,
            }
          : null,
      ),
    compile: (params) => {
      compiled.push({
        instructions: params.instructions as { programId: PublicKey }[],
      });
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

  return { chain, compiled, submitted, readsAt };
}

function fakeEvents() {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const record = (method: string) => (_userId: string, params: unknown) => {
    calls.push({ method, params: params as Record<string, unknown> });
    return Promise.resolve(null);
  };
  const events = {
    recordSettingsChangeStaged: record('staged'),
    recordSettingsChangeExecuted: record('executed'),
    recordSettingsChangeRejected: record('rejected'),
    recordSpendingLimitChanged: record('limit'),
  } as unknown as AccountEventsService;
  return { events, calls };
}

function fakeRecovery(pending: { changeIndex: bigint } | null = null) {
  return {
    pendingChange: () => Promise.resolve(pending),
  } as unknown as RecoveryService;
}

function build(state: ChainState = {}, row: SquadsAccountRow | null = ACCOUNT) {
  const { chain, compiled, submitted, readsAt } = fakeChain(state);
  const { events, calls } = fakeEvents();
  const { accounts, patches } = store(row);
  const prepared = new InMemoryPreparedTxStore();
  const service = new SpendingLimitChangeService(
    accounts,
    chain,
    fakeRecovery(),
    events,
    CONFIG,
    prepared,
  );
  return {
    service,
    chain,
    compiled,
    submitted,
    calls,
    prepared,
    patches,
    readsAt,
  };
}

describe('SpendingLimitChangeService.start', () => {
  it('stages the change at the next index and hands back the propose step', async () => {
    const { service, calls, compiled } = build();

    const plan = await service.start(USER, { maxPerPeriod: '250000000' });

    expect(plan).toMatchObject({
      done: false,
      step: 'propose',
      changeIndex: '5',
      removing: false,
      limit: '$250 a day',
      needsApprovalSignature: false,
    });
    // Proposing a settings change is two instructions: the transaction and
    // the proposal that votes are cast on.
    expect(compiled[0]?.instructions).toHaveLength(2);
    expect(calls.map((c) => c.method)).toEqual(['staged']);
    expect(calls[0]?.params).toMatchObject({
      changeIndex: 5n,
      change: 'spending_limit',
      subject: '$250 a day',
    });
  });

  it('describes a removal in the words the Consumer is shown', async () => {
    const { service, calls } = build();

    const plan = await service.start(USER, { remove: true });

    expect(plan.removing).toBe(true);
    expect(plan.limit).toBe(
      'no limit, so every Spend needs a second confirmation',
    );
    expect(calls[0]?.params.subject).toBe(
      'no limit, so every Spend needs a second confirmation',
    );
  });

  it('announces nothing when the package refuses the change', async () => {
    const { service, calls } = build();

    // The terms the Account already carries. Staging it would cost the
    // Consumer a day and two prompts to arrive where they started.
    await expect(
      service.start(USER, { maxPerPeriod: '100000000' }),
    ).rejects.toBeInstanceOf(SpendingLimitChangeError);
    expect(calls).toEqual([]);
  });

  it('refuses to start while a device rotation holds the next index', async () => {
    const { service } = build({}, {
      ...ACCOUNT,
      pendingApprovalChangeIndex: '5',
    } as SquadsAccountRow);

    await expect(
      service.start(USER, { maxPerPeriod: '250000000' }),
    ).rejects.toThrow(/already in flight/);
  });

  it('refuses to start while a recovery key change holds the next index', async () => {
    const { chain } = fakeChain();
    const { events } = fakeEvents();
    const service = new SpendingLimitChangeService(
      store().accounts,
      chain,
      fakeRecovery({ changeIndex: 5n }),
      events,
      CONFIG,
      new InMemoryPreparedTxStore(),
    );

    await expect(
      service.start(USER, { maxPerPeriod: '250000000' }),
    ).rejects.toThrow(/already in flight/);
  });

  it('refuses to start a second Spending Limit change over the first', async () => {
    const { service } = build({ proposal: {} });

    await service.start(USER, { maxPerPeriod: '250000000' });

    await expect(
      service.start(USER, { maxPerPeriod: '300000000' }),
    ).rejects.toThrow(/finish or reject it first/);
  });

  it('refuses a removal on an Account that has no limit', async () => {
    const { service, calls } = build({ spendingLimit: null });

    await expect(service.start(USER, { remove: true })).rejects.toThrow(
      /no Spending Limit to remove/,
    );
    expect(calls).toEqual([]);
  });

  it('creates the policy when the Account has no limit to rewrite', async () => {
    const { service, calls, compiled } = build({ spendingLimit: null });

    const plan = await service.start(USER, { maxPerPeriod: '50000000' });

    // A `PolicyUpdate` against an address holding nothing is accepted here and
    // refused a day later at execute, so removing a limit must not be the last
    // change an Account can make to it.
    expect(plan).toMatchObject({
      step: 'propose',
      creating: true,
      removing: false,
      limit: '$50 a day',
    });
    expect(compiled[0]?.instructions).toHaveLength(2);
    expect(calls[0]?.params).toMatchObject({
      change: 'spending_limit',
      subject: '$50 a day',
    });
  });

  it('creates at the next free seed and records it once the chain confirms', async () => {
    // An Account that removed its limit: seeds 1 and 2 are spent and the
    // program will not hand either back, so the replacement lands at 3.
    const { service, chain, calls, patches } = build({
      spendingLimit: null,
      aboveLimit: true,
      policySeed: 2n,
      proposal: { settled: true, status: 'Executed' },
    });

    const plan = await service.start(USER, { maxPerPeriod: '50000000' });
    expect(plan).toMatchObject({ step: 'propose', creating: true });
    // Nothing is written while the change is only staged.
    expect(patches).toEqual([]);

    chain.policyExists = () => Promise.resolve(true);
    chain.readSpendingLimit = () =>
      Promise.resolve(limit({ maxPerPeriod: 50_000_000n }));

    expect(await service.next(USER)).toEqual({ done: true });
    expect(patches).toEqual([{ spendingLimitPolicySeed: 3n }]);
    expect(calls.map((c) => c.method)).toEqual(['staged', 'limit', 'executed']);
  });

  it('leaves the seed unwritten when the change does not execute', async () => {
    const { service, patches, calls } = build({
      spendingLimit: null,
      aboveLimit: true,
      policySeed: 2n,
      proposal: { settled: true, status: 'Rejected' },
    });

    await service.start(USER, { maxPerPeriod: '50000000' });
    expect(await service.next(USER)).toEqual({ done: true });

    expect(patches).toEqual([]);
    expect(calls.map((c) => c.method)).toEqual(['staged', 'rejected']);
  });

  it('reads an Account with no stored seed at the seed provisioning wrote', async () => {
    const { service, readsAt } = build();

    await service.start(USER, { maxPerPeriod: '250000000' });

    // Once to see what it is replacing, once to build the change.
    expect(new Set(readsAt)).toEqual(new Set([SPENDING_LIMIT_POLICY_SEED]));
  });

  it('reads an Account carrying a seed of its own at that seed', async () => {
    const { service, readsAt } = build(
      {
        spendingLimit: limit({
          policy: derivePolicyAddress(ADDRESSES.settings, 3n),
        }),
      },
      { ...ACCOUNT, spendingLimitPolicySeed: 3n } as SquadsAccountRow,
    );

    await service.start(USER, { maxPerPeriod: '250000000' });

    expect(new Set(readsAt)).toEqual(new Set([3n]));
  });

  it('records a created limit with nothing before it', async () => {
    const { chain } = fakeChain({
      proposal: { settled: true, status: 'Executed' },
      spendingLimit: null,
    });
    const { events, calls } = fakeEvents();
    const service = new SpendingLimitChangeService(
      store().accounts,
      chain,
      fakeRecovery(),
      events,
      CONFIG,
      new InMemoryPreparedTxStore(),
    );
    await service.start(USER, { maxPerPeriod: '50000000' });

    chain.policyExists = () => Promise.resolve(true);
    chain.readSpendingLimit = () =>
      Promise.resolve(limit({ maxPerPeriod: 50_000_000n }));

    expect(await service.next(USER)).toEqual({ done: true });
    expect(calls.map((c) => c.method)).toEqual(['staged', 'limit', 'executed']);
    expect(calls[1]?.params).toMatchObject({
      limit: '$50 a day',
      previous: null,
    });
  });

  it('refuses to commit a creation the chain did not take', async () => {
    const { service, calls } = build({
      proposal: { settled: true, status: 'Executed' },
      spendingLimit: null,
    });
    await service.start(USER, { maxPerPeriod: '50000000' });

    await expect(service.next(USER)).rejects.toThrow(
      /did not install the staged Spending Limit/,
    );
    expect(calls.map((c) => c.method)).toEqual(['staged']);
  });
});

describe('SpendingLimitChangeService.next', () => {
  it('is done for a Consumer with nothing staged', async () => {
    const { service } = build();

    expect(await service.next(USER)).toEqual({ done: true });
  });

  it('walks approvals in order, primary before approval', async () => {
    const { service } = build({ proposal: {} });
    await service.start(USER, { maxPerPeriod: '250000000' });

    const first = await service.next(USER);
    expect(first).toMatchObject({
      step: 'approve-primary',
      needsApprovalSignature: false,
    });
  });

  it('asks for the approval signature once the primary has voted', async () => {
    const { service } = build({
      proposal: { approved: [ACCOUNT.primarySigner] },
    });
    await service.start(USER, { maxPerPeriod: '250000000' });

    expect(await service.next(USER)).toMatchObject({
      step: 'approve-approval',
      needsApprovalSignature: true,
    });
  });

  it('reports the delay rather than an executable step while the lock runs', async () => {
    const soon = BigInt(Math.floor(Date.now() / 1000));
    const { service } = build({
      proposal: {
        approved: [ACCOUNT.primarySigner, ACCOUNT.approvalSigner],
        status: 'Approved',
        statusTimestamp: soon,
      },
    });
    await service.start(USER, { maxPerPeriod: '250000000' });

    const plan = await service.next(USER);
    expect(plan.step).toBe('waiting');
    expect(plan.unsignedTxBase64).toBeUndefined();
    expect(new Date(plan.executableAt!).getTime()).toBe(
      Number(soon + BigInt(DAY)) * 1000,
    );
  });

  it('carries the policy on the execute step once the lock has run', async () => {
    const past = BigInt(Math.floor(Date.now() / 1000)) - BigInt(2 * DAY);
    const { service, compiled } = build({
      proposal: {
        approved: [ACCOUNT.primarySigner, ACCOUNT.approvalSigner],
        status: 'Approved',
        statusTimestamp: past,
      },
    });
    await service.start(USER, { maxPerPeriod: '250000000' });

    expect(await service.next(USER)).toMatchObject({ step: 'execute' });
    // The rewritten policy rides along as a remaining account, the way a
    // created one does; without it the program has nothing to write onto.
    const execute = compiled.at(-1)!.instructions[0] as unknown as {
      keys: { pubkey: PublicKey }[];
    };
    expect(
      execute.keys.some((key) =>
        key.pubkey.equals(
          derivePolicyAddress(ADDRESSES.settings, SPENDING_LIMIT_POLICY_SEED),
        ),
      ),
    ).toBe(true);
  });

  it('commits an executed change only after reading the policy back', async () => {
    const { chain } = fakeChain({
      proposal: { settled: true, status: 'Executed' },
    });
    const { events, calls } = fakeEvents();
    const service = new SpendingLimitChangeService(
      store().accounts,
      chain,
      fakeRecovery(),
      events,
      CONFIG,
      new InMemoryPreparedTxStore(),
    );
    await service.start(USER, { maxPerPeriod: '250000000' });

    chain.readSpendingLimit = () =>
      Promise.resolve(limit({ maxPerPeriod: 250_000_000n }));

    expect(await service.next(USER)).toEqual({ done: true });
    expect(calls.map((c) => c.method)).toEqual(['staged', 'limit', 'executed']);
    expect(calls[1]?.params).toMatchObject({
      limit: '$250 a day',
      previous: '$100 a day',
    });
  });

  it('refuses to commit a limit the chain did not take', async () => {
    // An executed proposal at the index proves some change landed there, not
    // that it was this one.
    const { service, calls } = build({
      proposal: { settled: true, status: 'Executed' },
    });
    await service.start(USER, { maxPerPeriod: '250000000' });

    await expect(service.next(USER)).rejects.toThrow(
      /did not install the staged Spending Limit/,
    );
    expect(calls.map((c) => c.method)).toEqual(['staged']);
  });

  it('refuses to commit a removal while the policy is still there', async () => {
    const { service } = build({
      proposal: { settled: true, status: 'Executed' },
    });
    await service.start(USER, { remove: true });

    await expect(service.next(USER)).rejects.toThrow(
      /did not remove the Spending Limit/,
    );
  });

  it('commits a removal once the policy is gone', async () => {
    const { chain } = fakeChain({
      proposal: { settled: true, status: 'Executed' },
    });
    const { events, calls } = fakeEvents();
    const prepared = new InMemoryPreparedTxStore();
    const service = new SpendingLimitChangeService(
      store().accounts,
      chain,
      fakeRecovery(),
      events,
      CONFIG,
      prepared,
    );
    await service.start(USER, { remove: true });

    // The policy is gone the moment the change executes, which is what the
    // reconciler has to see before it writes anything down.
    chain.policyExists = () => Promise.resolve(false);

    expect(await service.next(USER)).toEqual({ done: true });
    expect(calls.map((c) => c.method)).toEqual(['staged', 'limit', 'executed']);
    expect(
      await prepared.get('spending-limit-change:staged:user-1'),
    ).toBeNull();
  });

  it('forgets a change the chain rejected', async () => {
    const { service, calls } = build({
      proposal: { settled: true, status: 'Rejected' },
    });
    await service.start(USER, { maxPerPeriod: '250000000' });

    expect(await service.next(USER)).toEqual({ done: true });
    expect(calls.map((c) => c.method)).toEqual(['staged', 'rejected']);
  });

  it('forgets a staged change whose index the chain has moved past', async () => {
    const { chain } = fakeChain();
    const { events, calls } = fakeEvents();
    const service = new SpendingLimitChangeService(
      store().accounts,
      chain,
      fakeRecovery(),
      events,
      CONFIG,
      new InMemoryPreparedTxStore(),
    );
    await service.start(USER, { maxPerPeriod: '250000000' });

    // Never proposed, and something else has since taken the index. Left
    // staged it would block every later change forever.
    chain.readSettings = () =>
      Promise.resolve({
        timeLockSeconds: DAY,
        transactionIndex: 9n,
        policySeed: null,
        signers: [],
      });

    expect(await service.next(USER)).toEqual({ done: true });
    expect(calls.map((c) => c.method)).toEqual(['staged', 'rejected']);
  });
});

describe('SpendingLimitChangeService.submit', () => {
  it('refuses bytes that are not the step it prepared', async () => {
    const { service } = build();
    await service.start(USER, { maxPerPeriod: '250000000' });

    await expect(service.submit(USER, 'not-a-transaction')).rejects.toThrow(
      /not a valid transaction/,
    );
  });

  it('refuses a submit with no step awaiting a signature', async () => {
    const { service } = build();

    await expect(service.submit(USER, 'anything')).rejects.toThrow(
      /No Spending Limit step is awaiting a signature/,
    );
  });
});
