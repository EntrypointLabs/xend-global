import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

import type { AccountEventsService } from '../activity/account-events.service';
import type { RecoveryChallengeService } from '../recovery/recovery-challenge.service';
import type { RecoveryService } from '../recovery/recovery.service';
import type { RecoverySignerSummary } from '../recovery/recovery.service';
import { RecoveryGrantExpiredError } from '../recovery/recovery.errors';
import type { TurnkeyService } from '../turnkey/turnkey.service';
import type {
  ProposalState,
  ProvisioningChain,
  SquadsAccountRow,
  SquadsAccountStore,
} from './account.interface';
import { DeviceRotationService } from './device-rotation.service';

/**
 * The lost-phone flow. What matters here is who is allowed to move it along:
 * every step needs a proved inbox, and the approval the backend produces is
 * S3's, never S2's.
 */

const USER = 'user-1';
const PRIMARY = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
const OLD_APPROVAL = 'GkP9xL7mQwR2sT4vB6nH8jC3dF5aZ1yU2eW4rK6tN9pM';
const SETTINGS = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const AUTHORITY = 'Eo5wriQzhkJrQKEwTLMBMBDdCq1tE7QzKw8ias91pft5';
const RECOVERY_ADDRESS = Keypair.generate().publicKey.toBase58();
const NEW_APPROVAL = Keypair.generate().publicKey.toBase58();
const DAY = 24 * 60 * 60;

function account(patch: Partial<SquadsAccountRow> = {}): SquadsAccountRow {
  return {
    userId: USER,
    settingsSeed: 42n,
    settingsAddress: SETTINGS,
    vaultAddress: 'Vau1t111111111111111111111111111111111111111',
    primarySigner: PRIMARY,
    approvalSigner: OLD_APPROVAL,
    approvalSubOrgId: 'suborg-1',
    ...patch,
  };
}

function fakeStore(row: SquadsAccountRow) {
  let current = row;
  const patches: Partial<SquadsAccountRow>[] = [];

  const store: SquadsAccountStore = {
    findByUserId: () => Promise.resolve(current),
    insert: (r) => Promise.resolve(r),
    listAll: () => Promise.resolve([current]),
    findUserEmail: () => Promise.resolve('consumer@example.com'),
    withUserLock: <T>(_userId: string, fn: () => Promise<T>) => fn(),
    updateByUserId: (_userId, patch) => {
      patches.push(patch);
      current = { ...current, ...patch };
      return Promise.resolve(current);
    },
  };

  return { store, patches, read: () => current };
}

function fakeChain(proposal?: Partial<ProposalState> | null) {
  const submitted: string[] = [];
  const chain: ProvisioningChain = {
    rentPayer: AUTHORITY,
    readSettings: () =>
      Promise.resolve({ timeLockSeconds: DAY, transactionIndex: 7n }),
    policyExists: () => Promise.resolve(true),
    readProposal: () =>
      Promise.resolve(
        proposal
          ? {
              approved: [],
              rejected: [],
              settled: false,
              status: 'Active',
              statusTimestamp: null,
              ...proposal,
            }
          : null,
      ),
    compile: () =>
      Promise.resolve({
        unsignedTxBase64: Buffer.from(
          new VersionedTransaction(
            new TransactionMessage({
              payerKey: new PublicKey(AUTHORITY),
              recentBlockhash: '11111111111111111111111111111111',
              instructions: [],
            }).compileToV0Message(),
          ).serialize(),
        ).toString('base64'),
        messageBase64: 'message',
        blockhash: 'hash',
        lastValidBlockHeight: 100,
      }),
    submit: (tx) => {
      submitted.push(tx);
      return Promise.resolve('sig-1');
    },
  };
  return { chain, submitted };
}

function fakeRecovery() {
  const signed: string[] = [];
  const summary: RecoverySignerSummary = {
    id: 'signer-1',
    address: RECOVERY_ADDRESS,
    channel: 'email',
    channelValue: 'consumer@example.com',
    createdAt: new Date(0),
    status: 'active',
    removable: false,
  };

  const recovery = {
    list: () => Promise.resolve([summary]),
    approveWithRecoverySigner: (
      userId: string,
      transaction: VersionedTransaction,
    ) => {
      signed.push(userId);
      return Promise.resolve(transaction);
    },
  } as unknown as RecoveryService;

  return { recovery, signed };
}

function fakeChallenges({ valid = true } = {}) {
  const consumed: string[] = [];
  const challenges = {
    assertGrant: () =>
      valid
        ? Promise.resolve({})
        : Promise.reject(
            new RecoveryGrantExpiredError('that recovery session is not open'),
          ),
    consume: (grantId: string) => {
      consumed.push(grantId);
      return Promise.resolve();
    },
  } as unknown as RecoveryChallengeService;
  return { challenges, consumed };
}

function fakeTurnkey(address = NEW_APPROVAL) {
  return {
    ensureApprovalSigner: () =>
      Promise.resolve({ subOrganizationId: 'suborg-2', address }),
  } as unknown as TurnkeyService;
}

function fakeEvents() {
  const recorded: string[] = [];
  const changes: string[] = [];
  const stamp = (
    stage: string,
    params: { changeIndex: bigint | string; subject?: string | null },
  ) => {
    changes.push(`${stage}:${params.changeIndex}:${params.subject ?? ''}`);
    return Promise.resolve(null);
  };
  const events = {
    recordDeviceRotated: (_userId: string, signer: string) => {
      recorded.push(signer);
      return Promise.resolve(null);
    },
    recordSettingsChangeStaged: (
      _userId: string,
      params: { changeIndex: bigint; subject?: string | null; change?: string },
    ) => stamp(`staged:${params.change}`, params),
    recordSettingsChangeExecuted: (
      _userId: string,
      params: { changeIndex: string; subject?: string | null },
    ) => stamp('executed', params),
    recordSettingsChangeRejected: (
      _userId: string,
      params: { changeIndex: string; subject?: string | null },
    ) => stamp('rejected', params),
  } as unknown as AccountEventsService;
  return { events, recorded, changes };
}

function setUp({
  row = account(),
  proposal = null as Partial<ProposalState> | null,
  grantValid = true,
  newApproval = NEW_APPROVAL,
} = {}) {
  const { store, patches, read } = fakeStore(row);
  const { chain, submitted } = fakeChain(proposal);
  const { recovery, signed } = fakeRecovery();
  const { challenges, consumed } = fakeChallenges({ valid: grantValid });
  const { events, recorded, changes } = fakeEvents();

  return {
    service: new DeviceRotationService(
      store,
      chain,
      recovery,
      challenges,
      fakeTurnkey(newApproval),
      events,
    ),
    patches,
    read,
    submitted,
    signed,
    consumed,
    recorded,
    changes,
  };
}

describe('DeviceRotationService', () => {
  it('refuses to start without a proved inbox', async () => {
    const { service, patches } = setUp({ grantValid: false });

    await expect(
      service.start(USER, 'grant-1', { hardwarePublicKey: 'key' }),
    ).rejects.toBeInstanceOf(RecoveryGrantExpiredError);
    // Nothing staged, so no index is burned by a caller who cannot finish.
    expect(patches).toHaveLength(0);
  });

  it('stages the incoming signer beside the live one, never over it', async () => {
    const { service, read, changes } = setUp();

    const plan = await service.start(USER, 'grant-1', {
      hardwarePublicKey: 'key',
    });

    expect(plan.step).toBe('propose');
    expect(read().pendingApprovalSigner).toBe(NEW_APPROVAL);
    // The Account still points at the old key: the swap is not real until the
    // chain executes it, and a rejected change must leave no trace.
    expect(read().approvalSigner).toBe(OLD_APPROVAL);
    // The old phone hears about it now, not on the watcher's next pass: an
    // inbox plus a passkey can start this from anywhere, and rejecting it
    // from the old phone inside the delay is the only thing that stops it.
    expect(changes).toEqual([`staged:device:8:${NEW_APPROVAL}`]);
  });

  it('does nothing when this phone already holds the approval signer', async () => {
    const { service, patches } = setUp({ newApproval: OLD_APPROVAL });

    const plan = await service.start(USER, 'grant-1', {
      hardwarePublicKey: 'key',
    });

    expect(plan).toEqual({ done: true });
    expect(patches).toHaveLength(0);
  });

  it('asks the phone for the primary approval first', async () => {
    const { service } = setUp({
      row: account({
        pendingApprovalSigner: NEW_APPROVAL,
        pendingApprovalChangeIndex: '8',
      }),
      proposal: { approved: [] },
    });

    const plan = await service.next(USER, 'grant-1');

    expect(plan.step).toBe('approve-primary');
  });

  it('produces the recovery approval itself once the phone has signed', async () => {
    const { service, signed, consumed } = setUp({
      row: account({
        pendingApprovalSigner: NEW_APPROVAL,
        pendingApprovalChangeIndex: '8',
      }),
      proposal: { approved: [PRIMARY] },
    });

    const plan = await service.next(USER, 'grant-1');

    // S3 signed here, not on the phone, and the grant is spent on the way out.
    expect(signed).toEqual([USER]);
    expect(consumed).toEqual(['grant-1']);
    // The chain fake never records the approval, which is what an RPC lagging
    // behind looks like. One signature is sent, not a stream of them.
    expect(plan.step).toBe('approve-recovery');
    expect(signed).toHaveLength(1);
  });

  it('refuses the recovery approval when no grant is carried', async () => {
    const { service, signed } = setUp({
      row: account({
        pendingApprovalSigner: NEW_APPROVAL,
        pendingApprovalChangeIndex: '8',
      }),
      proposal: { approved: [PRIMARY] },
    });

    await expect(service.next(USER)).rejects.toThrow();
    expect(signed).toEqual([]);
  });

  it('waits out the time lock before offering execute', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const { service } = setUp({
      row: account({
        pendingApprovalSigner: NEW_APPROVAL,
        pendingApprovalChangeIndex: '8',
      }),
      proposal: {
        approved: [PRIMARY, RECOVERY_ADDRESS],
        statusTimestamp: BigInt(nowSeconds),
      },
    });

    const plan = await service.next(USER, 'grant-1');

    expect(plan.step).toBe('waiting');
    expect(new Date(plan.executableAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it('offers execute once the lock has elapsed', async () => {
    const longAgo = Math.floor(Date.now() / 1000) - DAY - 60;
    const { service } = setUp({
      row: account({
        pendingApprovalSigner: NEW_APPROVAL,
        pendingApprovalChangeIndex: '8',
      }),
      proposal: {
        approved: [PRIMARY, RECOVERY_ADDRESS],
        statusTimestamp: BigInt(longAgo),
      },
    });

    const plan = await service.next(USER, 'grant-1');

    expect(plan.step).toBe('execute');
  });

  it('commits the swap when the chain executed it', async () => {
    const { service, read, recorded, changes } = setUp({
      row: account({
        pendingApprovalSigner: NEW_APPROVAL,
        pendingApprovalSubOrgId: 'suborg-2',
        pendingApprovalChangeIndex: '8',
      }),
      proposal: { settled: true, status: 'Executed' },
    });

    const plan = await service.next(USER, 'grant-1');

    expect(plan).toEqual({ done: true });
    expect(read().approvalSigner).toBe(NEW_APPROVAL);
    expect(read().approvalSubOrgId).toBe('suborg-2');
    expect(read().pendingApprovalSigner).toBeNull();
    expect(recorded).toEqual([NEW_APPROVAL]);
    expect(changes).toEqual([`executed:8:${NEW_APPROVAL}`]);
  });

  it('forgets the swap when the change was rejected', async () => {
    const { service, read, recorded, changes } = setUp({
      row: account({
        pendingApprovalSigner: NEW_APPROVAL,
        pendingApprovalSubOrgId: 'suborg-2',
        pendingApprovalChangeIndex: '8',
      }),
      proposal: { settled: true, status: 'Rejected' },
    });

    await service.next(USER, 'grant-1');

    // A rejected rotation leaves a genuinely lost phone with no S2 at all, and
    // the row has to say so rather than name a key the chain never took.
    expect(read().approvalSigner).toBe(OLD_APPROVAL);
    expect(read().pendingApprovalSigner).toBeNull();
    expect(recorded).toEqual([]);
    expect(changes).toEqual([`rejected:8:${NEW_APPROVAL}`]);
  });
});
