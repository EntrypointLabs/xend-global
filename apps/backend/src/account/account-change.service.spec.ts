import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { SETTINGS_TIME_LOCK_SECONDS } from '@xend/smart-account';

import { AccountChangeService } from './account-change.service';
import type { AccountEventsService } from '../activity/account-events.service';
import { InMemoryPreparedTxStore } from '../prepared/prepared-tx.memory';
import type { RecoveryService } from '../recovery/recovery.service';
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

const USER = 'user-1';
const PRIMARY = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
const APPROVAL = 'GkP9xL7mQwR2sT4vB6nH8jC3dF5aZ1yU2eW4rK6tN9pM';
const SETTINGS = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const AUTHORITY = 'Eo5wriQzhkJrQKEwTLMBMBDdCq1tE7QzKw8ias91pft5';

const ACCOUNT: SquadsAccountRow = {
  userId: USER,
  settingsSeed: 42n,
  settingsAddress: SETTINGS,
  vaultAddress: 'Vau1t111111111111111111111111111111111111111',
  primarySigner: PRIMARY,
  approvalSigner: APPROVAL,
  approvalSubOrgId: 'suborg-1',
};

function store(row: SquadsAccountRow | null = ACCOUNT): SquadsAccountStore {
  return {
    findByUserId: () => Promise.resolve(row),
    insert: (r) => Promise.resolve(r),
    listAll: () => Promise.resolve(row ? [row] : []),
    findUserEmail: () => Promise.resolve('consumer@example.com'),
    withUserLock: <T>(_userId: string, fn: () => Promise<T>) => fn(),
    updateByUserId: () =>
      Promise.reject(new Error('updateByUserId is not exercised here')),
  };
}

interface ChainState {
  /** Provisioned by default, which is when a staged change is worth telling. */
  provisioned?: boolean;
  transactionIndex?: bigint;
  proposal?: Partial<ProposalState> | null;
}

function fakeChain(state: ChainState = {}, messageBase64 = 'message') {
  const submitted: string[] = [];
  const compiled: unknown[][] = [];
  const provisioned = state.provisioned ?? true;

  const chain: ProvisioningChain = {
    rentPayer: AUTHORITY,
    readSettings: () =>
      Promise.resolve({
        timeLockSeconds: provisioned ? SETTINGS_TIME_LOCK_SECONDS : 0,
        transactionIndex: state.transactionIndex ?? 7n,
        policySeed: null,
        signers: [],
      }),
    readSpendingLimit: () =>
      Promise.reject(new Error('readSpendingLimit is not exercised here')),
    policyExists: (_settings, seed) =>
      Promise.resolve(
        provisioned &&
          [SPENDING_LIMIT_POLICY_SEED, ABOVE_LIMIT_POLICY_SEED].includes(seed),
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
      compiled.push(params.instructions);
      return Promise.resolve({
        unsignedTxBase64: 'unsigned',
        messageBase64,
        blockhash: 'hash',
        lastValidBlockHeight: 100,
      });
    },
    submit: (tx) => {
      submitted.push(tx);
      return Promise.resolve('sig-reject');
    },
  };

  return { chain, submitted, compiled };
}

/** Only what AccountChangeService reaches on RecoveryService. */
function fakeRecovery(changeIndex: bigint | null = null) {
  const abandoned: string[] = [];
  const recovery = {
    pendingChange: () =>
      Promise.resolve(
        changeIndex === null ? null : { signerId: 'signer-1', changeIndex },
      ),
    abandon: (_userId: string, at: bigint) => {
      abandoned.push(at.toString());
      return Promise.resolve();
    },
  } as unknown as RecoveryService;
  return { recovery, abandoned };
}

/** Only what a rejection records. */
function fakeEvents() {
  const rejected: string[] = [];
  const events = {
    recordSettingsChangeRejected: (
      _userId: string,
      params: { changeIndex: string; signature?: string | null },
    ) => {
      rejected.push(`${params.changeIndex}:${params.signature ?? ''}`);
      return Promise.resolve(null);
    },
  } as unknown as AccountEventsService;
  return { events, rejected };
}

function service(
  chain: ProvisioningChain,
  row?: SquadsAccountRow | null,
  recovery: RecoveryService = fakeRecovery().recovery,
  events: AccountEventsService = fakeEvents().events,
) {
  return new AccountChangeService(
    store(row),
    chain,
    recovery,
    events,
    new InMemoryPreparedTxStore(),
  );
}

function signable() {
  const message = new TransactionMessage({
    payerKey: new PublicKey(AUTHORITY),
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  return {
    base64: Buffer.from(tx.serialize()).toString('base64'),
    messageBase64: Buffer.from(message.serialize()).toString('base64'),
  };
}

describe('AccountChangeService.pending', () => {
  it('reports a change staged against a provisioned Account', async () => {
    const approvedAt = 1_700_000_000n;
    const { chain } = fakeChain({
      proposal: { status: 'Approved', statusTimestamp: approvedAt },
    });

    const staged = await service(chain).pending(USER);

    expect(staged?.transactionIndex).toBe('7');
    // The deadline for rejecting, which is the only thing the time lock buys.
    expect(staged?.executableAt).toBe(
      new Date(
        Number(approvedAt + BigInt(SETTINGS_TIME_LOCK_SECONDS)) * 1000,
      ).toISOString(),
    );
  });

  it('says nothing while the Consumer is still provisioning', async () => {
    const { chain } = fakeChain({
      provisioned: false,
      proposal: { status: 'Active' },
    });

    // Provisioning is a settings change the Consumer is making themselves, in
    // the foreground. Warning them about it teaches them to dismiss the notice
    // that matters later.
    await expect(service(chain).pending(USER)).resolves.toBeNull();
  });

  it('says nothing about a change that is already settled', async () => {
    const { chain } = fakeChain({
      proposal: { status: 'Executed', settled: true },
    });

    await expect(service(chain).pending(USER)).resolves.toBeNull();
  });

  it('says nothing when no change is in flight', async () => {
    const { chain } = fakeChain({ proposal: null });

    await expect(service(chain).pending(USER)).resolves.toBeNull();
  });
});

describe('AccountChangeService self-initiated changes', () => {
  it('flags a change the Consumer started from their own app', async () => {
    const { chain } = fakeChain({ proposal: { status: 'Active' } });
    const { recovery } = fakeRecovery(7n);

    const staged = await service(chain, undefined, recovery).pending(USER);

    // A staged recovery key row carrying this index only exists for a change
    // proposed through our own endpoint.
    expect(staged?.selfInitiated).toBe(true);
  });

  it('does not flag a change nobody here staged', async () => {
    const { chain } = fakeChain({ proposal: { status: 'Active' } });
    const { recovery } = fakeRecovery(null);

    const staged = await service(chain, undefined, recovery).pending(USER);

    // The case the whole announcement exists for: a change this backend has no
    // record of, which is what a stolen quorum looks like.
    expect(staged?.selfInitiated).toBe(false);
  });

  it('does not flag a change staged at a different index', async () => {
    const { chain } = fakeChain({ proposal: { status: 'Active' } });
    const { recovery } = fakeRecovery(99n);

    const staged = await service(chain, undefined, recovery).pending(USER);

    expect(staged?.selfInitiated).toBe(false);
  });
});

describe('AccountChangeService rejection', () => {
  it('refuses to prepare a rejection when nothing is staged', async () => {
    const { chain } = fakeChain({ proposal: null });

    await expect(service(chain).prepareRejection(USER)).rejects.toThrow();
  });

  it('rejects with both on-device signers, because one is not a refusal', async () => {
    const { chain, compiled } = fakeChain({ proposal: { status: 'Active' } });

    await service(chain).prepareRejection(USER);

    // At a threshold of 2 of 3 a single rejection is recorded and the change
    // stays open, so a one-signature rejection would report success and stop
    // nothing. Verified against the deployed program in the smart-account
    // package. S2 leads so Turnkey evaluates the finished payload.
    const signers = compiled[0].map((ix) =>
      (
        ix as { keys: { pubkey: { toBase58(): string }; isSigner: boolean }[] }
      ).keys
        .filter((k) => k.isSigner)
        .map((k) => k.pubkey.toBase58()),
    );
    expect(compiled[0]).toHaveLength(2);
    expect(signers[0]).toContain(APPROVAL);
    expect(signers[1]).toContain(PRIMARY);
  });

  it('skips a signer that has already rejected', async () => {
    const { chain, compiled } = fakeChain({
      proposal: { status: 'Active', rejected: [PRIMARY] },
    });

    await service(chain).prepareRejection(USER);

    // The state a half-finished rejection leaves behind. Re-sending the vote
    // that already landed fails the whole transaction, which would make the
    // change permanently unrejectable from this device.
    expect(compiled[0]).toHaveLength(1);
  });

  it('refuses when both on-device signers have already rejected', async () => {
    const { chain } = fakeChain({
      proposal: { status: 'Active', rejected: [PRIMARY, APPROVAL] },
    });

    await expect(service(chain).prepareRejection(USER)).rejects.toThrow();
  });

  it('submits the rejection it prepared', async () => {
    const tx = signable();
    const { chain, submitted } = fakeChain(
      { proposal: { status: 'Active' } },
      tx.messageBase64,
    );
    const changes = service(chain);

    await changes.prepareRejection(USER);
    const signature = await changes.submitRejection(USER, tx.base64);

    expect(submitted).toEqual([tx.base64]);
    expect(signature).toBe('sig-reject');
  });

  it('refuses a transaction that is not the prepared rejection', async () => {
    const { chain, submitted } = fakeChain(
      { proposal: { status: 'Active' } },
      'a-different-message',
    );
    const changes = service(chain);

    await changes.prepareRejection(USER);

    // The authority signs whatever arrives here, so unpinned this endpoint
    // would sign anything naming it as fee payer.
    await expect(
      changes.submitRejection(USER, signable().base64),
    ).rejects.toThrow();
    expect(submitted).toEqual([]);
  });

  it('puts a staged recovery key back when its change is rejected', async () => {
    const tx = signable();
    const { chain } = fakeChain(
      { proposal: { status: 'Active' } },
      tx.messageBase64,
    );
    const { recovery, abandoned } = fakeRecovery(7n);
    const svc = service(chain, undefined, recovery);

    await svc.prepareRejection(USER);
    await svc.submitRejection(USER, tx.base64);

    // A rejected change never reaches the signer set, so a key staged against
    // it would otherwise read as pending forever and block the next change.
    expect(abandoned).toEqual(['7']);
  });

  it('records the rejection against the change it decided', async () => {
    const tx = signable();
    const { chain } = fakeChain(
      { proposal: { status: 'Active' } },
      tx.messageBase64,
    );
    const { events, rejected } = fakeEvents();
    const svc = service(chain, undefined, undefined, events);

    await svc.prepareRejection(USER);
    await svc.submitRejection(USER, tx.base64);

    // The index was pinned at prepare time: once the rejection lands the
    // proposal is settled and no longer reads as pending, so it cannot be
    // looked up afterwards.
    expect(rejected).toEqual(['7:sig-reject']);
  });

  it('refuses a submission with no rejection awaiting a signature', async () => {
    const { chain } = fakeChain({ proposal: { status: 'Active' } });

    await expect(
      service(chain).submitRejection(USER, signable().base64),
    ).rejects.toThrow();
  });
});
