import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { deriveAccountAddresses } from '@xend/smart-account';

import type {
  RecoverySignerStatus,
  RecoverySignerSummary,
} from '../recovery/recovery.service';
import { RecoveryService } from '../recovery/recovery.service';
import type {
  ProposalState,
  ProvisioningChain,
  SquadsAccountRow,
  SquadsAccountStore,
} from './account.interface';
import { RecoveryChangeService } from './recovery-change.service';

const USER = 'user-1';
const PRIMARY = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
const APPROVAL = 'GkP9xL7mQwR2sT4vB6nH8jC3dF5aZ1yU2eW4rK6tN9pM';
const SETTINGS = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const AUTHORITY = 'Eo5wriQzhkJrQKEwTLMBMBDdCq1tE7QzKw8ias91pft5';
const SIGNER_ADDRESS = Keypair.generate().publicKey.toBase58();
const DAY = 24 * 60 * 60;

const ACCOUNT: SquadsAccountRow = {
  userId: USER,
  settingsSeed: 42n,
  settingsAddress: SETTINGS,
  vaultAddress: 'Vau1t111111111111111111111111111111111111111',
  primarySigner: PRIMARY,
  approvalSigner: APPROVAL,
  approvalSubOrgId: 'suborg-1',
};

const ADDRESSES = deriveAccountAddresses(ACCOUNT.settingsSeed);

function store(row: SquadsAccountRow | null = ACCOUNT): SquadsAccountStore {
  return {
    findByUserId: () => Promise.resolve(row),
    insert: (r) => Promise.resolve(r),
    listAll: () => Promise.resolve([]),
    findUserEmail: () => Promise.resolve('consumer@example.com'),
    withUserLock: <T>(_userId: string, fn: () => Promise<T>) => fn(),
  };
}

interface ChainState {
  transactionIndex?: bigint;
  proposal?: Partial<ProposalState> | null;
}

function fakeChain(state: ChainState = {}, messageBase64 = 'message') {
  const compiled: { instructions: unknown[] }[] = [];
  const submitted: string[] = [];

  const chain: ProvisioningChain = {
    rentPayer: AUTHORITY,
    readSettings: () =>
      Promise.resolve({
        timeLockSeconds: DAY,
        transactionIndex: state.transactionIndex ?? 0n,
      }),
    policyExists: () => Promise.resolve(true),
    readProposal: () =>
      Promise.resolve(
        state.proposal
          ? {
              approved: [],
              settled: false,
              status: 'Active',
              statusTimestamp: null,
              ...state.proposal,
            }
          : null,
      ),
    compile: (params) => {
      compiled.push({ instructions: params.instructions });
      return Promise.resolve({
        unsignedTxBase64: 'unsigned',
        messageBase64,
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

/** Only the parts of RecoveryService this service actually reaches. */
function fakeRecovery({
  status = 'pending_add',
  changeIndex = null,
}: { status?: RecoverySignerStatus; changeIndex?: bigint | null } = {}) {
  const calls: string[] = [];
  const summary: RecoverySignerSummary = {
    id: 'signer-1',
    address: SIGNER_ADDRESS,
    channel: 'external_wallet',
    channelValue: SIGNER_ADDRESS,
    createdAt: new Date(0),
    status,
    removable: false,
  };
  let index = changeIndex;

  const recovery = {
    pendingChange: () =>
      Promise.resolve(
        index === null ? null : { signerId: summary.id, changeIndex: index },
      ),
    list: () => Promise.resolve([summary]),
    markChange: (_id: string, at: bigint) => {
      index = at;
      calls.push(`markChange:${at}`);
      return Promise.resolve();
    },
    settle: (_userId: string, at: bigint) => {
      calls.push(`settle:${at}`);
      return Promise.resolve();
    },
    abandon: (_userId: string, at: bigint) => {
      calls.push(`abandon:${at}`);
      return Promise.resolve();
    },
  } as unknown as RecoveryService;

  return { recovery, calls };
}

/** A transaction whose compiled message is `messageBase64`. */
function signedFor(messageBase64: string): string {
  const message = new TransactionMessage({
    payerKey: new PublicKey(AUTHORITY),
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const real = Buffer.from(tx.message.serialize()).toString('base64');
  expect(real).not.toBe(messageBase64);
  return Buffer.from(tx.serialize()).toString('base64');
}

function keysOf(compiled: { instructions: unknown[] }): string[] {
  return (compiled.instructions as { keys: { pubkey: PublicKey }[] }[]).flatMap(
    (ix) => ix.keys.map((k) => k.pubkey.toBase58()),
  );
}

describe('RecoveryChangeService.start', () => {
  it('stages the change at the index after the current one', async () => {
    const { chain, compiled } = fakeChain({ transactionIndex: 7n });
    const { recovery, calls } = fakeRecovery();

    const plan = await new RecoveryChangeService(
      store(),
      chain,
      recovery,
    ).start(USER, 'signer-1');

    expect(plan.step).toBe('propose');
    expect(plan.changeIndex).toBe('8');
    // Recorded before the chain is touched, so an interrupted change is found
    // and re-proposed rather than lost.
    expect(calls).toContain('markChange:8');
    expect(compiled).toHaveLength(1);
  });

  it('proposes an addition that names the staged signer', async () => {
    const { chain, compiled } = fakeChain();
    const { recovery } = fakeRecovery({ status: 'pending_add' });

    await new RecoveryChangeService(store(), chain, recovery).start(
      USER,
      'signer-1',
    );

    expect(keysOf(compiled[0])).toContain(ADDRESSES.settings.toBase58());
    // The Consumer's S1 proposes; the authority only funds it.
    expect(keysOf(compiled[0])).toContain(PRIMARY);
    expect(keysOf(compiled[0])).toContain(AUTHORITY);
  });

  it('refuses to prepare for a Consumer with no Account', async () => {
    const { chain } = fakeChain();
    const { recovery } = fakeRecovery();

    await expect(
      new RecoveryChangeService(store(null), chain, recovery).start(
        USER,
        'signer-1',
      ),
    ).rejects.toThrow();
  });
});

describe('RecoveryChangeService.next', () => {
  it('is done when nothing is staged', async () => {
    const { chain } = fakeChain();
    const { recovery } = fakeRecovery({ changeIndex: null });

    const plan = await new RecoveryChangeService(store(), chain, recovery).next(
      USER,
    );

    expect(plan.done).toBe(true);
  });

  it('re-proposes a change that was staged but never reached the chain', async () => {
    const { chain } = fakeChain({ proposal: null });
    const { recovery } = fakeRecovery({ changeIndex: 8n });

    const plan = await new RecoveryChangeService(store(), chain, recovery).next(
      USER,
    );

    expect(plan.step).toBe('propose');
    expect(plan.changeIndex).toBe('8');
  });

  it('asks each signer for its own approval in turn', async () => {
    const first = fakeChain({ proposal: { approved: [] } });
    const second = fakeChain({ proposal: { approved: [PRIMARY] } });

    expect(
      (
        await new RecoveryChangeService(
          store(),
          first.chain,
          fakeRecovery({ changeIndex: 8n }).recovery,
        ).next(USER)
      ).step,
    ).toBe('approve-primary');

    const plan = await new RecoveryChangeService(
      store(),
      second.chain,
      fakeRecovery({ changeIndex: 8n }).recovery,
    ).next(USER);
    expect(plan.step).toBe('approve-approval');
    expect(plan.needsApprovalSignature).toBe(true);
  });

  it('waits out the time lock before offering the execute step', async () => {
    const approvedAt = BigInt(Math.floor(Date.now() / 1000));
    const { chain } = fakeChain({
      proposal: {
        approved: [PRIMARY, APPROVAL],
        status: 'Approved',
        statusTimestamp: approvedAt,
      },
    });
    const { recovery } = fakeRecovery({ changeIndex: 8n });

    const plan = await new RecoveryChangeService(store(), chain, recovery).next(
      USER,
    );

    expect(plan.step).toBe('waiting');
    // The deadline for rejecting it, and the moment it can be finished.
    expect(Date.parse(plan.executableAt as string)).toBeGreaterThan(Date.now());
    expect(plan.unsignedTxBase64).toBeUndefined();
  });

  it('offers the execute step once the lock has elapsed', async () => {
    const approvedAt = BigInt(Math.floor(Date.now() / 1000) - DAY - 60);
    const { chain } = fakeChain({
      proposal: {
        approved: [PRIMARY, APPROVAL],
        status: 'Approved',
        statusTimestamp: approvedAt,
      },
    });
    const { recovery } = fakeRecovery({ changeIndex: 8n });

    const plan = await new RecoveryChangeService(store(), chain, recovery).next(
      USER,
    );

    expect(plan.step).toBe('execute');
  });

  it('settles the staged rows when the change executed', async () => {
    const { chain } = fakeChain({
      proposal: { settled: true, status: 'Executed', approved: [PRIMARY] },
    });
    const { recovery, calls } = fakeRecovery({ changeIndex: 8n });

    const plan = await new RecoveryChangeService(store(), chain, recovery).next(
      USER,
    );

    expect(plan.done).toBe(true);
    expect(calls).toContain('settle:8');
  });

  it('abandons the staged rows when a fully approved change was rejected', async () => {
    // The case an approval count would get wrong. The time lock exists so an
    // approved change can still be refused, and calling that executed would
    // mark a recovery key active that never reached the signer set.
    const { chain } = fakeChain({
      proposal: {
        settled: true,
        status: 'Rejected',
        approved: [PRIMARY, APPROVAL],
      },
    });
    const { recovery, calls } = fakeRecovery({ changeIndex: 8n });

    const plan = await new RecoveryChangeService(store(), chain, recovery).next(
      USER,
    );

    expect(plan.done).toBe(true);
    expect(calls).toContain('abandon:8');
    expect(calls).not.toContain('settle:8');
  });

  it('abandons the staged rows when the change was cancelled', async () => {
    const { chain } = fakeChain({
      proposal: { settled: true, status: 'Cancelled', approved: [] },
    });
    const { recovery, calls } = fakeRecovery({ changeIndex: 8n });

    await new RecoveryChangeService(store(), chain, recovery).next(USER);

    expect(calls).toContain('abandon:8');
  });
});

describe('RecoveryChangeService.submit', () => {
  it('refuses a transaction that is not the step it prepared', async () => {
    const { chain } = fakeChain({ transactionIndex: 7n }, 'prepared-message');
    const { recovery } = fakeRecovery();
    const service = new RecoveryChangeService(store(), chain, recovery);
    await service.start(USER, 'signer-1');

    // The authority partially signs whatever arrives, so anything but the
    // exact prepared bytes would be a way to have the backend sign for you.
    await expect(
      service.submit(USER, signedFor('prepared-message')),
    ).rejects.toThrow('does not match the prepared recovery key step');
  });

  it('refuses a submission when nothing was prepared', async () => {
    const { chain } = fakeChain();
    const { recovery } = fakeRecovery();

    await expect(
      new RecoveryChangeService(store(), chain, recovery).submit(
        USER,
        signedFor('anything'),
      ),
    ).rejects.toThrow('No recovery key step is awaiting a signature');
  });

  it('refuses bytes that are not a transaction at all', async () => {
    const { chain } = fakeChain({ transactionIndex: 7n });
    const { recovery } = fakeRecovery();
    const service = new RecoveryChangeService(store(), chain, recovery);
    await service.start(USER, 'signer-1');

    await expect(service.submit(USER, 'bm90LWEtdHg=')).rejects.toThrow(
      'not a valid transaction',
    );
  });

  it('spends the prepared step so it cannot be replayed', async () => {
    const { chain, submitted } = fakeChain({ transactionIndex: 7n });
    const { recovery } = fakeRecovery();
    const service = new RecoveryChangeService(store(), chain, recovery);
    const plan = await service.start(USER, 'signer-1');

    // Sign exactly what was prepared, by reusing the fake's message.
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: new PublicKey(AUTHORITY),
        recentBlockhash: PublicKey.default.toBase58(),
        instructions: [],
      }).compileToV0Message(),
    );
    const message = Buffer.from(tx.message.serialize()).toString('base64');
    const replayable = fakeChain({ transactionIndex: 7n }, message);
    const pinned = new RecoveryChangeService(
      store(),
      replayable.chain,
      fakeRecovery().recovery,
    );
    await pinned.start(USER, 'signer-1');

    const wire = Buffer.from(tx.serialize()).toString('base64');
    await expect(pinned.submit(USER, wire)).resolves.toBe('sig-1');
    expect(replayable.submitted).toEqual([wire]);

    await expect(pinned.submit(USER, wire)).rejects.toThrow(
      'No recovery key step is awaiting a signature',
    );
    expect(plan.step).toBe('propose');
    expect(submitted).toEqual([]);
  });
});
