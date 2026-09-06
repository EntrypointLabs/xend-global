import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

import type { AccountEventsService } from '../activity/account-events.service';
import type { RecoveryChallengeService } from '../recovery/recovery-challenge.service';
import type {
  NewRecoverySigner,
  RecoverySignerRow,
  RecoverySignerStore,
} from '../recovery/recovery-signer.store';
import type { RecoveryVault } from '../recovery/recovery-vault.interface';
import { RecoveryReleaseFrozenError } from '../recovery/recovery.errors';
import { RecoveryService } from '../recovery/recovery.service';
import type { TurnkeyService } from '../turnkey/turnkey.service';
import type {
  ProposalState,
  ProvisioningChain,
  SquadsAccountRow,
  SquadsAccountStore,
} from './account.interface';
import { DeviceRotationService } from './device-rotation.service';
import { RecoveryChangeService } from './recovery-change.service';

/**
 * The release freeze is a refusal to sign, not a power over the Account.
 *
 * Wired with the real RecoveryService so both drivers meet the same freeze:
 * the lost-phone rotation, which needs S3's vote and is refused, and a
 * recovery key change, which the Consumer's own two keys approve and which
 * the freeze cannot touch.
 */

const USER = 'user-1';
const PRIMARY = Keypair.generate().publicKey.toBase58();
const APPROVAL = Keypair.generate().publicKey.toBase58();
const SETTINGS = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const AUTHORITY = 'Eo5wriQzhkJrQKEwTLMBMBDdCq1tE7QzKw8ias91pft5';
const CONTACT = 'consumer@example.com';
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

class FakeSignerStore implements RecoverySignerStore {
  rows: RecoverySignerRow[] = [];
  frozenAt: Date | null = null;
  private seq = 0;

  withUserLock<T>(_userId: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  findByUser(userId: string): Promise<RecoverySignerRow[]> {
    return Promise.resolve(this.rows.filter((r) => r.userId === userId));
  }

  findByAddress(address: string): Promise<RecoverySignerRow | null> {
    return Promise.resolve(
      this.rows.find((r) => r.address === address) ?? null,
    );
  }

  insert(row: NewRecoverySigner): Promise<RecoverySignerRow> {
    const created: RecoverySignerRow = {
      id: `signer-${++this.seq}`,
      userId: row.userId,
      address: row.address,
      channel: row.channel,
      channelValue: row.channelValue,
      sealedKey: row.sealedKey ?? null,
      sealedKeyId: row.sealedKeyId ?? null,
      status: row.status ?? 'active',
      changeIndex: row.changeIndex ?? null,
      changeSignature: row.changeSignature ?? null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    this.rows.push(created);
    return Promise.resolve(created);
  }

  deleteById(id: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== id);
    return Promise.resolve();
  }

  updateById(
    id: string,
    patch: Partial<NewRecoverySigner>,
  ): Promise<RecoverySignerRow> {
    const target = this.rows.find((r) => r.id === id)!;
    Object.assign(target, patch);
    return Promise.resolve(target);
  }

  findContactEmail(): Promise<string | null> {
    return Promise.resolve(CONTACT);
  }

  updateContactEmail(): Promise<void> {
    return Promise.resolve();
  }

  isContactEmailTaken(): Promise<boolean> {
    return Promise.resolve(false);
  }
  isEmailClaimStaged(): Promise<boolean> {
    return Promise.resolve(false);
  }

  findReleaseFreeze(): Promise<Date | null> {
    return Promise.resolve(this.frozenAt);
  }

  setReleaseFreeze(_userId: string, frozenAt: Date | null): Promise<void> {
    this.frozenAt = frozenAt;
    return Promise.resolve();
  }
}

const vault: RecoveryVault = {
  seal: (secret) =>
    Promise.resolve({
      ciphertext: Buffer.from(secret).toString('base64'),
      keyId: 'test',
    }),
  open: (sealed) =>
    Promise.resolve(new Uint8Array(Buffer.from(sealed.ciphertext, 'base64'))),
};

/** A chain whose proposal state the test moves along by hand. */
function fakeChain() {
  let proposal: ProposalState | null = null;
  const chain: ProvisioningChain = {
    rentPayer: AUTHORITY,
    readSettings: () =>
      Promise.resolve({ timeLockSeconds: DAY, transactionIndex: 7n }),
    policyExists: () => Promise.resolve(true),
    readProposal: () => Promise.resolve(proposal),
    compile: () =>
      Promise.resolve({
        unsignedTxBase64: Buffer.from(
          new VersionedTransaction(
            new TransactionMessage({
              payerKey: new PublicKey(AUTHORITY),
              recentBlockhash: PublicKey.default.toBase58(),
              instructions: [],
            }).compileToV0Message(),
          ).serialize(),
        ).toString('base64'),
        messageBase64: 'message',
        blockhash: 'hash',
        lastValidBlockHeight: 100,
      }),
    submit: () => Promise.resolve('sig-1'),
  };
  return {
    chain,
    set: (next: Partial<ProposalState>) => {
      proposal = {
        approved: [],
        rejected: [],
        settled: false,
        status: 'Active',
        statusTimestamp: null,
        ...next,
      };
    },
  };
}

function setUp() {
  const signers = new FakeSignerStore();
  const recovery = new RecoveryService(signers, vault, {
    recordRecoveryKeyAdded: () => Promise.resolve(null),
    recordRecoveryKeyRemoved: () => Promise.resolve(null),
    recordContactEmailChanged: () => Promise.resolve(null),
  } as unknown as AccountEventsService);

  const patches: Partial<SquadsAccountRow>[] = [];
  const accounts: SquadsAccountStore = {
    findByUserId: () => Promise.resolve(ACCOUNT),
    insert: (r) => Promise.resolve(r),
    listAll: () => Promise.resolve([ACCOUNT]),
    findUserEmail: () => Promise.resolve(CONTACT),
    withUserLock: <T>(_userId: string, fn: () => Promise<T>) => fn(),
    updateByUserId: (_userId, patch) => {
      patches.push(patch);
      return Promise.resolve({ ...ACCOUNT, ...patch });
    },
  };

  const { chain, set } = fakeChain();
  const challenges = {
    assertGrant: () => Promise.resolve({ target: CONTACT }),
    consume: () => Promise.resolve(),
  } as unknown as RecoveryChallengeService;
  const turnkey = {
    ensureApprovalSigner: () =>
      Promise.resolve({
        subOrganizationId: 'suborg-2',
        address: Keypair.generate().publicKey.toBase58(),
      }),
  } as unknown as TurnkeyService;

  return {
    recovery,
    signers,
    patches,
    setProposal: set,
    rotations: new DeviceRotationService(
      accounts,
      chain,
      recovery,
      challenges,
      turnkey,
      {
        recordDeviceRotated: () => Promise.resolve(null),
        recordSettingsChangeStaged: () => Promise.resolve(null),
        recordSettingsChangeExecuted: () => Promise.resolve(null),
        recordSettingsChangeRejected: () => Promise.resolve(null),
      } as unknown as AccountEventsService,
    ),
    changes: new RecoveryChangeService(accounts, chain, recovery, {
      recordSettingsChangeStaged: () => Promise.resolve(null),
      recordSettingsChangeExecuted: () => Promise.resolve(null),
      recordSettingsChangeRejected: () => Promise.resolve(null),
    } as unknown as AccountEventsService),
  };
}

describe('recovery release freeze', () => {
  it('stops a device rotation being started on the strength of the inbox', async () => {
    const { recovery, rotations, patches } = setUp();
    await recovery.provisionEmailSigner(USER, CONTACT);
    await recovery.freezeRelease(USER);

    await expect(
      rotations.start(USER, 'grant-1', { hardwarePublicKey: 'key' }),
    ).rejects.toBeInstanceOf(RecoveryReleaseFrozenError);
    expect(patches).toHaveLength(0);
  });

  it('leaves a recovery key change by the passkey and the phone untouched', async () => {
    const { recovery, changes, setProposal } = setUp();
    await recovery.provisionEmailSigner(USER, CONTACT);
    await recovery.freezeRelease(USER);

    const wallet = Keypair.generate().publicKey.toBase58();
    const added = await recovery.addExternalWallet(USER, wallet);
    const started = await changes.start(USER, added.id);
    expect(started.step).toBe('propose');

    // Both approvals come from the Consumer's own keys. S3 is never asked,
    // so there is nothing for the freeze to refuse.
    setProposal({
      approved: [PRIMARY, APPROVAL],
      status: 'Approved',
      statusTimestamp: BigInt(Math.floor(Date.now() / 1000) - DAY - 60),
    });
    expect((await changes.next(USER)).step).toBe('execute');

    setProposal({ settled: true, status: 'Executed' });
    expect((await changes.next(USER)).done).toBe(true);
    expect(
      (await recovery.list(USER)).find((s) => s.address === wallet)?.status,
    ).toBe('active');
  });

  it('lets the rotation through again once the freeze is lifted', async () => {
    const { recovery, rotations, patches } = setUp();
    await recovery.provisionEmailSigner(USER, CONTACT);
    await recovery.freezeRelease(USER);
    await recovery.unfreezeRelease(USER);

    const plan = await rotations.start(USER, 'grant-1', {
      hardwarePublicKey: 'key',
    });

    expect(plan.step).toBe('propose');
    expect(patches).toHaveLength(1);
  });
});
