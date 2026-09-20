import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import type { DbService } from '../db/db.service';
import type { CapacityService } from '../capability/capacity.service';
import type { EventPublisher } from '../events/event-publisher.interface';
import { paymentAttempts } from '../db/schema';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import type { PaymentIntentService } from '../payment/payment-intent.service';
import { IntentExpiredError } from '../payment/payment.errors';
import type { SpendService } from '../account/spend.service';
import type { SettlementProvisioningService } from './settlement-provisioning.service';
import type { SettlementConfirmationService } from './settlement-confirmation.service';
import { SettlementService } from './settlement.service';
import {
  IntentNotSettleableError,
  FiatSettlementDisabledError,
  SettlementAccountNotProvisionedError,
  SettlementMessageMismatchError,
} from './settlement.errors';

const USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const FEE_PAYER = Keypair.generate().publicKey.toBase58();
const VAULT = Keypair.generate().publicKey.toBase58();
const ENDPOINT = Keypair.generate().publicKey.toBase58();
const ENDPOINT_OWNER = Keypair.generate().publicKey.toBase58();
const PRIMARY_KEY = Keypair.generate();
const PRIMARY_SIGNER = PRIMARY_KEY.publicKey.toBase58();
const BLOCKHASH = Keypair.generate().publicKey.toBase58();

function buildWireAndMessage(): { wire: string; messageBase64: string } {
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: new PublicKey(FEE_PAYER),
      recentBlockhash: BLOCKHASH,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: PRIMARY_KEY.publicKey,
          toPubkey: new PublicKey(ENDPOINT),
          lamports: 1,
        }),
      ],
    }).compileToV0Message(),
  );
  tx.sign([PRIMARY_KEY]);
  return {
    wire: Buffer.from(tx.serialize()).toString('base64'),
    messageBase64: Buffer.from(tx.message.serialize()).toString('base64'),
  };
}

interface AttemptRow {
  id: string;
  status: 'authorized' | 'settling';
  messageBase64: string | null;
  txSignature: string | null;
}

function makeConfig(): ConfigService {
  return {
    getOrThrow: (key: string): string => {
      if (key === 'EXPO_PUBLIC_USDC_MINT_ADDRESS') return USDC;
      if (key === 'SOLANA_CLUSTER') return 'devnet';
      throw new Error(`missing config ${key}`);
    },
  } as unknown as ConfigService;
}

function makeDb(cfg: {
  attempt?: AttemptRow;
  updateReturning?: { id: string }[][];
  stateful?: boolean;
}): DbService {
  const updates = [...(cfg.updateReturning ?? [])];
  const client = {
    select: () => ({
      from: (tbl: unknown) => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(cfg.attempt ? [cfg.attempt] : []),
          }),
          limit: () => {
            if (tbl === paymentAttempts)
              return Promise.resolve(cfg.attempt ? [cfg.attempt] : []);
            return Promise.resolve([]);
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: Partial<AttemptRow>) => ({
        where: () => ({
          returning: () => {
            const result = updates.shift() ?? [];
            if (cfg.stateful && result.length && cfg.attempt)
              Object.assign(cfg.attempt, values);
            return Promise.resolve(result);
          },
        }),
      }),
    }),
  };
  let lockTail = Promise.resolve();
  const withAdvisoryLock = jest.fn(
    (_key: string, fn: () => Promise<unknown>) => {
      const next = lockTail.then(fn);
      lockTail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  );
  const withTransaction = jest.fn((fn: () => Promise<unknown>) => fn());
  return { client, withAdvisoryLock, withTransaction } as unknown as DbService;
}

function makeIntents(intent: Record<string, unknown>) {
  const findById = jest.fn().mockResolvedValue({
    executionCluster: 'devnet',
    expiresAt: new Date(Date.now() + 60000),
    ...intent,
  });
  const transition = jest.fn().mockResolvedValue(intent);
  return {
    intents: { findById, transition } as unknown as PaymentIntentService,
    findById,
    transition,
  };
}

function makeProvisioning(address: string, error?: Error) {
  const getSettlementAddressForSettlement = error
    ? jest.fn().mockRejectedValue(error)
    : jest.fn().mockResolvedValue({
        address,
        owner: ENDPOINT_OWNER,
        provider: 'direct_usdc',
      });
  return {
    provisioning: {
      getSettlementAddressForSettlement,
    } as unknown as SettlementProvisioningService,
    getSettlementAddressForSettlement,
  };
}

function makeSpends(
  signature = 'sig-1',
  prepared: Partial<{
    messageBase64: string;
    route: 'spending-limit' | 'two-signature';
    needsApprovalSignature: boolean;
  }> = {},
) {
  const prepare = jest.fn().mockResolvedValue({
    unsignedTxBase64: 'UNSIGNED',
    messageBase64: prepared.messageBase64 ?? 'PINNED_MESSAGE',
    vaultAddress: VAULT,
    primarySigner: PRIMARY_SIGNER,
    blockhash: BLOCKHASH,
    lastValidBlockHeight: 1_000,
    route: prepared.route ?? 'spending-limit',
    needsApprovalSignature: prepared.needsApprovalSignature ?? false,
  });
  const submit = jest.fn<Promise<string>, [string]>(() =>
    Promise.resolve(signature),
  );
  return {
    spends: { prepare, submit } as unknown as SpendService,
    prepare,
    submit,
  };
}

function makeSolana(overrides: Partial<SolanaRpc> = {}): SolanaRpc {
  return {
    getRecentBlockhash: jest.fn().mockResolvedValue({
      blockhash: BLOCKHASH,
      lastValidBlockHeight: 1_000,
    }),
    getSignatureStatuses: jest
      .fn()
      .mockResolvedValue([
        { signature: 'sig-1', slot: null, confirmationStatus: null, err: null },
      ]),
    ...overrides,
  } as unknown as SolanaRpc;
}

function makeConfirmation(): SettlementConfirmationService {
  return {
    awaitConfirmation: jest.fn().mockResolvedValue(undefined),
  } as unknown as SettlementConfirmationService;
}

function makeService(deps: {
  db: DbService;
  solana: SolanaRpc;
  intents: PaymentIntentService;
  provisioning: SettlementProvisioningService;
  spends: SpendService;
  confirmation?: SettlementConfirmationService;
  capacity?: CapacityService;
  events?: EventPublisher;
}): SettlementService {
  const service = new SettlementService(
    deps.db,
    makeConfig(),
    deps.solana,
    deps.capacity ??
      ({ releaseCapacity: jest.fn() } as unknown as CapacityService),
    deps.intents,
    deps.provisioning,
    deps.spends,
    deps.confirmation ?? makeConfirmation(),
    deps.events ?? ({ publish: jest.fn() } as unknown as EventPublisher),
  );
  service.onModuleInit();
  return service;
}

describe('SettlementService', () => {
  it.each([null, 'mainnet-beta'])(
    'rejects a Payment bound to %s before preparing, submitting or reconciling',
    async (executionCluster) => {
      const { intents } = makeIntents({
        id: 'pi_1',
        status: 'created',
        executionCluster,
      });
      const { spends, prepare, submit } = makeSpends();
      const { provisioning } = makeProvisioning(ENDPOINT);
      const solana = makeSolana();
      const service = makeService({
        db: makeDb({}),
        solana,
        intents,
        provisioning,
        spends,
      });
      await expect(service.buildSettlement('pi_1', 'u_1')).rejects.toThrow(
        'Payment network',
      );
      await expect(service.submitSettlement('pi_1', 'unused')).rejects.toThrow(
        'Payment network',
      );
      await expect(service.resolveInFlight('pi_1')).rejects.toThrow(
        'Payment network',
      );
      expect(prepare).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
    },
  );

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  describe('buildSettlement', () => {
    it('rejects fiat settlement before preparing a Consumer Spend', async () => {
      const { intents, transition } = makeIntents({
        id: 'pi_1',
        status: 'created',
        merchantId: 'm_1',
        displayCurrency: 'NGN',
        usdcSettlementRaw: '1000000',
      });
      const { provisioning, getSettlementAddressForSettlement } =
        makeProvisioning(ENDPOINT);
      getSettlementAddressForSettlement.mockResolvedValue({
        address: ENDPOINT,
        owner: ENDPOINT_OWNER,
        provider: 'blockradar',
      });
      const { spends, prepare, submit } = makeSpends();
      const service = makeService({
        db: makeDb({}),
        solana: makeSolana(),
        intents,
        provisioning,
        spends,
      });
      await expect(service.buildSettlement('pi_1', 'u_1')).rejects.toThrow(
        FiatSettlementDisabledError,
      );
      expect(prepare).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
      expect(transition).not.toHaveBeenCalled();
    });

    it('builds the Spend out of the vault into the Merchant endpoint and writes nothing', async () => {
      const { intents, transition } = makeIntents({
        id: 'pi_1',
        status: 'created',
        consumerId: 'u_1',
        merchantId: 'm_1',
        usdcSettlementRaw: '1000000',
      });
      const { provisioning, getSettlementAddressForSettlement } =
        makeProvisioning(ENDPOINT);
      const { spends, prepare } = makeSpends();
      const service = makeService({
        db: makeDb({
          attempt: {
            id: 'att_1',
            status: 'authorized',
            messageBase64: null,
            txSignature: null,
          },
          updateReturning: [[{ id: 'att_1' }]],
        }),
        solana: makeSolana(),
        intents,
        provisioning,
        spends,
      });

      const out = await service.buildSettlement('pi_1', 'u_1');

      expect(out.expectedSettlementAccount).toBe(ENDPOINT);
      expect(out.unsignedTxBase64).toBeTruthy();
      expect(out.messageBase64).toBeTruthy();
      expect(out.needsApprovalSignature).toBe(false);
      expect(getSettlementAddressForSettlement).toHaveBeenCalledWith('m_1');
      // The money leaves the Consumer's vault and lands in the Merchant's own
      // settlement account, which the endpoint's owner has to be named for.
      expect(prepare).toHaveBeenCalledWith({
        userId: 'u_1',
        destination: ENDPOINT_OWNER,
        destinationTokenAccount: ENDPOINT,
        mint: USDC,
        amountRaw: '1000000',
        decimals: 6,
      });
      // Nothing has moved: the caller has to be able to refuse a Payment the
      // Account cannot carry while the intent is still untouched.
      expect(transition).not.toHaveBeenCalled();
    });

    it('reports when the Spend also needs the approval signer', async () => {
      const { intents } = makeIntents({
        id: 'pi_1',
        status: 'created',
        consumerId: 'u_1',
        merchantId: 'm_1',
        usdcSettlementRaw: '1000000',
      });
      const { provisioning } = makeProvisioning(ENDPOINT);
      const { spends } = makeSpends('sig-1', {
        route: 'two-signature',
        needsApprovalSignature: true,
      });
      const service = makeService({
        db: makeDb({}),
        solana: makeSolana(),
        intents,
        provisioning,
        spends,
      });

      const out = await service.buildSettlement('pi_1', 'u_1');

      expect(out.needsApprovalSignature).toBe(true);
    });

    it('rejects an intent past the payable states with INTENT_NOT_SETTLEABLE', async () => {
      const { intents } = makeIntents({
        id: 'pi_1',
        status: 'settling',
        consumerId: 'u_1',
        merchantId: 'm_1',
        usdcSettlementRaw: '1000000',
      });
      const { provisioning } = makeProvisioning(ENDPOINT);
      const { spends } = makeSpends();
      const service = makeService({
        db: makeDb({}),
        solana: makeSolana(),
        intents,
        provisioning,
        spends,
      });

      await expect(service.buildSettlement('pi_1', 'u_1')).rejects.toThrow(
        IntentNotSettleableError,
      );
    });

    it('propagates SETTLEMENT_ACCOUNT_NOT_PROVISIONED for an unprovisioned merchant', async () => {
      const { intents } = makeIntents({
        id: 'pi_1',
        status: 'authorized',
        consumerId: 'u_1',
        merchantId: 'm_1',
        usdcSettlementRaw: '1000000',
      });
      const { provisioning } = makeProvisioning(
        ENDPOINT,
        new SettlementAccountNotProvisionedError('nope'),
      );
      const { spends } = makeSpends();
      const service = makeService({
        db: makeDb({
          attempt: {
            id: 'att_1',
            status: 'authorized',
            messageBase64: null,
            txSignature: null,
          },
        }),
        solana: makeSolana(),
        intents,
        provisioning,
        spends,
      });

      await expect(service.buildSettlement('pi_1', 'u_1')).rejects.toThrow(
        SettlementAccountNotProvisionedError,
      );
    });
  });

  describe('pinSettlement', () => {
    const built = {
      unsignedTxBase64: 'UNSIGNED',
      messageBase64: 'PINNED_MESSAGE',
      blockhash: BLOCKHASH,
      expectedSettlementAccount: ENDPOINT,
      signerAddress: PRIMARY_SIGNER,
      needsApprovalSignature: false,
    };

    it('records the built message on the live authorized attempt', async () => {
      const { intents } = makeIntents({ id: 'pi_1', status: 'authorized' });
      const { provisioning } = makeProvisioning(ENDPOINT);
      const { spends } = makeSpends();
      const service = makeService({
        db: makeDb({
          attempt: {
            id: 'att_1',
            status: 'authorized',
            messageBase64: null,
            txSignature: null,
          },
          updateReturning: [[{ id: 'att_1' }]],
        }),
        solana: makeSolana(),
        intents,
        provisioning,
        spends,
      });

      await expect(service.pinSettlement('pi_1', built)).resolves.toEqual({
        attemptId: 'att_1',
      });
    });

    it('refuses an intent with no live authorized attempt', async () => {
      const { intents } = makeIntents({ id: 'pi_1', status: 'authorized' });
      const { provisioning } = makeProvisioning(ENDPOINT);
      const { spends } = makeSpends();
      const service = makeService({
        db: makeDb({}),
        solana: makeSolana(),
        intents,
        provisioning,
        spends,
      });

      await expect(service.pinSettlement('pi_1', built)).rejects.toThrow(
        IntentNotSettleableError,
      );
    });
  });

  describe('submitSettlement', () => {
    it('serializes concurrent submissions of the same intent before signing and broadcasting', async () => {
      const { wire, messageBase64 } = buildWireAndMessage();
      const { intents } = makeIntents({
        id: 'pi_1',
        status: 'authorized',
        consumerId: 'u_1',
        merchantId: 'm_1',
      });
      const { provisioning } = makeProvisioning(ENDPOINT);
      const { spends, submit } = makeSpends('sig-once');
      const db = makeDb({
        attempt: {
          id: 'att_1',
          status: 'authorized',
          messageBase64,
          txSignature: null,
        },
        updateReturning: [[{ id: 'att_1' }]],
        stateful: true,
      });
      const service = makeService({
        db,
        solana: makeSolana(),
        intents,
        provisioning,
        spends,
      });
      const outcomes = await Promise.allSettled([
        service.submitSettlement('pi_1', wire),
        service.submitSettlement('pi_1', wire),
      ]);
      expect(submit).toHaveBeenCalledTimes(1);
      expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(
        true,
      );
      // This is an assertion on a Jest mock, not an invocation detached from db.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(db.withAdvisoryLock).toHaveBeenCalledWith(
        'payment-submit:pi_1',
        expect.any(Function),
      );
    });

    it('does not broadcast when approval outlives the quote', async () => {
      const { wire, messageBase64 } = buildWireAndMessage();
      const authorizedAt = new Date('2026-01-31T23:59:59.000Z');
      const { intents, transition } = makeIntents({
        id: 'pi_1',
        consumerId: 'u_1',
        merchantId: 'm_1',
        usdcSettlementRaw: '1000000',
        status: 'authorized',
        expiresAt: new Date(Date.now() - 1),
        authorizedAt,
      });
      const { provisioning } = makeProvisioning(ENDPOINT);
      const { spends, submit } = makeSpends();
      const releaseCapacity = jest.fn().mockResolvedValue(undefined);
      const publish = jest.fn().mockResolvedValue(undefined);
      const service = makeService({
        db: makeDb({
          attempt: {
            id: 'att_1',
            status: 'authorized',
            messageBase64,
            txSignature: null,
          },
          updateReturning: [[{ id: 'att_1' }]],
        }),
        solana: makeSolana(),
        intents,
        provisioning,
        spends,
        capacity: { releaseCapacity } as unknown as CapacityService,
        events: { publish } as unknown as EventPublisher,
      });
      await expect(service.submitSettlement('pi_1', wire)).rejects.toThrow(
        IntentExpiredError,
      );
      expect(submit).not.toHaveBeenCalled();
      expect(transition).toHaveBeenCalledWith(
        'pi_1',
        'authorized',
        'expired',
        {},
      );
      expect(releaseCapacity).toHaveBeenCalledWith(
        'u_1',
        '1000000',
        authorizedAt,
      );
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'payment.expired', key: 'pi_1' }),
      );
    });
    it('rejects a previously prepared fiat Payment without broadcasting', async () => {
      const { wire, messageBase64 } = buildWireAndMessage();
      const { intents } = makeIntents({
        id: 'pi_1',
        consumerId: 'u_1',
        merchantId: 'm_1',
        status: 'authorized',
      });
      const { provisioning, getSettlementAddressForSettlement } =
        makeProvisioning(ENDPOINT);
      getSettlementAddressForSettlement.mockResolvedValue({
        address: ENDPOINT,
        owner: ENDPOINT_OWNER,
        provider: 'blockradar',
      });
      const { spends, submit } = makeSpends();
      const service = makeService({
        db: makeDb({
          attempt: {
            id: 'att_1',
            status: 'authorized',
            messageBase64,
            txSignature: null,
          },
        }),
        solana: makeSolana(),
        intents,
        provisioning,
        spends,
      });
      await expect(service.submitSettlement('pi_1', wire)).rejects.toThrow(
        FiatSettlementDisabledError,
      );
      expect(submit).not.toHaveBeenCalled();
    });
    it('rejects a signed tx whose message diverges from the pinned message and never reaches the authority', async () => {
      const { wire } = buildWireAndMessage();
      const { intents } = makeIntents({
        id: 'pi_1',
        status: 'authorized',
        consumerId: 'u_1',
        merchantId: 'm_1',
        usdcSettlementRaw: '1000000',
      });
      const { provisioning } = makeProvisioning(ENDPOINT);
      const { spends, submit } = makeSpends();
      const service = makeService({
        db: makeDb({
          attempt: {
            id: 'att_1',
            status: 'authorized',
            messageBase64: 'A_DIFFERENT_PINNED_MESSAGE',
            txSignature: null,
          },
        }),
        solana: makeSolana(),
        intents,
        provisioning,
        spends,
      });

      await expect(service.submitSettlement('pi_1', wire)).rejects.toThrow(
        SettlementMessageMismatchError,
      );
      expect(submit).not.toHaveBeenCalled();
    });

    it('adds the fee payer signature, records it, and transitions the attempt and intent to settling', async () => {
      const { wire, messageBase64 } = buildWireAndMessage();
      const { intents, transition } = makeIntents({
        id: 'pi_1',
        status: 'authorized',
        consumerId: 'u_1',
        merchantId: 'm_1',
        usdcSettlementRaw: '1000000',
      });
      const { provisioning } = makeProvisioning(ENDPOINT);
      const { spends, submit } = makeSpends('sig-happy');
      const service = makeService({
        db: makeDb({
          attempt: {
            id: 'att_1',
            status: 'authorized',
            messageBase64,
            txSignature: null,
          },
          updateReturning: [[{ id: 'att_1' }]],
        }),
        solana: makeSolana(),
        intents,
        provisioning,
        spends,
      });

      const out = await service.submitSettlement('pi_1', wire);

      expect(out).toEqual({
        attemptId: 'att_1',
        signature: 'sig-happy',
        status: 'settling',
      });
      // The authority signs the Consumer's bytes, unchanged.
      expect(submit).toHaveBeenCalledTimes(1);
      expect(submit.mock.calls[0][0]).toBe(wire);
      expect(transition).toHaveBeenCalledWith(
        'pi_1',
        'authorized',
        'settling',
        {},
      );
    });

    it.each([60000, -1])(
      'an already-broadcast retry reconciles without signing again with quote lifetime %s ms',
      async (remainingMs) => {
        const { wire, messageBase64 } = buildWireAndMessage();
        const { intents } = makeIntents({
          id: 'pi_1',
          status: 'settling',
          expiresAt: new Date(Date.now() + remainingMs),
          consumerId: 'u_1',
          merchantId: 'm_1',
          usdcSettlementRaw: '1000000',
        });
        const { provisioning } = makeProvisioning(ENDPOINT);
        const { spends, submit } = makeSpends();
        const service = makeService({
          db: makeDb({
            attempt: {
              id: 'att_1',
              status: 'settling',
              messageBase64,
              txSignature: 'sig-live',
            },
          }),
          solana: makeSolana(),
          intents,
          provisioning,
          spends,
        });

        const out = await service.submitSettlement('pi_1', wire);

        expect(out.status).toBe('settling');
        expect(out.signature).toBe('sig-live');
        expect(submit).not.toHaveBeenCalled();
      },
    );
  });

  describe('resolveInFlight', () => {
    it('returns still_settling for a not-yet-confirmed null status and never rebuilds', async () => {
      const { intents } = makeIntents({ id: 'pi_1', status: 'settling' });
      const { provisioning } = makeProvisioning(ENDPOINT);
      const { spends } = makeSpends();
      const service = makeService({
        db: makeDb({
          attempt: {
            id: 'att_1',
            status: 'settling',
            messageBase64: 'pinned',
            txSignature: 'sig-live',
          },
        }),
        solana: makeSolana({
          getSignatureStatuses: jest.fn().mockResolvedValue([
            {
              signature: 'sig-live',
              slot: null,
              confirmationStatus: null,
              err: null,
            },
          ]),
        }),
        intents,
        provisioning,
        spends,
      });

      await expect(service.resolveInFlight('pi_1')).resolves.toBe(
        'still_settling',
      );
    });

    it('returns failed for a confirmed status that carries a transaction error', async () => {
      const { intents } = makeIntents({ id: 'pi_1', status: 'settling' });
      const { provisioning } = makeProvisioning(ENDPOINT);
      const { spends } = makeSpends();
      const service = makeService({
        db: makeDb({
          attempt: {
            id: 'att_1',
            status: 'settling',
            messageBase64: 'pinned',
            txSignature: 'sig-live',
          },
        }),
        solana: makeSolana({
          getSignatureStatuses: jest.fn().mockResolvedValue([
            {
              signature: 'sig-live',
              slot: 9n,
              confirmationStatus: 'confirmed',
              err: { InstructionError: [1, 'Custom'] },
            },
          ]),
        }),
        intents,
        provisioning,
        spends,
      });

      await expect(service.resolveInFlight('pi_1')).resolves.toBe('failed');
    });
  });
});
