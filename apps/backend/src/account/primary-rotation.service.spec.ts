import { Keypair, PublicKey } from '@solana/web3.js';
import {
  deriveAccountAddresses,
  derivePolicyAddress,
} from '@xend/smart-account';

import type { AccountEventsService } from '../activity/account-events.service';
import type { DbService } from '../db/db.service';
import type { RecoveryChallengeService } from '../recovery/recovery-challenge.service';
import type { RecoveryService } from '../recovery/recovery.service';
import { RecoveryReleaseFrozenError } from '../recovery/recovery.errors';
import { InMemoryPreparedTxStore } from '../prepared/prepared-tx.memory';
import type { WalletProvider } from '../wallet/wallet-provider.interface';
import { PasskeyInUseError } from './account.errors';
import {
  SPENDING_LIMIT_POLICY_SEED,
  type ProvisioningChain,
  type SquadsAccountRow,
  type SquadsAccountStore,
} from './account.interface';
import { PrimaryRotationService } from './primary-rotation.service';

/**
 * The lost-passkey flow. What matters here is what may be staged at all: the
 * incoming signer comes off a verified identity token, a credential bound to
 * another account is refused, and the binding only moves when the chain says
 * the change executed.
 */

const USER = 'user-1';
const OLD_PRIMARY = Keypair.generate().publicKey.toBase58();
const NEW_PRIMARY = Keypair.generate().publicKey.toBase58();
const APPROVAL = Keypair.generate().publicKey.toBase58();
const NEW_DID = 'did:privy:new';

function account(patch: Partial<SquadsAccountRow> = {}): SquadsAccountRow {
  return {
    userId: USER,
    settingsSeed: 42n,
    settingsAddress: Keypair.generate().publicKey.toBase58(),
    vaultAddress: Keypair.generate().publicKey.toBase58(),
    primarySigner: OLD_PRIMARY,
    approvalSigner: APPROVAL,
    approvalSubOrgId: 'suborg-1',
    ...patch,
  };
}

function fakeStore(row: SquadsAccountRow) {
  let current = row;
  const patches: Partial<SquadsAccountRow>[] = [];
  const store = {
    findByUserId: () => Promise.resolve(current),
    withUserLock: <T>(_userId: string, fn: () => Promise<T>) => fn(),
    updateByUserId: (
      _userId: string,
      patch: Partial<SquadsAccountRow>,
    ): Promise<SquadsAccountRow> => {
      patches.push(patch);
      current = { ...current, ...patch };
      return Promise.resolve(current);
    },
  } as unknown as SquadsAccountStore;
  return { store, patches, read: () => current };
}

function fakeDb(boundElsewhere: boolean) {
  const rebinds: Record<string, unknown>[] = [];
  const db = {
    client: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve(
                boundElsewhere ? [{ userId: 'somebody-else' }] : [],
              ),
          }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            rebinds.push(values);
            return Promise.resolve();
          },
        }),
      }),
    },
  } as unknown as DbService;
  return { db, rebinds };
}

function fakeEvents() {
  const recorded: string[] = [];
  const events = {
    recordSettingsChangeStaged: () => {
      recorded.push('staged');
      return Promise.resolve(null);
    },
    recordSettingsChangeExecuted: () => {
      recorded.push('executed');
      return Promise.resolve(null);
    },
    recordSettingsChangeRejected: () => {
      recorded.push('rejected');
      return Promise.resolve(null);
    },
    recordPasskeyEnrolled: () => {
      recorded.push('passkey_enrolled');
      return Promise.resolve(null);
    },
  } as unknown as AccountEventsService;
  return { events, recorded };
}

function setUp(opts: {
  row?: SquadsAccountRow;
  frozen?: boolean;
  boundElsewhere?: boolean;
  proposalStatus?: 'Executed' | 'Rejected';
  /** The Settings signer set as the chain reports it. */
  signers?: string[];
}) {
  const row = opts.row ?? account();
  const { store, patches, read } = fakeStore(row);
  const { db, rebinds } = fakeDb(opts.boundElsewhere ?? false);
  const { events, recorded } = fakeEvents();

  const chain = {
    rentPayer: Keypair.generate().publicKey.toBase58(),
    readSettings: () =>
      Promise.resolve({
        timeLockSeconds: 86_400,
        transactionIndex: 7n,
        policySeed: null,
        signers: (opts.signers ?? [OLD_PRIMARY, APPROVAL]).map((key) => ({
          key: new PublicKey(key),
          permissions: { mask: 7 },
        })),
      }),
    readSpendingLimit: () =>
      Promise.resolve({
        policy: derivePolicyAddress(
          deriveAccountAddresses(row.settingsSeed).settings,
          SPENDING_LIMIT_POLICY_SEED,
        ),
        mint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
        maxPerUse: 100_000_000n,
        maxPerPeriod: 500_000_000n,
        remainingInPeriod: 500_000_000n,
        period: 'Daily',
        destinations: [],
      }),
    readProposal: () =>
      Promise.resolve(
        opts.proposalStatus
          ? {
              settled: true,
              status: opts.proposalStatus,
              approved: [],
              statusTimestamp: 0n,
            }
          : null,
      ),
    compile: () =>
      Promise.resolve({
        unsignedTxBase64: '',
        messageBase64: 'msg',
        blockhash: 'hash',
        lastValidBlockHeight: 1,
      }),
    submit: () => Promise.resolve('sig'),
  } as unknown as ProvisioningChain;

  const service = new PrimaryRotationService(
    store,
    chain,
    {
      verifyIdToken: () =>
        Promise.resolve({
          providerUserId: NEW_DID,
          email: null,
          walletAddress: NEW_PRIMARY,
          passkeys: [],
        }),
    } as unknown as WalletProvider,
    {
      assertReleaseAllowed: () =>
        opts.frozen
          ? Promise.reject(new RecoveryReleaseFrozenError('release is frozen'))
          : Promise.resolve(),
      list: () => Promise.resolve([]),
    } as unknown as RecoveryService,
    {
      assertGrant: () => Promise.resolve({ target: 'consumer@example.com' }),
      consume: () => Promise.resolve(),
    } as unknown as RecoveryChallengeService,
    events,
    db,
    { registerWebhookAddress: () => Promise.resolve() } as never,
    new InMemoryPreparedTxStore(),
  );

  return { service, patches, read, rebinds, recorded };
}

describe('PrimaryRotationService.start', () => {
  it('refuses to stage anything while recovery release is frozen', async () => {
    const { service, patches } = setUp({ frozen: true });
    await expect(
      service.start(USER, 'grant-1', 'token'),
    ).rejects.toBeInstanceOf(RecoveryReleaseFrozenError);
    expect(patches).toHaveLength(0);
  });

  it('refuses a passkey already bound to another account', async () => {
    const { service, patches } = setUp({ boundElsewhere: true });
    await expect(
      service.start(USER, 'grant-1', 'token'),
    ).rejects.toBeInstanceOf(PasskeyInUseError);
    expect(patches).toHaveLength(0);
  });

  it('is a no-op when the verified passkey is already the primary signer', async () => {
    const { service, patches } = setUp({
      row: account({ primarySigner: NEW_PRIMARY }),
    });
    const plan = await service.start(USER, 'grant-1', 'token');
    expect(plan).toEqual({ done: true });
    expect(patches).toHaveLength(0);
  });

  it('stages the swap, records it, and prepares the propose step', async () => {
    const { service, read, recorded } = setUp({});
    const plan = await service.start(USER, 'grant-1', 'token');
    expect(plan.step).toBe('propose');
    expect(plan.needsApprovalSignature).toBe(true);
    expect(read().pendingPrimarySigner).toBe(NEW_PRIMARY);
    expect(read().pendingPrimaryProviderId).toBe(NEW_DID);
    expect(read().pendingPrimaryChangeIndex).toBe('8');
    expect(recorded).toContain('staged');
  });

  it('refuses a second replacement while one is already in flight', async () => {
    const { service, read } = setUp({
      row: account({
        pendingPrimarySigner: Keypair.generate().publicKey.toBase58(),
        pendingPrimaryProviderId: 'did:privy:earlier',
        pendingPrimaryChangeIndex: '8',
      }),
    });
    await expect(service.start(USER, 'grant-1', 'token')).rejects.toThrow(
      'already in flight',
    );
    expect(read().pendingPrimaryProviderId).toBe('did:privy:earlier');
  });

  it('refuses to race a Spending Limit change already holding the index', async () => {
    const { service } = setUp({
      row: account({ pendingSpendingLimitChangeIndex: '5' }),
    });
    await expect(service.start(USER, 'grant-1', 'token')).rejects.toThrow(
      'already in flight',
    );
  });

  it('refuses to race a device rotation already in flight', async () => {
    const { service } = setUp({
      row: account({ pendingApprovalChangeIndex: '5' }),
    });
    await expect(service.start(USER, 'grant-1', 'token')).rejects.toThrow(
      'already in flight',
    );
  });
});

describe('PrimaryRotationService settle', () => {
  const staged = () =>
    account({
      pendingPrimarySigner: NEW_PRIMARY,
      pendingPrimaryProviderId: NEW_DID,
      pendingPrimaryChangeIndex: '8',
    });

  it('moves the signer and the credential binding only on Executed', async () => {
    const { service, read, rebinds, recorded } = setUp({
      row: staged(),
      proposalStatus: 'Executed',
      signers: [NEW_PRIMARY, APPROVAL],
    });
    const plan = await service.next(USER);
    expect(plan).toEqual({ done: true });

    expect(read().primarySigner).toBe(NEW_PRIMARY);
    expect(read().pendingPrimarySigner).toBeNull();
    expect(rebinds).toHaveLength(1);
    expect(rebinds[0]).toMatchObject({
      providerUserId: NEW_DID,
      walletAddress: NEW_PRIMARY,
    });
    expect(recorded).toContain('executed');
    expect(recorded).toContain('passkey_enrolled');
  });

  it('forgets the swap and rebinds nothing when the change was rejected', async () => {
    const { service, read, rebinds, recorded } = setUp({
      row: staged(),
      proposalStatus: 'Rejected',
    });
    const plan = await service.next(USER);
    expect(plan).toEqual({ done: true });

    expect(read().primarySigner).toBe(OLD_PRIMARY);
    expect(read().pendingPrimarySigner).toBeNull();
    expect(rebinds).toHaveLength(0);
    expect(recorded).toContain('rejected');
    expect(recorded).not.toContain('passkey_enrolled');
  });
});

describe('PrimaryRotationService against a signer set that disagrees', () => {
  const staged = () =>
    account({
      pendingPrimarySigner: NEW_PRIMARY,
      pendingPrimaryProviderId: NEW_DID,
      pendingPrimaryChangeIndex: '8',
    });

  it('refuses to rebind the credential when the executed index did not install it', async () => {
    const { service, read, rebinds, recorded } = setUp({
      row: staged(),
      proposalStatus: 'Executed',
      signers: [OLD_PRIMARY, APPROVAL],
    });

    // Rebinding here would open this Account to a passkey the signer set
    // never accepted.
    await expect(service.next(USER)).rejects.toThrow(
      'did not install the staged primary signer',
    );
    expect(read().primarySigner).toBe(OLD_PRIMARY);
    expect(read().pendingPrimarySigner).toBe(NEW_PRIMARY);
    expect(rebinds).toHaveLength(0);
    expect(recorded).not.toContain('passkey_enrolled');
  });

  it('clears a staged index the chain has moved past without a proposal', async () => {
    const { service, read, rebinds, recorded } = setUp({
      row: account({
        pendingPrimarySigner: NEW_PRIMARY,
        pendingPrimaryProviderId: NEW_DID,
        pendingPrimaryChangeIndex: '5',
      }),
    });

    const plan = await service.next(USER);

    expect(plan).toEqual({ done: true });
    expect(read().pendingPrimarySigner).toBeNull();
    expect(read().pendingPrimaryChangeIndex).toBeNull();
    expect(read().primarySigner).toBe(OLD_PRIMARY);
    expect(rebinds).toHaveLength(0);
    expect(recorded).toContain('rejected');
  });

  it('lets a fresh passkey be staged once the stale index is cleared', async () => {
    const { service, read } = setUp({
      row: account({
        pendingPrimarySigner: Keypair.generate().publicKey.toBase58(),
        pendingPrimaryProviderId: 'did:privy:earlier',
        pendingPrimaryChangeIndex: '5',
      }),
    });

    const plan = await service.start(USER, 'grant-1', 'token');

    expect(plan.step).toBe('propose');
    expect(read().pendingPrimarySigner).toBe(NEW_PRIMARY);
    expect(read().pendingPrimaryChangeIndex).toBe('8');
  });
});
