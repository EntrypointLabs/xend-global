import { HttpException } from '@nestjs/common';
import { Keypair } from '@solana/web3.js';
import type { Request } from 'express';
import { deriveAccountAddresses } from '@xend/smart-account';

import type { AttestationService } from '../attestation/attestation.service';
import { AccountController } from './account.controller';
import type { AccountService } from './account.service';
import type { SquadsAccountRow } from './account.interface';
import { AccountResponseSchema, type SpendingLimitResponse } from './dtos';
import type { ProvisioningService } from './provisioning.service';
import type { SpendingLimitService } from './spending-limit.service';
import type { SweepService } from './sweep.service';
import type { TurnkeyService } from '../turnkey/turnkey.service';
import type { AccountChangeService } from './account-change.service';
import type { AccountEventsService } from '../activity/account-events.service';
import { RecoveryService } from '../recovery/recovery.service';
import type {
  NewRecoverySigner,
  RecoverySignerRow,
  RecoverySignerStore,
} from '../recovery/recovery-signer.store';
import type { RecoveryChangeService } from './recovery-change.service';
import type { RecoveryChallengeService } from '../recovery/recovery-challenge.service';
import type { DeviceRotationService } from './device-rotation.service';

const USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const SEED = 7n;
const USER_ID = 'user-1';

const account: SquadsAccountRow = {
  userId: USER_ID,
  settingsSeed: SEED,
  settingsAddress: deriveAccountAddresses(SEED).settings.toBase58(),
  vaultAddress: deriveAccountAddresses(SEED).vault.toBase58(),
  primarySigner: Keypair.generate().publicKey.toBase58(),
  approvalSigner: Keypair.generate().publicKey.toBase58(),
  approvalSubOrgId: 'suborg-1',
};

const limit: SpendingLimitResponse = {
  mint: USDC,
  maxPerUse: '100000000',
  maxPerPeriod: '100000000',
  remainingInPeriod: '42500000',
  period: 'Daily',
};

function makeController(
  row: SquadsAccountRow | null,
  spendingLimit: SpendingLimitResponse | null,
) {
  const asked: string[] = [];
  const accounts = {
    findByUserId: () => Promise.resolve(row),
  } as unknown as AccountService;
  const spendingLimits = {
    forAccount: (settingsAddress: string) => {
      asked.push(settingsAddress);
      return Promise.resolve(spendingLimit);
    },
  } as unknown as SpendingLimitService;

  const controller = new AccountController(
    accounts,
    {} as unknown as AttestationService,
    {} as unknown as SweepService,
    {} as unknown as ProvisioningService,
    spendingLimits,
    {
      enrolledDeviceKey: () => Promise.resolve('03device'),
    } as unknown as TurnkeyService,
    {} as unknown as AccountChangeService,
    {} as unknown as RecoveryService,
    {} as unknown as RecoveryChangeService,
    {} as unknown as RecoveryChallengeService,
    {} as unknown as DeviceRotationService,
  );
  return { controller, asked };
}

type AuthedRequest = Request & {
  user: { userId: string; walletAddress: string };
};

function request(): AuthedRequest {
  return {
    user: { userId: USER_ID, walletAddress: account.primarySigner },
  } as AuthedRequest;
}

describe('AccountController.getMe', () => {
  it('carries the spending limit alongside the Account', async () => {
    const { controller } = makeController(account, limit);

    const result = await controller.getMe(request());

    expect(result.spendingLimit).toEqual(limit);
    expect(AccountResponseSchema.parse(result)).toEqual(result);
  });

  it('reports no limit for an Account that has not been provisioned', async () => {
    const { controller } = makeController(account, null);

    const result = await controller.getMe(request());

    // Null rather than an error or an absent field. An Account without a limit
    // is the ordinary state between creation and provisioning, and it means
    // every Spend takes two confirmations rather than none.
    expect(result.spendingLimit).toBeNull();
    expect(AccountResponseSchema.parse(result)).toEqual(result);
  });

  it('reads the limit off the settings account, not the vault', async () => {
    const { controller, asked } = makeController(account, limit);

    await controller.getMe(request());

    // The policy is derived from the settings address. Asked about the vault,
    // the read finds nothing and every Spend silently becomes a two-signature
    // one.
    expect(asked).toEqual([account.settingsAddress]);
  });

  it('still 404s before an Account exists', async () => {
    const { controller } = makeController(null, null);

    await expect(controller.getMe(request())).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});

describe('AccountController.enrol', () => {
  function enrolController(opts: {
    enrolledSecurity?: string | null;
    verify?: jest.Mock;
    createAccount?: jest.Mock;
  }) {
    const createAccount =
      opts.createAccount ??
      jest.fn().mockResolvedValue({ vaultAddress: 'vault-1' });
    const turnkey = {
      findEnrolledDevice: jest
        .fn()
        .mockResolvedValue(
          opts.enrolledSecurity === undefined
            ? null
            : { security: opts.enrolledSecurity },
        ),
    } as unknown as TurnkeyService;
    const verify = opts.verify ?? jest.fn();
    const attestation = { verify } as unknown as AttestationService;

    const controller = new AccountController(
      { createAccount } as unknown as AccountService,
      attestation,
      {} as unknown as SweepService,
      {} as unknown as ProvisioningService,
      {} as unknown as SpendingLimitService,
      turnkey,
      {} as unknown as AccountChangeService,
      {} as unknown as RecoveryService,
      {} as unknown as RecoveryChangeService,
      {} as unknown as RecoveryChallengeService,
      {} as unknown as DeviceRotationService,
    );
    return { controller, createAccount, verify };
  }

  const req = {
    user: { userId: 'user-1', walletAddress: 'privy-1' },
  } as Parameters<AccountController['enrol']>[0];

  it('resumes an interrupted enrolment with the key already on file', async () => {
    const { controller, createAccount, verify } = enrolController({
      enrolledSecurity: 'secure_enclave',
    });

    const out = await controller.enrol(req, { hardwarePublicKey: '03aa' });

    // The device replaces its key whenever it attests, so a retry that had to
    // attest again could never reach the backend's reuse path and would strand
    // the sub-organization built around the first key.
    expect(createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ hardwarePublicKey: '03aa' }),
    );
    expect(verify).not.toHaveBeenCalled();
    expect(out.security).toBe('secure_enclave');
  });

  it('refuses a key it has never attested', async () => {
    const { controller, createAccount } = enrolController({});

    // Taking the caller's word here would undo the reason the fresh path reads
    // the key out of the attestation: real hardware could attest once and then
    // enrol a software key it actually controls.
    await expect(
      controller.enrol(req, { hardwarePublicKey: '03ff' }),
    ).rejects.toThrow();
    expect(createAccount).not.toHaveBeenCalled();
  });
});

describe('AccountController recovery key changes', () => {
  const WALLET_A = Keypair.generate().publicKey.toBase58();
  const WALLET_B = Keypair.generate().publicKey.toBase58();

  /** Enough of the store for the rules; the lock is the part under test. */
  class SerialisingStore implements RecoverySignerStore {
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

    findContactEmail(): Promise<string | null> {
      return Promise.resolve('a@example.com');
    }

    updateContactEmail(): Promise<void> {
      return Promise.resolve();
    }

    isContactEmailTaken(): Promise<boolean> {
      return Promise.resolve(false);
    }

    findReleaseFreeze(): Promise<Date | null> {
      return Promise.resolve(null);
    }

    setReleaseFreeze(): Promise<void> {
      return Promise.resolve();
    }
  }

  function recoveryController() {
    const store = new SerialisingStore();
    const vault = {
      seal: (secret: Uint8Array) =>
        Promise.resolve({
          ciphertext: Buffer.from(secret).toString('base64'),
          keyId: 'test',
        }),
      open: () => Promise.resolve(new Uint8Array(32)),
    };
    const recovery = new RecoveryService(store, vault, {
      recordRecoveryKeyAdded: () => Promise.resolve(),
    } as unknown as AccountEventsService);

    // The chain read that stands between staging a signer and claiming the
    // index it will occupy. Every caller reads the same on-chain index until
    // one of them lands a change, which is what makes the gap exploitable.
    const claimed: string[] = [];
    const recoveryChanges = {
      start: async (userId: string, signerId: string) => {
        await Promise.resolve();
        const index = 41n + BigInt(claimed.length);
        claimed.push(index.toString());
        await recovery.markChange(signerId, index);
        return { transactionIndex: index.toString() };
      },
    } as unknown as RecoveryChangeService;

    const controller = new AccountController(
      {
        findByUserId: () => Promise.resolve(account),
      } as unknown as AccountService,
      {} as unknown as AttestationService,
      {} as unknown as SweepService,
      {} as unknown as ProvisioningService,
      {} as unknown as SpendingLimitService,
      {
        enrolledDeviceKey: () => Promise.resolve('03device'),
      } as unknown as TurnkeyService,
      {} as unknown as AccountChangeService,
      recovery,
      recoveryChanges,
      {} as unknown as RecoveryChallengeService,
      {} as unknown as DeviceRotationService,
    );
    return { controller, recovery, store, claimed };
  }

  it('lets only one of two simultaneous recovery key changes through', async () => {
    const { controller, store, claimed } = recoveryController();
    await store.insert({
      userId: USER_ID,
      address: Keypair.generate().publicKey.toBase58(),
      channel: 'email',
      channelValue: 'a@example.com',
      status: 'active',
    });

    const [first, second] = await Promise.allSettled([
      controller.addRecoveryWallet(request(), { address: WALLET_A }),
      controller.addRecoveryWallet(request(), { address: WALLET_B }),
    ]);

    // Both requests read "no change in flight" if they are allowed to
    // interleave, and both then claim the same Settings index. Only one of
    // the two rows could ever settle, and the other would sit staged for ever
    // while blocking every later change.
    const outcomes = [first.status, second.status].sort();
    expect(outcomes).toEqual(['fulfilled', 'rejected']);
    expect(claimed).toEqual(['41']);
    expect(store.rows.filter((r) => r.status === 'pending_add')).toHaveLength(
      1,
    );

    const refused = [first, second].find((r) => r.status === 'rejected');
    const error = (refused as PromiseRejectedResult).reason as HttpException;
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(409);
  });
});
