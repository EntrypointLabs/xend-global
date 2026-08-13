import type { RecoveryService } from '../recovery/recovery.service';
import { TurnkeyService } from '../turnkey/turnkey.service';
import {
  AccountCreationError,
  IncompleteSignerSetError,
  SeedTakenError,
} from './account.errors';
import type {
  AccountChain,
  SquadsAccountRow,
  SquadsAccountStore,
} from './account.interface';
import { AccountService } from './account.service';

const USER = 'user-1';
const PRIMARY = 'Privy1111111111111111111111111111111111111';
const APPROVAL = 'Turnk2222222222222222222222222222222222222';
const RECOVERY = 'Recov3333333333333333333333333333333333333';
const SETTINGS = 'Settg4444444444444444444444444444444444444';
const VAULT = 'Vault5555555555555555555555555555555555555';
const SUB_ORG = 'suborg-1';

function fakeStore(seed?: SquadsAccountRow) {
  const rows: SquadsAccountRow[] = seed ? [seed] : [];
  const store: SquadsAccountStore = {
    findByUserId(userId) {
      return Promise.resolve(rows.find((r) => r.userId === userId) ?? null);
    },
    insert(row) {
      rows.push(row);
      return Promise.resolve(row);
    },
    findUserEmail: () => Promise.resolve('consumer@example.com'),
  };
  return { store, rows };
}

function fakeChain(overrides: Partial<AccountChain> = {}) {
  const calls: number[] = [];
  const chain: AccountChain = {
    createAccount() {
      calls.push(calls.length + 1);
      return Promise.resolve({
        settingsSeed: 42n,
        settingsAddress: SETTINGS,
        vaultAddress: VAULT,
        signature: 'sig-1',
      });
    },
    ...overrides,
  };
  return { chain, calls };
}

function fakeTurnkey(address = APPROVAL) {
  const calls: unknown[] = [];
  const turnkey = {
    enrolApprovalSigner(params: unknown) {
      calls.push(params);
      return Promise.resolve({ subOrganizationId: SUB_ORG, address });
    },
  } as unknown as TurnkeyService;
  return { turnkey, calls };
}

function fakeRecovery(address = RECOVERY) {
  const calls: string[] = [];
  const recovery = {
    ensureEmailSigner: (userId: string) => {
      calls.push(userId);
      return Promise.resolve({ address });
    },
  } as unknown as RecoveryService;
  return { recovery, calls };
}

function params(
  overrides: Partial<Parameters<AccountService['createAccount']>[0]> = {},
) {
  return {
    userId: USER,
    primarySigner: PRIMARY,
    email: 'consumer@example.com',
    hardwarePublicKey: '03bb',
    ...overrides,
  };
}

describe('AccountService.createAccount', () => {
  it('persists the assigned seed, because the address cannot be recomputed', async () => {
    const { store, rows } = fakeStore();
    const { chain } = fakeChain();
    const { turnkey } = fakeTurnkey();

    await new AccountService(
      chain,
      store,
      turnkey,
      fakeRecovery().recovery,
    ).createAccount(params());

    expect(rows[0]).toMatchObject({
      settingsSeed: 42n,
      settingsAddress: SETTINGS,
      vaultAddress: VAULT,
      approvalSubOrgId: SUB_ORG,
    });
  });

  it('returns the existing Account rather than creating a second', async () => {
    const existing: SquadsAccountRow = {
      userId: USER,
      settingsSeed: 7n,
      settingsAddress: SETTINGS,
      vaultAddress: VAULT,
      primarySigner: PRIMARY,
      approvalSigner: APPROVAL,
      approvalSubOrgId: SUB_ORG,
    };
    const { store } = fakeStore(existing);
    const { chain, calls } = fakeChain();
    const { turnkey, calls: turnkeyCalls } = fakeTurnkey();

    const result = await new AccountService(
      chain,
      store,
      turnkey,
      fakeRecovery().recovery,
    ).createAccount(params());

    expect(result).toEqual(existing);
    // A second Account would strand the balance in the first, and the address
    // is what the Consumer has already handed out.
    expect(calls).toHaveLength(0);
    expect(turnkeyCalls).toHaveLength(0);
  });

  it('retries when another creator claims the seed first', async () => {
    let attempts = 0;
    const { store } = fakeStore();
    const { chain } = fakeChain({
      createAccount() {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new SeedTakenError('taken'));
        }
        return Promise.resolve({
          settingsSeed: 99n,
          settingsAddress: SETTINGS,
          vaultAddress: VAULT,
          signature: 'sig-1',
        });
      },
    });
    const { turnkey } = fakeTurnkey();

    const result = await new AccountService(
      chain,
      store,
      turnkey,
      fakeRecovery().recovery,
    ).createAccount(params());

    expect(attempts).toBe(3);
    expect(result.settingsSeed).toBe(99n);
  });

  it('gives up after losing the seed race repeatedly', async () => {
    const { store } = fakeStore();
    const { chain } = fakeChain({
      createAccount: () => Promise.reject(new SeedTakenError('taken')),
    });
    const { turnkey } = fakeTurnkey();

    await expect(
      new AccountService(
        chain,
        store,
        turnkey,
        fakeRecovery().recovery,
      ).createAccount(params()),
    ).rejects.toBeInstanceOf(AccountCreationError);
  });

  it('does not retry a failure that is not a lost seed race', async () => {
    let attempts = 0;
    const { store } = fakeStore();
    const { chain } = fakeChain({
      createAccount() {
        attempts++;
        return Promise.reject(new AccountCreationError('rpc down'));
      },
    });
    const { turnkey } = fakeTurnkey();

    await expect(
      new AccountService(
        chain,
        store,
        turnkey,
        fakeRecovery().recovery,
      ).createAccount(params()),
    ).rejects.toBeInstanceOf(AccountCreationError);
    expect(attempts).toBe(1);
  });

  it('enrols the approval signer before touching the chain', async () => {
    const order: string[] = [];
    const { store } = fakeStore();
    const { chain } = fakeChain({
      createAccount() {
        order.push('chain');
        return Promise.resolve({
          settingsSeed: 1n,
          settingsAddress: SETTINGS,
          vaultAddress: VAULT,
          signature: 'sig-1',
        });
      },
    });
    const turnkey = {
      enrolApprovalSigner() {
        order.push('turnkey');
        return Promise.resolve({
          subOrganizationId: SUB_ORG,
          address: APPROVAL,
        });
      },
    } as unknown as TurnkeyService;

    await new AccountService(
      chain,
      store,
      turnkey,
      fakeRecovery().recovery,
    ).createAccount(params());

    // An Account created first and then left without S2 would be a 2-of-3
    // with two usable signers, which is threshold 1 wearing a 2-of-3 label.
    expect(order).toEqual(['turnkey', 'chain']);
  });

  it('does not create an Account when enrolment fails', async () => {
    const { store, rows } = fakeStore();
    const { chain, calls } = fakeChain();
    const turnkey = {
      enrolApprovalSigner: () => Promise.reject(new Error('turnkey down')),
    } as unknown as TurnkeyService;

    await expect(
      new AccountService(
        chain,
        store,
        turnkey,
        fakeRecovery().recovery,
      ).createAccount(params()),
    ).rejects.toThrow('turnkey down');

    expect(calls).toHaveLength(0);
    expect(rows).toHaveLength(0);
  });

  it('refuses a signer set where two roles share an address', async () => {
    const { store } = fakeStore();
    const { chain, calls } = fakeChain();
    // Turnkey handing back the Privy address would make one compromise worth
    // two of three signers.
    const { turnkey } = fakeTurnkey(PRIMARY);

    await expect(
      new AccountService(
        chain,
        store,
        turnkey,
        fakeRecovery().recovery,
      ).createAccount(params()),
    ).rejects.toBeInstanceOf(IncompleteSignerSetError);

    expect(calls).toHaveLength(0);
  });

  it('refuses to create an Account without a recovery signer', async () => {
    const { store } = fakeStore();
    const { chain, calls } = fakeChain();
    const { turnkey } = fakeTurnkey();

    // D10b: S3 is mandatory at creation. Without it a lost phone is permanent
    // loss of funds rather than an inconvenience.
    await expect(
      new AccountService(
        chain,
        store,
        turnkey,
        fakeRecovery('').recovery,
      ).createAccount(params()),
    ).rejects.toBeInstanceOf(IncompleteSignerSetError);

    expect(calls).toHaveLength(0);
  });
});
