import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  ABOVE_LIMIT_PROGRAM_ALLOWLIST,
  deriveAccountAddresses,
  describeTransaction,
  JUPITER_PROGRAM_ID,
} from '@prydd/smart-account';

import type { AccountEventsService } from '../activity/account-events.service';
import { InMemoryPreparedTxStore } from '../prepared/prepared-tx.memory';
import type { RecoveryService } from '../recovery/recovery.service';
import { AccountCreationError, SwapAccessError } from './account.errors';
import type {
  ProposalState,
  ProvisioningChain,
  SquadsAccountRow,
  SquadsAccountStore,
} from './account.interface';
import { SwapAccessService } from './swap-access.service';

const USER = 'user-1';
const ADDRESSES = deriveAccountAddresses(42n);
const PRIMARY = Keypair.generate();
const APPROVAL = Keypair.generate();
const AUTHORITY = Keypair.generate().publicKey;
const BLOCKHASH = 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k';
const DAY = 24 * 60 * 60;
const BEFORE_SWAP = ABOVE_LIMIT_PROGRAM_ALLOWLIST.filter(
  (program) => !program.equals(JUPITER_PROGRAM_ID),
);

function proposal(over: Partial<ProposalState> = {}): ProposalState {
  return {
    approved: [PRIMARY.publicKey.toBase58(), APPROVAL.publicKey.toBase58()],
    rejected: [],
    settled: false,
    status: 'Approved',
    statusTimestamp: BigInt(Math.floor(Date.now() / 1000)),
    ...over,
  };
}

function setUp({
  allowed = BEFORE_SWAP as readonly PublicKey[],
  row = {} as Partial<SquadsAccountRow>,
  proposalAt = null as ProposalState | null,
  transactionIndex = 7n,
  recoveryPending = false,
} = {}) {
  const state = {
    allowed,
    proposal: proposalAt,
    transactionIndex,
    account: {
      userId: USER,
      settingsSeed: 42n,
      settingsAddress: ADDRESSES.settings.toBase58(),
      vaultAddress: ADDRESSES.vault.toBase58(),
      primarySigner: PRIMARY.publicKey.toBase58(),
      approvalSigner: APPROVAL.publicKey.toBase58(),
      approvalSubOrgId: 'suborg-1',
      ...row,
    } as SquadsAccountRow,
  };
  const submitted: string[] = [];
  const recorded: string[] = [];

  const store = {
    findByUserId: () => Promise.resolve(state.account),
    updateByUserId: (_userId: string, patch: Partial<SquadsAccountRow>) => {
      state.account = { ...state.account, ...patch };
      return Promise.resolve(state.account);
    },
    withUserLock: <T>(_userId: string, fn: () => Promise<T>) => fn(),
  } as unknown as SquadsAccountStore;

  const chain = {
    rentPayer: AUTHORITY.toBase58(),
    readSettings: () =>
      Promise.resolve({
        timeLockSeconds: DAY,
        transactionIndex: state.transactionIndex,
        policySeed: 2n,
        signers: [],
      }),
    readAllowedPrograms: () => Promise.resolve([...state.allowed]),
    readProposal: () => Promise.resolve(state.proposal),
    compile: ({ instructions }: { instructions: TransactionInstruction[] }) => {
      const message = new TransactionMessage({
        payerKey: AUTHORITY,
        recentBlockhash: BLOCKHASH,
        instructions,
      }).compileToV0Message();
      return Promise.resolve({
        unsignedTxBase64: Buffer.from(
          new VersionedTransaction(message).serialize(),
        ).toString('base64'),
        messageBase64: Buffer.from(message.serialize()).toString('base64'),
        blockhash: BLOCKHASH,
        lastValidBlockHeight: 1,
      });
    },
    submit: (tx: string) => {
      submitted.push(tx);
      return Promise.resolve('signature');
    },
  } as unknown as ProvisioningChain;

  const events = {
    recordSettingsChangeStaged: (_u: string, p: { change?: string }) => {
      recorded.push(`staged:${p.change}`);
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
  } as unknown as AccountEventsService;

  const recovery = {
    pendingChange: () => Promise.resolve(recoveryPending ? {} : null),
  } as unknown as RecoveryService;

  return {
    service: new SwapAccessService(
      store,
      chain,
      recovery,
      events,
      new InMemoryPreparedTxStore(),
    ),
    state,
    submitted,
    recorded,
  };
}

describe('SwapAccessService', () => {
  describe('status', () => {
    it('is ready once the policy admits the swap program', async () => {
      const { service } = setUp({ allowed: ABOVE_LIMIT_PROGRAM_ALLOWLIST });
      await expect(service.status(USER)).resolves.toEqual({ state: 'ready' });
    });

    it('is off for an Account set up before Swap', async () => {
      const { service } = setUp();
      await expect(service.status(USER)).resolves.toEqual({ state: 'off' });
    });

    it('says when a change in flight can land', async () => {
      const approvedAt = Math.floor(Date.now() / 1000) - 60;
      const { service } = setUp({
        row: { pendingSwapAccessChangeIndex: '8' },
        proposalAt: proposal({ statusTimestamp: BigInt(approvedAt) }),
      });
      await expect(service.status(USER)).resolves.toEqual({
        state: 'pending',
        executableAt: new Date((approvedAt + DAY) * 1000).toISOString(),
      });
    });
  });

  describe('status after an interruption', () => {
    it('clears a change that landed while the app was closed', async () => {
      const { service, state, recorded } = setUp({
        allowed: ABOVE_LIMIT_PROGRAM_ALLOWLIST,
        row: { pendingSwapAccessChangeIndex: '8' },
        proposalAt: proposal({ settled: true, status: 'Executed' }),
      });
      await expect(service.status(USER)).resolves.toEqual({ state: 'ready' });
      expect(state.account.pendingSwapAccessChangeIndex).toBeNull();
      expect(recorded).toEqual(['executed']);
    });

    it('clears a change the Consumer rejected from another screen', async () => {
      const { service, state, recorded } = setUp({
        row: { pendingSwapAccessChangeIndex: '8' },
        proposalAt: proposal({ settled: true, status: 'Rejected' }),
      });
      await expect(service.status(USER)).resolves.toEqual({ state: 'off' });
      expect(state.account.pendingSwapAccessChangeIndex).toBeNull();
      expect(recorded).toEqual(['rejected']);
    });

    it('is off, and can be started again, when nothing was confirmed', async () => {
      const { service, state } = setUp();
      const first = await service.start(USER);
      await expect(service.status(USER)).resolves.toEqual({ state: 'off' });
      // The transaction could still be signed, so the change is kept.
      expect(state.account.pendingSwapAccessChangeIndex).toBe('8');

      const again = await service.start(USER);
      expect(again).toMatchObject({
        step: 'stage',
        changeIndex: first.changeIndex,
        needsApprovalSignature: true,
      });
    });

    it('forgets an unconfirmed change once it can no longer be sent', async () => {
      const { service, state, recorded } = setUp({
        row: { pendingSwapAccessChangeIndex: '8' },
      });
      await expect(service.status(USER)).resolves.toEqual({ state: 'off' });
      expect(state.account.pendingSwapAccessChangeIndex).toBeNull();
      expect(recorded).toEqual(['rejected']);
    });

    it('asks for the missing approval again instead of waiting on it', async () => {
      const { service } = setUp({
        row: { pendingSwapAccessChangeIndex: '8' },
        proposalAt: proposal({
          approved: [PRIMARY.publicKey.toBase58()],
          status: 'Active',
          statusTimestamp: null,
        }),
      });
      await expect(service.status(USER)).resolves.toEqual({ state: 'off' });
      await expect(service.start(USER)).resolves.toMatchObject({
        step: 'approve',
        needsApprovalSignature: true,
      });
    });
  });

  describe('start', () => {
    it('carries the whole change in one transaction both keys sign', async () => {
      const { service, state, recorded } = setUp();
      const plan = await service.start(USER);

      expect(plan).toMatchObject({
        done: false,
        step: 'stage',
        changeIndex: '8',
        needsApprovalSignature: true,
      });
      expect(state.account.pendingSwapAccessChangeIndex).toBe('8');
      expect(recorded).toEqual(['staged:swap_access']);

      const described = describeTransaction(plan.unsignedTxBase64!, {
        addresses: ADDRESSES,
      });
      if (described.kind !== 'settings') throw new Error(described.kind);
      expect(
        described.votes.map((v) => `${v.kind}:${v.signer.toBase58()}`),
      ).toEqual([
        `approve:${PRIMARY.publicKey.toBase58()}`,
        `approve:${APPROVAL.publicKey.toBase58()}`,
      ]);
      expect(described.actions).toHaveLength(1);
      const [action] = described.actions;
      if (
        action.kind !== 'policy-update' ||
        action.terms.kind !== 'program-interaction'
      ) {
        throw new Error('not an allowlist update');
      }
      expect(action.terms.allowedPrograms.map(String)).toEqual(
        ABOVE_LIMIT_PROGRAM_ALLOWLIST.map(String),
      );
      // Nothing else about the policy moves.
      expect(action.terms.signers.map(String)).toEqual([
        PRIMARY.publicKey.toBase58(),
        APPROVAL.publicKey.toBase58(),
      ]);
      expect(action.terms.threshold).toBe(2);
      expect(action.terms.timeLock).toBe(0);
    });

    it('refuses when Swap is already on', async () => {
      const { service } = setUp({ allowed: ABOVE_LIMIT_PROGRAM_ALLOWLIST });
      await expect(service.start(USER)).rejects.toBeInstanceOf(SwapAccessError);
    });

    it.each([
      ['a device rotation', { pendingApprovalChangeIndex: '8' }],
      ['a passkey replacement', { pendingPrimaryChangeIndex: '8' }],
      ['a Spending Limit change', { pendingSpendingLimitChangeIndex: '8' }],
    ])('refuses while %s holds the next index', async (_, row) => {
      const { service, recorded } = setUp({ row });
      await expect(service.start(USER)).rejects.toBeInstanceOf(SwapAccessError);
      expect(recorded).toEqual([]);
    });

    it('refuses while a recovery key change is in flight', async () => {
      const { service } = setUp({ recoveryPending: true });
      await expect(service.start(USER)).rejects.toBeInstanceOf(SwapAccessError);
    });

    it('refuses a second start while the first is waiting', async () => {
      const { service } = setUp({
        row: { pendingSwapAccessChangeIndex: '8' },
        proposalAt: proposal(),
      });
      await expect(service.start(USER)).rejects.toBeInstanceOf(SwapAccessError);
    });
  });

  describe('next', () => {
    const staged = { pendingSwapAccessChangeIndex: '8' };

    it('is done when nothing is staged', async () => {
      const { service } = setUp();
      await expect(service.next(USER)).resolves.toEqual({ done: true });
    });

    it('hands the staging transaction back when it never landed', async () => {
      const { service } = setUp({ row: staged });
      await expect(service.next(USER)).resolves.toMatchObject({
        step: 'stage',
        changeIndex: '8',
      });
    });

    it('forgets a change the index moved on without', async () => {
      const { service, state, recorded } = setUp({
        row: staged,
        transactionIndex: 9n,
      });
      await expect(service.next(USER)).resolves.toEqual({ done: true });
      expect(state.account.pendingSwapAccessChangeIndex).toBeNull();
      expect(recorded).toEqual(['rejected']);
    });

    it('waits out the lock, counted from the approval', async () => {
      const { service } = setUp({ row: staged, proposalAt: proposal() });
      await expect(service.next(USER)).resolves.toMatchObject({
        step: 'waiting',
        changeIndex: '8',
      });
    });

    it('asks for an approval the staging transaction did not carry', async () => {
      const { service } = setUp({
        row: staged,
        proposalAt: proposal({
          approved: [PRIMARY.publicKey.toBase58()],
          status: 'Active',
        }),
      });
      await expect(service.next(USER)).resolves.toMatchObject({
        step: 'approve',
        needsApprovalSignature: true,
      });
    });

    it('prepares the execute once the lock has run out', async () => {
      const { service } = setUp({
        row: staged,
        proposalAt: proposal({
          statusTimestamp: BigInt(Math.floor(Date.now() / 1000) - DAY - 5),
        }),
      });
      const plan = await service.next(USER);
      expect(plan).toMatchObject({
        step: 'execute',
        needsApprovalSignature: false,
      });
      expect(
        describeTransaction(plan.unsignedTxBase64!, { addresses: ADDRESSES }),
      ).toMatchObject({ kind: 'vote', votes: [{ kind: 'execute' }] });
    });

    it('settles an executed change against what the policy now holds', async () => {
      const { service, state, recorded } = setUp({
        row: staged,
        allowed: ABOVE_LIMIT_PROGRAM_ALLOWLIST,
        proposalAt: proposal({ settled: true, status: 'Executed' }),
      });
      await expect(service.next(USER)).resolves.toEqual({ done: true });
      expect(state.account.pendingSwapAccessChangeIndex).toBeNull();
      expect(recorded).toEqual(['executed']);
    });

    it('will not call Swap on when the executed change was not this one', async () => {
      const { service, state } = setUp({
        row: staged,
        proposalAt: proposal({ settled: true, status: 'Executed' }),
      });
      await expect(service.next(USER)).rejects.toBeInstanceOf(
        AccountCreationError,
      );
      expect(state.account.pendingSwapAccessChangeIndex).toBe('8');
    });

    it('forgets a change the Consumer rejected', async () => {
      const { service, state, recorded } = setUp({
        row: staged,
        proposalAt: proposal({ settled: true, status: 'Rejected' }),
      });
      await expect(service.next(USER)).resolves.toEqual({ done: true });
      expect(state.account.pendingSwapAccessChangeIndex).toBeNull();
      expect(recorded).toEqual(['rejected']);
    });
  });

  describe('submit', () => {
    it('lands the step it prepared and nothing else', async () => {
      const { service, submitted } = setUp();
      const plan = await service.start(USER);
      await expect(service.submit(USER, 'AAAA')).rejects.toBeInstanceOf(
        AccountCreationError,
      );
      await expect(service.submit(USER, plan.unsignedTxBase64!)).resolves.toBe(
        'signature',
      );
      expect(submitted).toEqual([plan.unsignedTxBase64]);
    });
  });
});
