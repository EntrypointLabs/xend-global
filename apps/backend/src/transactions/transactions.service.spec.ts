import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsService } from './transactions.service';
import { GridService } from '../grid/grid.service';
import { DbService } from '../db/db.service';

describe('TransactionsService', () => {
  let service: TransactionsService;
  let mockGrid: {
    client: {
      createPaymentIntent: jest.Mock;
      signAndSend: jest.Mock;
      prepareArbitraryTransaction: jest.Mock;
    };
    getTransfers: jest.Mock;
  };
  let insertedValues: Record<string, unknown> | undefined;
  let mockDb: {
    client: { select: jest.Mock; insert: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    mockGrid = {
      client: {
        createPaymentIntent: jest.fn(),
        signAndSend: jest.fn(),
        prepareArbitraryTransaction: jest.fn(),
      },
      getTransfers: jest.fn(),
    };

    // Minimal Drizzle-chainable fakes — these mimic only the methods send/getHistory hit.
    // The `select` chain (`.select().from(...).where(...).limit(1)`) resolves to a single
    // smartAccount row; the `insert` chain captures the values payload so the test can
    // assert `status: 'PENDING'` etc.
    insertedValues = undefined;
    const smartAccountRow = { id: 'sa1', userId: 'u1', gridAccountId: 'GRID_ADDR' };
    const selectChain = {
      from: () => ({
        where: () => ({ limit: async () => [smartAccountRow] }),
      }),
    };
    const insertChain = {
      values: (vals: Record<string, unknown>) => {
        insertedValues = vals;
        return { returning: async () => [{ id: 'tx1', ...vals }] };
      },
    };
    const updateChain = {
      set: () => ({ where: async () => undefined }),
    };
    mockDb = {
      client: {
        select: jest.fn(() => selectChain),
        insert: jest.fn(() => insertChain),
        update: jest.fn(() => updateChain),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: GridService, useValue: mockGrid },
        { provide: DbService, useValue: mockDb },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('send', () => {
    it('calls Grid createPaymentIntent with structured amount/source/destination (base units)', async () => {
      mockGrid.client.createPaymentIntent.mockResolvedValue({
        data: { transactionPayload: { transaction: 'b64', transactionSigners: [], kmsPayloads: [] } },
      });
      mockGrid.client.signAndSend.mockResolvedValue({
        data: { transactionSignature: 'sig', confirmedAt: '2026-05-22T00:00:00Z' },
      });

      await service.send('u1', {
        toAddress: 'DEST_ADDR',
        amount: '0.10',
        token: 'USDC',
        sessionSecrets: [] as never,
        session: [] as never,
      });

      expect(mockGrid.client.createPaymentIntent).toHaveBeenCalledWith(
        'GRID_ADDR',
        expect.objectContaining({
          amount: '100000',
          source: expect.objectContaining({ address: 'GRID_ADDR', currency: 'usdc' }),
          destination: expect.objectContaining({ address: 'DEST_ADDR', currency: 'usdc' }),
        }),
      );
      expect(mockGrid.client.prepareArbitraryTransaction).not.toHaveBeenCalled();
    });

    it('inserts the transaction with status PENDING (reconciliation happens on getHistory)', async () => {
      mockGrid.client.createPaymentIntent.mockResolvedValue({
        data: { transactionPayload: { transaction: 'b64', transactionSigners: [], kmsPayloads: [] } },
      });
      mockGrid.client.signAndSend.mockResolvedValue({
        data: { transactionSignature: 'sig', confirmedAt: '2026-05-22T00:00:00Z' },
      });

      await service.send('u1', {
        toAddress: 'DEST_ADDR',
        amount: '0.10',
        token: 'USDC',
        sessionSecrets: [] as never,
        session: [] as never,
      });

      expect(insertedValues).toMatchObject({
        smartAccountId: 'sa1',
        signature: 'sig',
        type: 'SEND',
        amount: '0.10',
        token: 'USDC',
        fromAddress: 'GRID_ADDR',
        toAddress: 'DEST_ADDR',
        status: 'PENDING',
      });
      // confirmedAt must NOT be set at insert time — reconciliation owns it.
      expect(insertedValues).not.toHaveProperty('confirmedAt');
    });

    it('throws InternalServerErrorException when Grid returns no transactionPayload', async () => {
      mockGrid.client.createPaymentIntent.mockResolvedValue({
        data: { error: 'insufficient funds' },
      });

      await expect(
        service.send('u1', {
          toAddress: 'DEST_ADDR',
          amount: '0.10',
          token: 'USDC',
          sessionSecrets: [] as never,
          session: [] as never,
        }),
      ).rejects.toThrow(/insufficient funds|no transactionPayload/i);

      expect(mockGrid.client.signAndSend).not.toHaveBeenCalled();
    });
  });
});
