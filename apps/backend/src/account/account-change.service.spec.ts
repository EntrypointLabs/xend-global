import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { SETTINGS_TIME_LOCK_SECONDS } from '@xend/smart-account';

import { AccountChangeService } from './account-change.service';
import {
  ABOVE_LIMIT_POLICY_SEED,
  SPENDING_LIMIT_POLICY_SEED,
} from './account.interface';
import type {
  ProposalState,
  ProvisioningChain,
  SquadsAccountRow,
  SquadsAccountStore,
} from './account.interface';

const USER = 'user-1';
const PRIMARY = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
const APPROVAL = 'GkP9xL7mQwR2sT4vB6nH8jC3dF5aZ1yU2eW4rK6tN9pM';
const SETTINGS = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const AUTHORITY = 'Eo5wriQzhkJrQKEwTLMBMBDdCq1tE7QzKw8ias91pft5';

const ACCOUNT: SquadsAccountRow = {
  userId: USER,
  settingsSeed: 42n,
  settingsAddress: SETTINGS,
  vaultAddress: 'Vau1t111111111111111111111111111111111111111',
  primarySigner: PRIMARY,
  approvalSigner: APPROVAL,
  approvalSubOrgId: 'suborg-1',
};

function store(row: SquadsAccountRow | null = ACCOUNT): SquadsAccountStore {
  return {
    findByUserId: () => Promise.resolve(row),
    insert: (r) => Promise.resolve(r),
    listAll: () => Promise.resolve(row ? [row] : []),
    findUserEmail: () => Promise.resolve('consumer@example.com'),
    withUserLock: <T>(_userId: string, fn: () => Promise<T>) => fn(),
  };
}

interface ChainState {
  /** Provisioned by default, which is when a staged change is worth telling. */
  provisioned?: boolean;
  transactionIndex?: bigint;
  proposal?: Partial<ProposalState> | null;
}

function fakeChain(state: ChainState = {}, messageBase64 = 'message') {
  const submitted: string[] = [];
  const compiled: unknown[][] = [];
  const provisioned = state.provisioned ?? true;

  const chain: ProvisioningChain = {
    rentPayer: AUTHORITY,
    readSettings: () =>
      Promise.resolve({
        timeLockSeconds: provisioned ? SETTINGS_TIME_LOCK_SECONDS : 0,
        transactionIndex: state.transactionIndex ?? 7n,
      }),
    policyExists: (_settings, seed) =>
      Promise.resolve(
        provisioned &&
          [SPENDING_LIMIT_POLICY_SEED, ABOVE_LIMIT_POLICY_SEED].includes(seed),
      ),
    readProposal: () =>
      Promise.resolve(
        state.proposal
          ? {
              approved: [],
              settled: false,
              status: 'Active',
              statusTimestamp: null,
              ...state.proposal,
            }
          : null,
      ),
    compile: (params) => {
      compiled.push(params.instructions);
      return Promise.resolve({
        unsignedTxBase64: 'unsigned',
        messageBase64,
        blockhash: 'hash',
        lastValidBlockHeight: 100,
      });
    },
    submit: (tx) => {
      submitted.push(tx);
      return Promise.resolve('sig-reject');
    },
  };

  return { chain, submitted, compiled };
}

function service(chain: ProvisioningChain, row?: SquadsAccountRow | null) {
  return new AccountChangeService(store(row), chain);
}

function signable() {
  const message = new TransactionMessage({
    payerKey: new PublicKey(AUTHORITY),
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  return {
    base64: Buffer.from(tx.serialize()).toString('base64'),
    messageBase64: Buffer.from(message.serialize()).toString('base64'),
  };
}

describe('AccountChangeService.pending', () => {
  it('reports a change staged against a provisioned Account', async () => {
    const approvedAt = 1_700_000_000n;
    const { chain } = fakeChain({
      proposal: { status: 'Approved', statusTimestamp: approvedAt },
    });

    const staged = await service(chain).pending(USER);

    expect(staged?.transactionIndex).toBe('7');
    // The deadline for rejecting, which is the only thing the time lock buys.
    expect(staged?.executableAt).toBe(
      new Date(
        Number(approvedAt + BigInt(SETTINGS_TIME_LOCK_SECONDS)) * 1000,
      ).toISOString(),
    );
  });

  it('says nothing while the Consumer is still provisioning', async () => {
    const { chain } = fakeChain({
      provisioned: false,
      proposal: { status: 'Active' },
    });

    // Provisioning is a settings change the Consumer is making themselves, in
    // the foreground. Warning them about it teaches them to dismiss the notice
    // that matters later.
    await expect(service(chain).pending(USER)).resolves.toBeNull();
  });

  it('says nothing about a change that is already settled', async () => {
    const { chain } = fakeChain({
      proposal: { status: 'Executed', settled: true },
    });

    await expect(service(chain).pending(USER)).resolves.toBeNull();
  });

  it('says nothing when no change is in flight', async () => {
    const { chain } = fakeChain({ proposal: null });

    await expect(service(chain).pending(USER)).resolves.toBeNull();
  });
});

describe('AccountChangeService rejection', () => {
  it('refuses to prepare a rejection when nothing is staged', async () => {
    const { chain } = fakeChain({ proposal: null });

    await expect(service(chain).prepareRejection(USER)).rejects.toThrow();
  });

  it('submits the rejection it prepared', async () => {
    const tx = signable();
    const { chain, submitted } = fakeChain(
      { proposal: { status: 'Active' } },
      tx.messageBase64,
    );
    const changes = service(chain);

    await changes.prepareRejection(USER);
    const signature = await changes.submitRejection(USER, tx.base64);

    expect(submitted).toEqual([tx.base64]);
    expect(signature).toBe('sig-reject');
  });

  it('refuses a transaction that is not the prepared rejection', async () => {
    const { chain, submitted } = fakeChain(
      { proposal: { status: 'Active' } },
      'a-different-message',
    );
    const changes = service(chain);

    await changes.prepareRejection(USER);

    // The authority signs whatever arrives here, so unpinned this endpoint
    // would sign anything naming it as fee payer.
    await expect(
      changes.submitRejection(USER, signable().base64),
    ).rejects.toThrow();
    expect(submitted).toEqual([]);
  });

  it('refuses a submission with no rejection awaiting a signature', async () => {
    const { chain } = fakeChain({ proposal: { status: 'Active' } });

    await expect(
      service(chain).submitRejection(USER, signable().base64),
    ).rejects.toThrow();
  });
});
