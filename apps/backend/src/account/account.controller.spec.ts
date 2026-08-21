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
