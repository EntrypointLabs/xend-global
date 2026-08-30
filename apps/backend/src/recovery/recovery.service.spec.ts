import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { Test } from '@nestjs/testing';
import { RECOVERY_VAULT, type RecoveryVault } from './recovery-vault.interface';
import { AccountEventsService } from '../activity/account-events.service';
import { RecoveryService } from './recovery.service';
import {
  ContactEmailTakenError,
  ContactRecoverySignerError,
  DuplicateRecoveryChannelError,
  LastRecoverySignerError,
  RecoveryChangeInFlightError,
  RecoveryReleaseFrozenError,
  RecoverySignerLimitError,
  UnknownRecoverySignerError,
} from './recovery.errors';

import type {
  NewRecoverySigner,
  RecoverySignerRow,
  RecoverySignerStore,
} from './recovery-signer.store';
import { RECOVERY_SIGNER_STORE } from './recovery-signer.store';

/** In-memory store. The rules live in the service, so this stays dumb. */
class FakeStore implements RecoverySignerStore {
  rows: RecoverySignerRow[] = [];
  private seq = 0;
  private locks = new Map<string, Promise<unknown>>();

  withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const queued = (this.locks.get(userId) ?? Promise.resolve()).then(fn, fn);
    this.locks.set(
      userId,
      queued.catch(() => undefined),
    );
    return queued;
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

  /** The address on file per Consumer. Unset means no address yet. */
  contacts = new Map<string, string>();
  freezes = new Map<string, Date | null>();

  findContactEmail(userId: string): Promise<string | null> {
    return Promise.resolve(this.contacts.get(userId) ?? null);
  }

  updateContactEmail(userId: string, email: string): Promise<void> {
    this.contacts.set(userId, email);
    return Promise.resolve();
  }

  isContactEmailTaken(userId: string, email: string): Promise<boolean> {
    return Promise.resolve(
      [...this.contacts].some(([id, held]) => id !== userId && held === email),
    );
  }

  findReleaseFreeze(userId: string): Promise<Date | null> {
    return Promise.resolve(this.freezes.get(userId) ?? null);
  }

  setReleaseFreeze(userId: string, frozenAt: Date | null): Promise<void> {
    this.freezes.set(userId, frozenAt);
    return Promise.resolve();
  }
}

/** A transaction only `address` can sign, so the wrong key is refused. */
function transactionSignedBy(address: string): VersionedTransaction {
  return new VersionedTransaction(
    new TransactionMessage({
      payerKey: new PublicKey(address),
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [],
    }).compileToV0Message(),
  );
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

/** Only what RecoveryService reaches. Recorded facts are asserted here too. */
const recordAdded = jest.fn().mockResolvedValue(null);
const recordRemoved = jest.fn().mockResolvedValue(null);
const recordContactChanged = jest.fn().mockResolvedValue(null);
const events = {
  recordRecoveryKeyAdded: recordAdded,
  recordRecoveryKeyRemoved: recordRemoved,
  recordContactEmailChanged: recordContactChanged,
} as unknown as AccountEventsService;

describe('RecoveryService', () => {
  let service: RecoveryService;
  let store: FakeStore;

  beforeEach(async () => {
    jest.clearAllMocks();
    store = new FakeStore();
    const moduleRef = await Test.createTestingModule({
      providers: [
        RecoveryService,
        { provide: RECOVERY_SIGNER_STORE, useValue: store },
        { provide: RECOVERY_VAULT, useValue: vault },
        // Recording is a side effect of settling, not part of the rules these
        // tests cover; the events themselves are covered in their own spec.
        { provide: AccountEventsService, useValue: events },
      ],
    }).compile();
    service = moduleRef.get(RecoveryService);
  });

  it('provisions an email signer without exposing key material', async () => {
    const signer = await service.provisionEmailSigner(
      'user-1',
      'A@Example.com',
    );

    expect(signer.channel).toBe('email');
    expect(signer.channelValue).toBe('a@example.com');
    // Not a fixed length: base58 of 32 bytes is 43 or 44 characters depending
    // on leading zeroes, so asserting 44 fails on roughly one key in 256.
    expect(() => new PublicKey(signer.address)).not.toThrow();
    expect(Object.keys(signer)).not.toContain('sealedKey');
  });

  it('reuses the stored email signer so a retried enrolment can succeed', async () => {
    const first = await service.ensureEmailSigner('user-1', 'a@example.com');
    const second = await service.ensureEmailSigner('user-1', 'A@Example.com');

    // Same row, not a second one. A duplicate would violate the (user,
    // channel, value) uniqueness and fail the retry before it reached the
    // chain, stranding an Account whose first attempt died after this step.
    expect(second.id).toBe(first.id);
    expect(second.address).toBe(first.address);
    expect(store.rows).toHaveLength(1);
  });

  it('still refuses a duplicate when the Consumer adds an email deliberately', async () => {
    await service.ensureEmailSigner('user-1', 'a@example.com');

    await expect(service.addEmail('user-1', 'a@example.com')).rejects.toThrow(
      DuplicateRecoveryChannelError,
    );
  });

  it('marks the sole signer as not removable', async () => {
    await service.provisionEmailSigner('user-1', 'a@example.com');

    const [only] = await service.list('user-1');
    expect(only.removable).toBe(false);
  });

  it('refuses to remove the last recovery signer', async () => {
    const signer = await service.provisionEmailSigner(
      'user-1',
      'a@example.com',
    );

    await expect(service.remove('user-1', signer.id)).rejects.toThrow(
      LastRecoverySignerError,
    );
    expect(await service.list('user-1')).toHaveLength(1);
  });

  /** Stages a signer and lands the settings change that puts it on chain. */
  async function landAdd(userId: string, address: string) {
    const added = await service.addExternalWallet(userId, address);
    await service.markChange(added.id, 9n);
    await service.settle(userId, 9n);
    return added;
  }

  it('does not count a staged signer as one that backs the Account', async () => {
    const first = await service.provisionEmailSigner('user-1', 'a@example.com');
    await service.addExternalWallet(
      'user-1',
      'So11111111111111111111111111111111111111112',
    );

    // The second signer is not in the on-chain signer set until its settings
    // change executes, so removing the first would leave nothing recovering
    // the Account in the meantime.
    await expect(service.remove('user-1', first.id)).rejects.toThrow(
      LastRecoverySignerError,
    );
  });

  it('allows removal once a second signer is really in the signer set', async () => {
    const first = await service.provisionEmailSigner('user-1', 'a@example.com');
    await landAdd('user-1', 'So11111111111111111111111111111111111111112');

    const signers = await service.list('user-1');
    expect(signers.every((s) => s.removable)).toBe(true);

    const removed = await service.remove('user-1', first.id);
    expect(removed.address).toBe(first.address);

    // Staged, not gone: the row survives until the chain agrees, and a
    // different change executing must not take it with it.
    const staged = (await service.list('user-1')).find(
      (s) => s.id === first.id,
    );
    expect(staged?.status).toBe('pending_remove');
    await service.settle('user-1', 11n);
    expect(await service.list('user-1')).toHaveLength(2);
  });

  it('drops a staged removal only when its own change executes', async () => {
    const first = await service.provisionEmailSigner('user-1', 'a@example.com');
    await landAdd('user-1', 'So11111111111111111111111111111111111111112');

    await service.remove('user-1', first.id);
    await service.markChange(first.id, 12n);
    await service.settle('user-1', 12n);

    expect(await service.list('user-1')).toHaveLength(1);
  });

  it('puts a rejected removal back into service', async () => {
    const first = await service.provisionEmailSigner('user-1', 'a@example.com');
    await landAdd('user-1', 'So11111111111111111111111111111111111111112');

    await service.remove('user-1', first.id);
    await service.markChange(first.id, 13n);
    await service.abandon('user-1', 13n);

    const survivor = (await service.list('user-1')).find(
      (s) => s.id === first.id,
    );
    expect(survivor?.status).toBe('active');
  });

  it('forgets a staged addition that was rejected', async () => {
    await service.provisionEmailSigner('user-1', 'a@example.com');
    const added = await service.addExternalWallet(
      'user-1',
      'So11111111111111111111111111111111111111112',
    );
    await service.markChange(added.id, 14n);
    await service.abandon('user-1', 14n);

    expect(await service.list('user-1')).toHaveLength(1);
  });

  it('makes the last remaining signer un-removable again', async () => {
    const first = await service.provisionEmailSigner('user-1', 'a@example.com');
    await landAdd('user-1', 'So11111111111111111111111111111111111111112');
    await service.remove('user-1', first.id);
    await service.markChange(first.id, 15n);
    await service.settle('user-1', 15n);

    const [survivor] = await service.list('user-1');
    expect(survivor.removable).toBe(false);
    await expect(service.remove('user-1', survivor.id)).rejects.toThrow(
      LastRecoverySignerError,
    );
  });

  it('records a key reaching the signer set, and only then', async () => {
    const first = await service.provisionEmailSigner('user-1', 'a@example.com');
    const added = await service.addExternalWallet(
      'user-1',
      'So11111111111111111111111111111111111111112',
    );
    await service.markChange(added.id, 9n);

    // Staged is not added. Nothing has reached the chain yet.
    expect(recordAdded).not.toHaveBeenCalled();

    await service.settle('user-1', 9n);

    expect(recordAdded).toHaveBeenCalledWith('user-1', {
      signerId: added.id,
      subject: 'So11111111111111111111111111111111111111112',
      signature: null,
    });
    expect(first.id).not.toBe(added.id);
  });

  it('records a removal before the row it describes is gone', async () => {
    const first = await service.provisionEmailSigner('user-1', 'a@example.com');
    await landAdd('user-1', 'So11111111111111111111111111111111111111112');
    await service.remove('user-1', first.id);
    await service.markChange(first.id, 12n);

    await service.settle('user-1', 12n);

    // The row is deleted by settle, so the subject has to be read off it
    // first or the event records nothing.
    expect(recordRemoved).toHaveBeenCalledWith('user-1', {
      signerId: first.id,
      subject: 'a@example.com',
      signature: null,
    });
  });

  it('records nothing for a change that was abandoned', async () => {
    await service.provisionEmailSigner('user-1', 'a@example.com');
    const added = await service.addExternalWallet(
      'user-1',
      'So11111111111111111111111111111111111111112',
    );
    await service.markChange(added.id, 14n);

    await service.abandon('user-1', 14n);

    // Nothing reached the signer set on this path, so nothing happened to the
    // Account and the feed must not claim otherwise.
    expect(recordAdded).not.toHaveBeenCalled();
    expect(recordRemoved).not.toHaveBeenCalled();
  });

  it('refuses a second change while one is still in flight', async () => {
    await service.provisionEmailSigner('user-1', 'a@example.com');
    const added = await service.addExternalWallet(
      'user-1',
      'So11111111111111111111111111111111111111112',
    );
    await service.markChange(added.id, 16n);

    // Settings changes are sequenced by transactionIndex, so a second one
    // proposed now would either collide or silently depend on the first.
    await expect(service.addEmail('user-1', 'b@example.com')).rejects.toThrow(
      RecoveryChangeInFlightError,
    );
  });

  it('lets two Consumers use the same wallet', async () => {
    const wallet = 'So11111111111111111111111111111111111111112';
    await service.provisionEmailSigner('user-1', 'a@example.com');
    await landAdd('user-1', wallet);
    await service.provisionEmailSigner('user-2', 'b@example.com');

    // One person who signed up twice, or a household sharing a device.
    // Refusing that protects nobody. What must not happen is the same wallet
    // counting twice toward one Consumer's threshold, which is the next test.
    await expect(
      service.addExternalWallet('user-2', wallet),
    ).resolves.toMatchObject({ channel: 'external_wallet' });
  });

  it('refuses the same wallet twice for one Consumer', async () => {
    const wallet = 'So11111111111111111111111111111111111111112';
    await service.provisionEmailSigner('user-1', 'a@example.com');
    await landAdd('user-1', wallet);

    await expect(service.addExternalWallet('user-1', wallet)).rejects.toThrow(
      DuplicateRecoveryChannelError,
    );
  });

  it('refuses a fourth recovery signer', async () => {
    await service.provisionEmailSigner('user-1', 'a@example.com');
    await landAdd('user-1', 'So11111111111111111111111111111111111111112');
    await landAdd('user-1', 'So11111111111111111111111111111111111111113');

    await expect(service.addEmail('user-1', 'd@example.com')).rejects.toThrow(
      RecoverySignerLimitError,
    );
  });

  /** Lands a second email signer, so the Account holds two sealed keys. */
  async function landSecondEmail(userId: string, email: string) {
    const added = await service.addEmail(userId, email);
    await service.markChange(added.id, 5n);
    await service.settle(userId, 5n);
    return added;
  }

  it('stages a rotation as a fresh key coming in and the anchored key going out', async () => {
    store.contacts.set('user-1', 'old@example.com');
    const before = await service.provisionEmailSigner(
      'user-1',
      'old@example.com',
    );

    const { key, retiring } = await service.stageContactRotation(
      'user-1',
      'New@Example.com',
    );

    expect(retiring.id).toBe(before.id);
    expect(retiring.status).toBe('pending_remove');
    expect(key.status).toBe('pending_add');
    expect(key.channelValue).toBe('new@example.com');
    // A fresh keypair, not the old secret re-addressed: the old email may be
    // exactly what was compromised.
    expect(key.address).not.toBe(before.address);
    expect(store.rows.find((r) => r.id === key.id)?.sealedKey).toBeTruthy();
    // Staging hands nothing over. The address on file is untouched until the
    // chain has executed the change.
    expect(await store.findContactEmail('user-1')).toBe('old@example.com');
  });

  it('rotates the signer anchored on the address on file, not the first email signer', async () => {
    const first = await service.provisionEmailSigner(
      'user-1',
      'first@example.com',
    );
    const second = await landSecondEmail('user-1', 'second@example.com');
    store.contacts.set('user-1', 'second@example.com');

    const { retiring } = await service.stageContactRotation(
      'user-1',
      'next@example.com',
    );

    expect(retiring.id).toBe(second.id);
    expect(store.rows.find((r) => r.id === first.id)?.status).toBe('active');
  });

  it('moves the address on file only when the rotation executes', async () => {
    store.contacts.set('user-1', 'old@example.com');
    await service.provisionEmailSigner('user-1', 'old@example.com');
    const { key, retiring } = await service.stageContactRotation(
      'user-1',
      'new@example.com',
    );
    await service.markChange(key.id, 20n);
    await service.markChange(retiring.id, 20n);
    expect(await store.findContactEmail('user-1')).toBe('old@example.com');

    await service.settle('user-1', 20n);

    expect(await store.findContactEmail('user-1')).toBe('new@example.com');
    // One fact, told once, to both inboxes: not a key added and a key removed.
    expect(recordContactChanged).toHaveBeenCalledTimes(1);
    expect(recordContactChanged).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        changeIndex: 20n,
        previousEmail: 'old@example.com',
        nextEmail: 'new@example.com',
      }),
    );
    expect(recordAdded).not.toHaveBeenCalled();
    expect(recordRemoved).not.toHaveBeenCalled();
    const signers = await service.list('user-1');
    expect(signers).toHaveLength(1);
    expect(signers[0]).toMatchObject({
      id: key.id,
      status: 'active',
      isContactAddress: true,
    });
    // Idempotent: the poller calls this until it sees done.
    await service.settle('user-1', 20n);
    expect(await store.findContactEmail('user-1')).toBe('new@example.com');
  });

  it('leaves the address on file alone when the rotation is rejected', async () => {
    store.contacts.set('user-1', 'old@example.com');
    const before = await service.provisionEmailSigner(
      'user-1',
      'old@example.com',
    );
    const { key, retiring } = await service.stageContactRotation(
      'user-1',
      'new@example.com',
    );
    await service.markChange(key.id, 21n);
    await service.markChange(retiring.id, 21n);

    await service.abandon('user-1', 21n);

    expect(await store.findContactEmail('user-1')).toBe('old@example.com');
    const signers = await service.list('user-1');
    expect(signers).toHaveLength(1);
    expect(signers[0]).toMatchObject({
      id: before.id,
      status: 'active',
      isContactAddress: true,
    });
  });

  it('refuses a replacement address another Consumer has on file', async () => {
    store.contacts.set('user-1', 'old@example.com');
    store.contacts.set('user-2', 'theirs@example.com');
    await service.provisionEmailSigner('user-1', 'old@example.com');

    await expect(
      service.assertContactEmailAvailable('user-1', 'theirs@example.com'),
    ).rejects.toThrow(ContactEmailTakenError);
    await expect(
      service.stageContactRotation('user-1', 'theirs@example.com'),
    ).rejects.toThrow(ContactEmailTakenError);
  });

  it('refuses to rotate onto the address already on file', async () => {
    store.contacts.set('user-1', 'old@example.com');
    await service.provisionEmailSigner('user-1', 'old@example.com');

    await expect(
      service.stageContactRotation('user-1', 'OLD@example.com'),
    ).rejects.toThrow(DuplicateRecoveryChannelError);
  });

  it('refuses to rotate while another change is in flight', async () => {
    store.contacts.set('user-1', 'old@example.com');
    await service.provisionEmailSigner('user-1', 'old@example.com');
    const added = await service.addExternalWallet(
      'user-1',
      'So11111111111111111111111111111111111111112',
    );
    await service.markChange(added.id, 22n);

    await expect(
      service.stageContactRotation('user-1', 'new@example.com'),
    ).rejects.toThrow(RecoveryChangeInFlightError);
  });

  it('does not count a rotation against the signer cap', async () => {
    store.contacts.set('user-1', 'a@example.com');
    await service.provisionEmailSigner('user-1', 'a@example.com');
    await landAdd('user-1', 'So11111111111111111111111111111111111111112');
    await landAdd('user-1', 'So11111111111111111111111111111111111111113');

    // Three signers is the cap, and a rotation leaves it at three: one in,
    // one out, in the same change.
    await expect(
      service.stageContactRotation('user-1', 'b@example.com'),
    ).resolves.toBeDefined();
  });

  it('refuses to remove the signer anchored on the address on file', async () => {
    store.contacts.set('user-1', 'a@example.com');
    const first = await service.provisionEmailSigner('user-1', 'a@example.com');
    await landAdd('user-1', 'So11111111111111111111111111111111111111112');

    const contact = (await service.list('user-1')).find(
      (s) => s.isContactAddress,
    );
    expect(contact?.id).toBe(first.id);
    expect(contact?.removable).toBe(false);
    await expect(service.remove('user-1', first.id)).rejects.toThrow(
      ContactRecoverySignerError,
    );
  });

  it('signs with the signer it was given, never the first sealed one', async () => {
    const first = await service.provisionEmailSigner('user-1', 'a@example.com');
    const second = await landSecondEmail('user-1', 'b@example.com');

    const signed = await service.approveWithRecoverySigner(
      'user-1',
      transactionSignedBy(second.address),
      second.id,
    );
    expect(signed.signatures[0].some((byte) => byte !== 0)).toBe(true);

    // Asked to sign with the other row, the key opened is the other key, and
    // it cannot sign for a slot it does not occupy.
    await expect(
      service.approveWithRecoverySigner(
        'user-1',
        transactionSignedBy(second.address),
        first.id,
      ),
    ).rejects.toThrow();
  });

  it('finds the signer a proved inbox anchors', async () => {
    await service.provisionEmailSigner('user-1', 'a@example.com');
    const second = await landSecondEmail('user-1', 'b@example.com');

    expect((await service.signerAnchoredOn('user-1', 'B@example.com')).id).toBe(
      second.id,
    );
    await expect(
      service.signerAnchoredOn('user-1', 'c@example.com'),
    ).rejects.toThrow(UnknownRecoverySignerError);
  });

  it('refuses to sign with a key that is not yet in the signer set', async () => {
    await service.provisionEmailSigner('user-1', 'a@example.com');
    const staged = await service.addEmail('user-1', 'b@example.com');

    await expect(
      service.approveWithRecoverySigner(
        'user-1',
        transactionSignedBy(staged.address),
        staged.id,
      ),
    ).rejects.toThrow(UnknownRecoverySignerError);
  });

  it('withholds every sealed key while support has the release frozen', async () => {
    const signer = await service.provisionEmailSigner(
      'user-1',
      'a@example.com',
    );

    await service.freezeRelease('user-1');

    await expect(service.assertReleaseAllowed('user-1')).rejects.toThrow(
      RecoveryReleaseFrozenError,
    );
    await expect(
      service.approveWithRecoverySigner(
        'user-1',
        transactionSignedBy(signer.address),
        signer.id,
      ),
    ).rejects.toThrow(RecoveryReleaseFrozenError);

    await service.unfreezeRelease('user-1');
    await expect(
      service.approveWithRecoverySigner(
        'user-1',
        transactionSignedBy(signer.address),
        signer.id,
      ),
    ).resolves.toBeDefined();
  });

  it('lets a change the Consumer signs themselves through the freeze', async () => {
    await service.provisionEmailSigner('user-1', 'a@example.com');
    await service.freezeRelease('user-1');

    // The freeze withholds our vote and nothing else. A change approved by
    // the passkey and the phone never needed it.
    const added = await service.addExternalWallet(
      'user-1',
      'So11111111111111111111111111111111111111112',
    );
    await service.markChange(added.id, 32n);
    await service.settle('user-1', 32n);

    expect(
      (await service.list('user-1')).find((s) => s.id === added.id)?.status,
    ).toBe('active');
  });

  it('rejects a duplicate channel rather than adding a second row', async () => {
    await service.provisionEmailSigner('user-1', 'a@example.com');

    await expect(service.addEmail('user-1', 'A@example.com')).rejects.toThrow(
      DuplicateRecoveryChannelError,
    );
  });

  it('rejects an unknown signer id', async () => {
    await service.provisionEmailSigner('user-1', 'a@example.com');

    await expect(service.remove('user-1', 'signer-999')).rejects.toThrow(
      UnknownRecoverySignerError,
    );
  });

  it('stores no key material for an external wallet', async () => {
    await service.provisionEmailSigner('user-1', 'a@example.com');
    const address = 'So11111111111111111111111111111111111111112';

    await service.addExternalWallet('user-1', address);

    const row = store.rows.find((r) => r.channel === 'external_wallet');
    expect(row!.sealedKey).toBeNull();
    expect(row!.address).toBe(address);
  });
});
