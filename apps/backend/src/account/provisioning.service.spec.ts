import { ConfigService } from '@nestjs/config';
import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  deriveAccountAddresses,
  derivePolicyAddress,
} from '@xend/smart-account';

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
import { ProvisioningService } from './provisioning.service';

const USER = 'user-1';
const PRIMARY = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
const APPROVAL = 'GkP9xL7mQwR2sT4vB6nH8jC3dF5aZ1yU2eW4rK6tN9pM';
const SETTINGS = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
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

const ADDRESSES = deriveAccountAddresses(ACCOUNT.settingsSeed);
const LIMIT_POLICY = derivePolicyAddress(
  ADDRESSES.settings,
  SPENDING_LIMIT_POLICY_SEED,
).toBase58();
const ABOVE_POLICY = derivePolicyAddress(
  ADDRESSES.settings,
  ABOVE_LIMIT_POLICY_SEED,
).toBase58();

const store: SquadsAccountStore = {
  findByUserId: () => Promise.resolve(ACCOUNT),
  insert: (row) => Promise.resolve(row),
  listAll: () => Promise.resolve([]),
  findUserEmail: () => Promise.resolve('consumer@example.com'),
  withUserLock: <T>(_userId: string, fn: () => Promise<T>) => fn(),
};

const config = {
  getOrThrow: () => USDC,
} as unknown as ConfigService;

interface ChainState {
  timeLockSeconds?: number;
  transactionIndex?: bigint;
  policies?: bigint[];
  proposal?: Partial<ProposalState> | null;
}

function fakeChain(state: ChainState = {}, messageBase64 = 'message') {
  const compiled: { instructions: unknown[] }[] = [];
  const submitted: string[] = [];

  const chain: ProvisioningChain = {
    rentPayer: AUTHORITY,
    readSettings: () =>
      Promise.resolve({
        timeLockSeconds: state.timeLockSeconds ?? 0,
        transactionIndex: state.transactionIndex ?? 0n,
      }),
    policyExists: (_settings, seed) =>
      Promise.resolve((state.policies ?? []).includes(seed)),
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
      compiled.push({ instructions: params.instructions });
      return Promise.resolve({
        unsignedTxBase64: 'unsigned',
        messageBase64,
        blockhash: 'hash',
        lastValidBlockHeight: 100,
      });
    },
    submit: (tx) => {
      submitted.push(tx);
      return Promise.resolve('sig-1');
    },
  };

  return { chain, compiled, submitted };
}

function service(chain: ProvisioningChain) {
  return new ProvisioningService(store, chain, config);
}

/** Every account any of the compiled instructions touches, base58. */
function keysOf(compiled: { instructions: unknown[] }): string[] {
  return (compiled.instructions as { keys: { pubkey: PublicKey }[] }[]).flatMap(
    (ix) => ix.keys.map((k) => k.pubkey.toBase58()),
  );
}

describe('ProvisioningService.prepareNext', () => {
  it('proposes one change for an Account carrying nothing yet', async () => {
    const { chain, compiled } = fakeChain();

    const plan = await service(chain).prepareNext(USER);

    expect(plan).toMatchObject({
      done: false,
      change: 'provision',
      step: 'propose',
      needsApprovalSignature: false,
    });
    // Create the settings transaction, then the proposal. Both policies and
    // the lock ride inside the first, which is what keeps this to one change
    // and so to one prompt from the approval signer.
    expect(compiled[0].instructions).toHaveLength(2);
  });

  it('keeps working while the lock is still open, even with both policies', async () => {
    const { chain } = fakeChain({
      policies: [SPENDING_LIMIT_POLICY_SEED, ABOVE_LIMIT_POLICY_SEED],
    });

    const plan = await service(chain).prepareNext(USER);

    expect(plan.done).toBe(false);
  });

  it('keeps working while a policy is missing, even with the lock on', async () => {
    const { chain } = fakeChain({
      policies: [SPENDING_LIMIT_POLICY_SEED],
      timeLockSeconds: 86400,
    });

    const plan = await service(chain).prepareNext(USER);

    expect(plan.done).toBe(false);
  });

  it('reports done once both policies exist and the lock is on', async () => {
    const { chain } = fakeChain({
      policies: [SPENDING_LIMIT_POLICY_SEED, ABOVE_LIMIT_POLICY_SEED],
      timeLockSeconds: 86400,
    });

    await expect(service(chain).prepareNext(USER)).resolves.toEqual({
      done: true,
      needsApprovalSignature: false,
    });
  });

  it('asks the primary to approve a proposal nobody has approved', async () => {
    const { chain } = fakeChain({
      transactionIndex: 3n,
      proposal: { approved: [], settled: false },
    });

    const plan = await service(chain).prepareNext(USER);

    expect(plan.step).toBe('approve-primary');
    expect(plan.needsApprovalSignature).toBe(false);
  });

  it('asks the approval signer second, and flags that it needs S2', async () => {
    const { chain } = fakeChain({
      transactionIndex: 3n,
      proposal: { approved: [PRIMARY], settled: false },
    });

    const plan = await service(chain).prepareNext(USER);

    expect(plan.step).toBe('approve-approval');
    // The only step in the whole sequence that costs a biometric prompt.
    expect(plan.needsApprovalSignature).toBe(true);
  });

  it('executes once both signers have approved', async () => {
    const { chain } = fakeChain({
      transactionIndex: 3n,
      proposal: { approved: [PRIMARY, APPROVAL], settled: false },
    });

    const plan = await service(chain).prepareNext(USER);

    expect(plan.step).toBe('execute');
    expect(plan.needsApprovalSignature).toBe(false);
  });

  it('hands both new policy accounts to the execute step, in order', async () => {
    const { chain, compiled } = fakeChain({
      transactionIndex: 3n,
      proposal: { approved: [PRIMARY, APPROVAL], settled: false },
    });

    await service(chain).prepareNext(USER);

    // The program consumes them as remaining accounts in the order the change
    // declared its actions. Swapped, each policy is written at the other's
    // address and the execution fails.
    const keys = keysOf(compiled[0]);
    expect(keys.indexOf(LIMIT_POLICY)).toBeGreaterThan(-1);
    expect(keys.indexOf(ABOVE_POLICY)).toBeGreaterThan(
      keys.indexOf(LIMIT_POLICY),
    );
  });

  it('charges the execute step to the authority, not the signer', async () => {
    const { chain, compiled } = fakeChain({
      transactionIndex: 3n,
      proposal: { approved: [PRIMARY, APPROVAL], settled: false },
    });

    await service(chain).prepareNext(USER);

    // Executing is where both policies allocate, so this is where their rent
    // is charged. The SDK bills the signer unless told otherwise, and the
    // signer here is a Consumer with no lamports, so the change died on a
    // System transfer after every approval had already been collected.
    expect(keysOf(compiled[0])).toContain(AUTHORITY);
  });

  it('executes a fully approved change rather than proposing another', async () => {
    const { chain, compiled } = fakeChain({
      transactionIndex: 3n,
      proposal: { approved: [PRIMARY, APPROVAL], settled: false },
    });

    const plan = await service(chain).prepareNext(USER);

    // Reading a fully approved proposal as finished sent provisioning back to
    // propose at the next index, so it re-proposed and re-approved forever,
    // four transactions and a fingerprint a lap, and never executed.
    expect(plan.step).toBe('execute');
    expect(compiled).toHaveLength(1);
  });

  it('starts at a fresh index once the last proposal settled', async () => {
    const { chain, compiled } = fakeChain({
      transactionIndex: 3n,
      // Executed, rejected or cancelled: index 3 is spent either way.
      proposal: { approved: [PRIMARY, APPROVAL], settled: true },
    });

    const plan = await service(chain).prepareNext(USER);

    expect(plan.step).toBe('propose');
    expect(compiled).toHaveLength(1);
  });

  it('funds rent from the authority, not the proposer', async () => {
    const { chain, compiled } = fakeChain();

    await service(chain).prepareNext(USER);

    // The proposer has no lamports at this point, and rent defaults to them.
    // Left alone it fails inside the program on a System transfer, after the
    // fee has already been paid, which reads as a program bug rather than an
    // unfunded account.
    expect(keysOf(compiled[0])).toContain(AUTHORITY);
  });

  it('never asks the Consumer to pay, because they have funded nothing yet', async () => {
    const { chain, compiled } = fakeChain({
      transactionIndex: 3n,
      proposal: { approved: [PRIMARY], settled: false },
    });

    await service(chain).prepareNext(USER);

    // The fee payer is picked inside the chain (the settlement authority), so
    // the service must not name one. Paying from S1 killed every step before
    // it reached the program: provisioning runs before a Consumer has any SOL.
    expect(compiled[0]).not.toHaveProperty('feePayer');
  });

  it('refuses to provision a Consumer with no Account', async () => {
    const { chain } = fakeChain();
    const empty: SquadsAccountStore = {
      ...store,
      findByUserId: () => Promise.resolve(null),
    };

    await expect(
      new ProvisioningService(empty, chain, config).prepareNext(USER),
    ).rejects.toThrow(/No Account/);
  });
});

describe('ProvisioningService.submit', () => {
  /** A real transaction, so the message comparison has something to compare. */
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

  it('forwards the step the Consumer was actually handed', async () => {
    const tx = signable();
    const { chain, submitted } = fakeChain({}, tx.messageBase64);
    // One instance: the prepared step is held per service, as the transfer
    // flow holds its intents.
    const provisioning = service(chain);

    await provisioning.prepareNext(USER);

    await expect(provisioning.submit(USER, tx.base64)).resolves.toBe('sig-1');
    expect(submitted).toEqual([tx.base64]);
  });

  it('refuses a transaction that is not the prepared step', async () => {
    // The authority signs partially, so anything it is handed comes back
    // signed. Only bytes this service compiled may reach it.
    const tx = signable();
    const { chain } = fakeChain({}, 'a-different-message');
    const provisioning = service(chain);

    await provisioning.prepareNext(USER);

    await expect(provisioning.submit(USER, tx.base64)).rejects.toThrow(
      /does not match the prepared provisioning step/,
    );
  });

  it('refuses a submission with no step awaiting a signature', async () => {
    const tx = signable();
    const { chain } = fakeChain();

    await expect(service(chain).submit(USER, tx.base64)).rejects.toThrow(
      /No provisioning step is awaiting/,
    );
  });
});
