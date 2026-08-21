import { Test } from '@nestjs/testing';
import { RECOVERY_VAULT, type RecoveryVault } from './recovery-vault.interface';
import { RecoveryService } from './recovery.service';
import {
  DuplicateRecoveryChannelError,
  LastRecoverySignerError,
  RecoveryChangeInFlightError,
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

  findByUser(userId: string): Promise<RecoverySignerRow[]> {
    return Promise.resolve(this.rows.filter((r) => r.userId === userId));
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

describe('RecoveryService', () => {
  let service: RecoveryService;
  let store: FakeStore;

  beforeEach(async () => {
    store = new FakeStore();
    const moduleRef = await Test.createTestingModule({
      providers: [
        RecoveryService,
        { provide: RECOVERY_SIGNER_STORE, useValue: store },
        { provide: RECOVERY_VAULT, useValue: vault },
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
    expect(signer.address).toHaveLength(44);
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

  it('refuses a fourth recovery signer', async () => {
    await service.provisionEmailSigner('user-1', 'a@example.com');
    await landAdd('user-1', 'So11111111111111111111111111111111111111112');
    await landAdd('user-1', 'So11111111111111111111111111111111111111113');

    await expect(service.addEmail('user-1', 'd@example.com')).rejects.toThrow(
      RecoverySignerLimitError,
    );
  });

  it('rotates the sole signer to a new email and a fresh key', async () => {
    const before = await service.provisionEmailSigner(
      'user-1',
      'old@example.com',
    );

    const after = await service.changeEmail(
      'user-1',
      before.id,
      'New@Example.com',
    );

    expect(after.channelValue).toBe('new@example.com');
    // A fresh keypair, not the old secret re-addressed: the old email may be
    // exactly what was compromised.
    expect(after.address).not.toBe(before.address);
    expect(await service.list('user-1')).toHaveLength(1);
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
