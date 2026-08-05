import { Test } from '@nestjs/testing';
import { RECOVERY_VAULT, type RecoveryVault } from './recovery-vault.interface';
import { RecoveryService } from './recovery.service';
import {
  DuplicateRecoveryChannelError,
  LastRecoverySignerError,
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

  it('allows removal once a second signer exists', async () => {
    const first = await service.provisionEmailSigner('user-1', 'a@example.com');
    await service.addExternalWallet(
      'user-1',
      'So11111111111111111111111111111111111111112',
    );

    const signers = await service.list('user-1');
    expect(signers.every((s) => s.removable)).toBe(true);

    const removed = await service.remove('user-1', first.id);
    expect(removed.address).toBe(first.address);
    expect(await service.list('user-1')).toHaveLength(1);
  });

  it('makes the last remaining signer un-removable again', async () => {
    const first = await service.provisionEmailSigner('user-1', 'a@example.com');
    await service.addExternalWallet(
      'user-1',
      'So11111111111111111111111111111111111111112',
    );
    await service.remove('user-1', first.id);

    const [survivor] = await service.list('user-1');
    expect(survivor.removable).toBe(false);
    await expect(service.remove('user-1', survivor.id)).rejects.toThrow(
      LastRecoverySignerError,
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
