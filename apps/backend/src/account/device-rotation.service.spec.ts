import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

import type { AccountEventsService } from '../activity/account-events.service';
import { InMemoryPreparedTxStore } from '../prepared/prepared-tx.memory';
import type { RecoveryChallengeService } from '../recovery/recovery-challenge.service';
import type { RecoveryService } from '../recovery/recovery.service';
import type { RecoverySignerSummary } from '../recovery/recovery.service';
import {
  RecoveryGrantExpiredError,
  RecoveryReleaseFrozenError,
  UnknownRecoverySignerError,
} from '../recovery/recovery.errors';
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

function fakeChain(
  proposal?: Partial<ProposalState> | null,
  signers: string[] = [PRIMARY, OLD_APPROVAL, RECOVERY_ADDRESS],
) {
  const submitted: string[] = [];
  const chain: ProvisioningChain = {
    rentPayer: AUTHORITY,
    readSettings: () =>
      Promise.resolve({
        timeLockSeconds: DAY,
        transactionIndex: 7n,
        policySeed: null,
        signers: signers.map((key) => ({
          key: new PublicKey(key),
          permissions: { mask: 7 },
        })),
      }),
    readSpendingLimit: () =>
      Promise.reject(new Error('readSpendingLimit is not exercised here')),
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

const CONTACT = 'consumer@example.com';

/** A second sealed signer on the Account, anchored on a different inbox. */
const OTHER_RECOVERY_ADDRESS = Keypair.generate().publicKey.toBase58();

function fakeRecovery({ frozen = false } = {}) {
  /** `signerId` of every approval produced. */
  const signed: string[] = [];
  const signers: RecoverySignerSummary[] = [
    {
      id: 'signer-1',
      address: RECOVERY_ADDRESS,
      channel: 'email',
      channelValue: CONTACT,
      createdAt: new Date(0),
      status: 'active',
      removable: false,
      isContactAddress: true,
    },
    {
      id: 'signer-2',
      address: OTHER_RECOVERY_ADDRESS,
      channel: 'email',
      channelValue: 'other@example.com',
      createdAt: new Date(0),
      status: 'active',
      removable: true,
      isContactAddress: false,
    },
  ];

  const recovery = {
    list: () => Promise.resolve(signers),
    signerAnchoredOn: (_userId: string, email: string) => {
      const found = signers.find((s) => s.channelValue === email);
      return found
        ? Promise.resolve(found)
        : Promise.reject(
            new UnknownRecoverySignerError('no signer on that address'),
          );
    },
    assertReleaseAllowed: () =>
      frozen
        ? Promise.reject(new RecoveryReleaseFrozenError('paused'))
        : Promise.resolve(),
    approveWithRecoverySigner: (
      _userId: string,
      transaction: VersionedTransaction,
      signerId: string,
    ) => {
      if (frozen) {
        return Promise.reject(new RecoveryReleaseFrozenError('paused'));
      }
      signed.push(signerId);
      return Promise.resolve(transaction);
    },
  } as unknown as RecoveryService;

  return { recovery, signed };
}

function fakeChallenges({ valid = true, target = CONTACT } = {}) {
  const consumed: string[] = [];
  const challenges = {
    assertGrant: () =>
      valid
        ? Promise.resolve({ target })
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
  grantTarget = CONTACT,
  frozen = false,
  newApproval = NEW_APPROVAL,
  /** The Settings signer set as the chain reports it. */
  signers = undefined as string[] | undefined,
} = {}) {
  const { store, patches, read } = fakeStore(row);
  const { chain, submitted } = fakeChain(proposal, signers);
  const { recovery, signed } = fakeRecovery({ frozen });
  const { challenges, consumed } = fakeChallenges({
    valid: grantValid,
    target: grantTarget,
  });
  const { events, recorded, changes } = fakeEvents();

  return {
    service: new DeviceRotationService(
      store,
      chain,
      recovery,
      challenges,
      fakeTurnkey(newApproval),
      events,
      new InMemoryPreparedTxStore(),
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
    expect(signed).toEqual(['signer-1']);
    expect(consumed).toEqual(['grant-1']);
    // The chain fake never records the approval, which is what an RPC lagging
    // behind looks like. One signature is sent, not a stream of them.
    expect(plan.step).toBe('approve-recovery');
    expect(signed).toHaveLength(1);
  });

  it('signs with the signer anchored on the inbox the code went to', async () => {
    const { service, signed } = setUp({
      row: account({
        pendingApprovalSigner: NEW_APPROVAL,
        pendingApprovalChangeIndex: '8',
      }),
      proposal: { approved: [PRIMARY] },
      grantTarget: 'other@example.com',
    });

    await service.next(USER, 'grant-1');

    // Two sealed keys on the Account, one inbox proved. The key that signs is
    // the one that inbox anchors, not whichever row came first.
    expect(signed).toEqual(['signer-2']);
  });

  it('refuses a grant whose inbox anchors no signer on this Account', async () => {
    const { service, signed } = setUp({
      row: account({
        pendingApprovalSigner: NEW_APPROVAL,
        pendingApprovalChangeIndex: '8',
      }),
      proposal: { approved: [PRIMARY] },
      grantTarget: 'stranger@example.com',
    });

    await expect(service.next(USER, 'grant-1')).rejects.toBeInstanceOf(
      UnknownRecoverySignerError,
    );
    expect(signed).toEqual([]);
  });

  it('treats any held signer having approved as S3 being in', async () => {
    const { service, signed } = setUp({
      row: account({
        pendingApprovalSigner: NEW_APPROVAL,
        pendingApprovalChangeIndex: '8',
      }),
      proposal: { approved: [PRIMARY, OTHER_RECOVERY_ADDRESS] },
    });

    const plan = await service.next(USER, 'grant-1');

    expect(signed).toEqual([]);
    expect(plan.step).not.toBe('approve-recovery');
  });

  it('refuses to start while support has frozen the recovery release', async () => {
    const { service, patches } = setUp({ frozen: true });

    await expect(
      service.start(USER, 'grant-1', { hardwarePublicKey: 'key' }),
    ).rejects.toBeInstanceOf(RecoveryReleaseFrozenError);
    // Refused before anything is staged, so no index is burned on a change
    // that could never collect S3's vote.
    expect(patches).toHaveLength(0);
  });

  it('withholds S3 from a change already staged while frozen', async () => {
    const { service, signed } = setUp({
      row: account({
        pendingApprovalSigner: NEW_APPROVAL,
        pendingApprovalChangeIndex: '8',
      }),
      proposal: { approved: [PRIMARY] },
      frozen: true,
    });

    await expect(service.next(USER, 'grant-1')).rejects.toBeInstanceOf(
      RecoveryReleaseFrozenError,
    );
    expect(signed).toEqual([]);
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
      signers: [PRIMARY, NEW_APPROVAL, RECOVERY_ADDRESS],
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

describe('DeviceRotationService against a signer set that disagrees', () => {
  const staged = () =>
    account({
      pendingApprovalSigner: NEW_APPROVAL,
      pendingApprovalSubOrgId: 'suborg-2',
      pendingApprovalChangeIndex: '8',
    });

  it('refuses to commit an executed index the signer set does not reflect', async () => {
    const { service, read, recorded } = setUp({
      row: staged(),
      proposal: { settled: true, status: 'Executed' },
      signers: [PRIMARY, OLD_APPROVAL, RECOVERY_ADDRESS],
    });

    // Something executed at index 8, but the Account still names the old key.
    // Naming the new one in the row would hand S2 to a phone the chain never
    // admitted.
    await expect(service.next(USER, 'grant-1')).rejects.toThrow(
      'did not install the staged approval signer',
    );
    expect(read().approvalSigner).toBe(OLD_APPROVAL);
    expect(read().pendingApprovalSigner).toBe(NEW_APPROVAL);
    expect(recorded).toEqual([]);
  });

  it('clears a staged index the chain has moved past without a proposal', async () => {
    const { service, read, changes } = setUp({
      row: account({
        pendingApprovalSigner: NEW_APPROVAL,
        pendingApprovalChangeIndex: '5',
      }),
      proposal: null,
    });

    // Index 5 is behind the chain's 7 and nothing was ever proposed there, so
    // it can never be proposed now. Left alone, every start would refuse
    // forever.
    const plan = await service.next(USER, 'grant-1');

    expect(plan).toEqual({ done: true });
    expect(read().pendingApprovalSigner).toBeNull();
    expect(read().pendingApprovalChangeIndex).toBeNull();
    expect(read().approvalSigner).toBe(OLD_APPROVAL);
    expect(changes).toEqual([`rejected:5:${NEW_APPROVAL}`]);
  });

  it('commits a rotation whose proposal is gone but whose key is in place', async () => {
    const { service, read, recorded } = setUp({
      row: account({
        pendingApprovalSigner: NEW_APPROVAL,
        pendingApprovalSubOrgId: 'suborg-2',
        pendingApprovalChangeIndex: '5',
      }),
      proposal: null,
      signers: [PRIMARY, NEW_APPROVAL, RECOVERY_ADDRESS],
    });

    await service.next(USER, 'grant-1');

    expect(read().approvalSigner).toBe(NEW_APPROVAL);
    expect(read().pendingApprovalSigner).toBeNull();
    expect(recorded).toEqual([NEW_APPROVAL]);
  });

  it('keeps re-proposing a staged index that is still the next one', async () => {
    const { service, read } = setUp({
      row: staged(),
      proposal: null,
    });

    const plan = await service.next(USER, 'grant-1');

    expect(plan.step).toBe('propose');
    expect(read().pendingApprovalChangeIndex).toBe('8');
  });
});

describe('DeviceRotationService.start with a change already staged', () => {
  const other = Keypair.generate().publicKey.toBase58();

  it('refuses a second phone while the first is still on chain', async () => {
    const { service, read, patches } = setUp({
      row: account({
        pendingApprovalSigner: other,
        pendingApprovalChangeIndex: '8',
      }),
      proposal: { approved: [PRIMARY] },
    });

    await expect(
      service.start(USER, 'grant-1', { hardwarePublicKey: 'key' }),
    ).rejects.toThrow('already in flight');
    expect(patches).toHaveLength(0);
    expect(read().pendingApprovalSigner).toBe(other);
  });

  it('refuses a second phone while the first is staged but not yet proposed', async () => {
    const { service, read } = setUp({
      row: account({
        pendingApprovalSigner: other,
        pendingApprovalChangeIndex: '8',
      }),
      proposal: null,
    });

    await expect(
      service.start(USER, 'grant-1', { hardwarePublicKey: 'key' }),
    ).rejects.toThrow('already in flight');
    expect(read().pendingApprovalSigner).toBe(other);
  });

  it('clears a stale index and stages afresh', async () => {
    const { service, read, changes } = setUp({
      row: account({
        pendingApprovalSigner: other,
        pendingApprovalChangeIndex: '5',
      }),
      proposal: null,
    });

    const plan = await service.start(USER, 'grant-1', {
      hardwarePublicKey: 'key',
    });

    expect(plan.step).toBe('propose');
    expect(read().pendingApprovalSigner).toBe(NEW_APPROVAL);
    expect(read().pendingApprovalChangeIndex).toBe('8');
    expect(changes).toEqual([
      `rejected:5:${other}`,
      `staged:device:8:${NEW_APPROVAL}`,
    ]);
  });

  it('refuses to race a passkey replacement already in flight', async () => {
    const { service, patches } = setUp({
      row: account({ pendingPrimaryChangeIndex: '8' }),
    });

    await expect(
      service.start(USER, 'grant-1', { hardwarePublicKey: 'key' }),
    ).rejects.toThrow('already in flight');
    expect(patches).toHaveLength(0);
  });

  it('refuses to race a Spending Limit change already holding the index', async () => {
    const { service, patches } = setUp({
      row: account({ pendingSpendingLimitChangeIndex: '8' }),
    });

    await expect(
      service.start(USER, 'grant-1', { hardwarePublicKey: 'key' }),
    ).rejects.toThrow('already in flight');
    expect(patches).toHaveLength(0);
  });
});
