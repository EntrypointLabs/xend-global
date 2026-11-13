import type { ConfigService } from '@nestjs/config';
import { Keypair, SystemProgram } from '@solana/web3.js';
import { buildCreateAccount, fetchProgramConfig } from '@prydd/smart-account';

import type { SettlementAuthoritySigner } from '../settlement/settlement-authority.interface';
import { Web3AccountChain } from './account-chain.web3';
import { AccountCreationError, SeedTakenError } from './account.errors';

jest.mock('@prydd/smart-account', () => ({
  buildCreateAccount: jest.fn(),
  fetchProgramConfig: jest.fn(),
  nextSettingsSeed: jest.fn(() => 42n),
}));

jest.mock('../solana/priority-fee', () => ({
  withPriorityFee: jest.fn((_rpc, _config, _payer, instructions: unknown) =>
    Promise.resolve(instructions),
  ),
}));

const settings = Keypair.generate().publicKey;
const vault = Keypair.generate().publicKey;
const authorityKey = Keypair.generate().publicKey;

const signers = {
  primary: Keypair.generate().publicKey.toBase58(),
  approval: Keypair.generate().publicKey.toBase58(),
  recovery: Keypair.generate().publicKey.toBase58(),
};

function setup(confirmationErr: unknown) {
  jest.mocked(fetchProgramConfig).mockResolvedValue({
    treasury: Keypair.generate().publicKey,
  } as Awaited<ReturnType<typeof fetchProgramConfig>>);
  jest.mocked(buildCreateAccount).mockReturnValue({
    instruction: SystemProgram.transfer({
      fromPubkey: authorityKey,
      toPubkey: settings,
      lamports: 1,
    }),
    addresses: { settings, vault },
  } as unknown as ReturnType<typeof buildCreateAccount>);

  const authority: SettlementAuthoritySigner = {
    address: authorityKey.toBase58(),
    signAndSend: jest.fn().mockResolvedValue('landed-signature'),
  };
  const chain = new Web3AccountChain({} as ConfigService, authority);
  Reflect.set(chain, 'rpc', {
    getLatestBlockhash: jest.fn().mockResolvedValue({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 100,
    }),
    confirmTransaction: jest.fn().mockResolvedValue({
      context: { slot: 1 },
      value: { err: confirmationErr },
    }),
  });
  return chain;
}

describe('Web3AccountChain.createAccount', () => {
  it('treats a creation that landed and failed with MissingAccount as a lost seed race', async () => {
    const chain = setup({ InstructionError: [1, { Custom: 6024 }] });

    await expect(chain.createAccount(signers)).rejects.toBeInstanceOf(
      SeedTakenError,
    );
  });

  it('treats a landed system "already in use" failure as a lost seed race', async () => {
    const chain = setup({ InstructionError: [1, { Custom: 0 }] });

    await expect(chain.createAccount(signers)).rejects.toBeInstanceOf(
      SeedTakenError,
    );
  });

  it('fails without returning an address when the creation landed and failed for another reason', async () => {
    const chain = setup({ InstructionError: [1, { Custom: 6006 }] });

    const attempt = chain.createAccount(signers);

    await expect(attempt).rejects.toBeInstanceOf(AccountCreationError);
    await expect(attempt).rejects.not.toBeInstanceOf(SeedTakenError);
  });

  it('returns the created addresses when the creation succeeded', async () => {
    const chain = setup(null);

    await expect(chain.createAccount(signers)).resolves.toEqual({
      settingsSeed: 42n,
      settingsAddress: settings.toBase58(),
      vaultAddress: vault.toBase58(),
      signature: 'landed-signature',
    });
  });
});
