import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Keypair } from '@solana/web3.js';
import {
  address,
  appendTransactionMessageInstructions,
  type Blockhash,
  compileTransaction,
  createTransactionMessage,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { getSetComputeUnitLimitInstruction } from '@solana-program/compute-budget';
import type { DbService } from '../db/db.service';
import { paymentAttempts, smartAccounts } from '../db/schema';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import type { PaymentIntentService } from '../payment/payment-intent.service';
import type { SettlementProvisioningService } from './settlement-provisioning.service';
import type { CosignRequest, RelayerClient } from './relayer.client';
import type { SettlementConfirmationService } from './settlement-confirmation.service';
import { SettlementService } from './settlement.service';
import {
  IntentNotSettleableError,
  SettlementAccountNotProvisionedError,
  SettlementMessageMismatchError,
} from './settlement.errors';

const USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const FEE_PAYER = Keypair.generate().publicKey.toBase58();
const WALLET = Keypair.generate().publicKey.toBase58();
const ENDPOINT = Keypair.generate().publicKey.toBase58();
const BLOCKHASH = Keypair.generate().publicKey.toBase58();

function buildWireAndMessage(): { wire: string; messageBase64: string } {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(FEE_PAYER), m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: BLOCKHASH as Blockhash, lastValidBlockHeight: 1_000n },
        m,
      ),
    (m) =>
      appendTransactionMessageInstructions(
        [getSetComputeUnitLimitInstruction({ units: 60_000 })],
        m,
      ),
  );
  const compiled = compileTransaction(message);
  return {
    wire: getBase64EncodedWireTransaction(compiled),
    messageBase64: getBase64Decoder().decode(compiled.messageBytes),
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
      if (key === 'RELAYER_FEE_PAYER_ADDRESS') return FEE_PAYER;
      throw new Error(`missing config ${key}`);
    },
  } as unknown as ConfigService;
}

function makeDb(cfg: {
  attempt?: AttemptRow;
  wallet?: string;
  updateReturning?: { id: string }[][];
}): DbService {
  const updates = [...(cfg.updateReturning ?? [])];
  const client = {
    select: () => ({
      from: (tbl: unknown) => ({
        where: () => ({
          limit: () => {
            if (tbl === paymentAttempts)
              return Promise.resolve(cfg.attempt ? [cfg.attempt] : []);
            if (tbl === smartAccounts)
              return Promise.resolve(
                cfg.wallet ? [{ walletAddress: cfg.wallet }] : [],
              );
            return Promise.resolve([]);
          },
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(updates.shift() ?? []),
        }),
      }),
    }),
  };
  return { client } as unknown as DbService;
}

function makeIntents(intent: Record<string, unknown>) {
  const findById = jest.fn().mockResolvedValue(intent);
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
    : jest.fn().mockResolvedValue({ address, provider: 'direct_usdc' });
  return {
    provisioning: {
      getSettlementAddressForSettlement,
    } as unknown as SettlementProvisioningService,
    getSettlementAddressForSettlement,
  };
}

function makeRelayer(signature = 'sig-1') {
  const getPriorityFee = jest
    .fn()
    .mockResolvedValue({ computeUnitPrice: 1_000n });
  const cosign = jest.fn<
    Promise<{ signature: string }>,
    [CosignRequest, string]
  >(() => Promise.resolve({ signature }));
  return {
    relayer: { getPriorityFee, cosign } as unknown as RelayerClient,
    getPriorityFee,
    cosign,
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
  relayer: RelayerClient;
  confirmation?: SettlementConfirmationService;
}): SettlementService {
  const service = new SettlementService(
    deps.db,
    makeConfig(),
    deps.solana,
    deps.intents,
    deps.provisioning,
    deps.relayer,
    deps.confirmation ?? makeConfirmation(),
  );
  service.onModuleInit();
  return service;
}

describe('SettlementService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  describe('buildSettlement', () => {
    it('pins the message on the authorized attempt, reads the destination from provisioning, and does not transition to settling', async () => {
      const { intents, transition } = makeIntents({
        id: 'pi_1',
        status: 'authorized',
        consumerId: 'u_1',
        merchantId: 'm_1',
        usdcSettlementRaw: '1000000',
      });
      const { provisioning, getSettlementAddressForSettlement } =
        makeProvisioning(ENDPOINT);
      const { relayer } = makeRelayer();
      const service = makeService({
        db: makeDb({
          attempt: {
            id: 'att_1',
            status: 'authorized',
            messageBase64: null,
            txSignature: null,
          },
          wallet: WALLET,
          updateReturning: [[{ id: 'att_1' }]],
        }),
        solana: makeSolana(),
        intents,
        provisioning,
        relayer,
      });

      const out = await service.buildSettlement('pi_1');

      expect(out.attemptId).toBe('att_1');
      expect(out.expectedSettlementAccount).toBe(ENDPOINT);
      expect(out.unsignedTxBase64).toBeTruthy();
      expect(out.messageBase64).toBeTruthy();
      expect(getSettlementAddressForSettlement).toHaveBeenCalledWith('m_1');
      // No transition to settling at build time.
      expect(transition).not.toHaveBeenCalled();
    });

    it('rejects a non-authorized intent with INTENT_NOT_SETTLEABLE', async () => {
      const { intents } = makeIntents({
        id: 'pi_1',
        status: 'settling',
        consumerId: 'u_1',
        merchantId: 'm_1',
        usdcSettlementRaw: '1000000',
      });
      const { provisioning } = makeProvisioning(ENDPOINT);
      const { relayer } = makeRelayer();
      const service = makeService({
        db: makeDb({}),
        solana: makeSolana(),
        intents,
        provisioning,
        relayer,
      });

      await expect(service.buildSettlement('pi_1')).rejects.toThrow(
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
      const { relayer } = makeRelayer();
      const service = makeService({
        db: makeDb({
          attempt: {
            id: 'att_1',
            status: 'authorized',
            messageBase64: null,
            txSignature: null,
          },
          wallet: WALLET,
        }),
        solana: makeSolana(),
        intents,
        provisioning,
        relayer,
      });

      await expect(service.buildSettlement('pi_1')).rejects.toThrow(
        SettlementAccountNotProvisionedError,
      );
    });
  });

  describe('submitSettlement', () => {
    it('rejects a signed tx whose message diverges from the pinned message and never calls the relayer', async () => {
      const { wire } = buildWireAndMessage();
      const { intents } = makeIntents({
        id: 'pi_1',
        status: 'authorized',
        consumerId: 'u_1',
        merchantId: 'm_1',
        usdcSettlementRaw: '1000000',
      });
      const { provisioning } = makeProvisioning(ENDPOINT);
      const { relayer, cosign } = makeRelayer();
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
        relayer,
      });

      await expect(service.submitSettlement('pi_1', wire)).rejects.toThrow(
        SettlementMessageMismatchError,
      );
      expect(cosign).not.toHaveBeenCalled();
    });

    it('co-signs, records the signature, and transitions the attempt and intent to settling', async () => {
      const { wire, messageBase64 } = buildWireAndMessage();
      const { intents, transition } = makeIntents({
        id: 'pi_1',
        status: 'authorized',
        consumerId: 'u_1',
        merchantId: 'm_1',
        usdcSettlementRaw: '1000000',
      });
      const { provisioning } = makeProvisioning(ENDPOINT);
      const { relayer, cosign } = makeRelayer('sig-happy');
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
        relayer,
      });

      const out = await service.submitSettlement('pi_1', wire);

      expect(out).toEqual({
        attemptId: 'att_1',
        signature: 'sig-happy',
        status: 'settling',
      });
      expect(cosign).toHaveBeenCalledTimes(1);
      const cosignArg = cosign.mock.calls[0][0];
      expect(cosignArg.expectedSettlementAccount).toBe(ENDPOINT);
      expect(cosignArg.expectedMessageBase64).toBe(messageBase64);
      expect(transition).toHaveBeenCalledWith(
        'pi_1',
        'authorized',
        'settling',
        {},
      );
    });

    it('a second submit for an already-settling attempt resolves in-flight without a second cosign', async () => {
      const { wire } = buildWireAndMessage();
      const { intents } = makeIntents({
        id: 'pi_1',
        status: 'settling',
        consumerId: 'u_1',
        merchantId: 'm_1',
        usdcSettlementRaw: '1000000',
      });
      const { provisioning } = makeProvisioning(ENDPOINT);
      const { relayer, cosign } = makeRelayer();
      const service = makeService({
        db: makeDb({
          attempt: {
            id: 'att_1',
            status: 'settling',
            messageBase64: 'pinned',
            txSignature: 'sig-live',
          },
        }),
        solana: makeSolana(),
        intents,
        provisioning,
        relayer,
      });

      const out = await service.submitSettlement('pi_1', wire);

      expect(out.status).toBe('settling');
      expect(out.signature).toBe('sig-live');
      expect(cosign).not.toHaveBeenCalled();
    });
  });

  describe('resolveInFlight', () => {
    it('returns still_settling for a not-yet-confirmed null status and never rebuilds', async () => {
      const { intents } = makeIntents({ id: 'pi_1', status: 'settling' });
      const { provisioning } = makeProvisioning(ENDPOINT);
      const { relayer } = makeRelayer();
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
        relayer,
      });

      await expect(service.resolveInFlight('pi_1')).resolves.toBe(
        'still_settling',
      );
    });
  });
});
