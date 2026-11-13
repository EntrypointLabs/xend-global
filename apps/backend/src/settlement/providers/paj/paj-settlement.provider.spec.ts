import type { ConfigService } from '@nestjs/config';
import type { DbService } from '../../../db/db.service';
import type { EventPublisher } from '../../../events/event-publisher.interface';
import type { DirectUsdcProvider } from '../direct-usdc.provider';
import { PajRequestError, type PajClient } from './paj.client';
import {
  BankAccountUnconfirmedError,
  PajSettlementProvider,
} from './paj-settlement.provider';

const PAJ_WALLET = 'PajWa11etAddressForTheBankAccount11111111111';
const TOKEN_ACCOUNT = 'UsdcTokenAccountOfThePajWa11et1111111111111';

function makeConfig(enabled: boolean): ConfigService {
  const values: Record<string, unknown> = {
    PAJ_ENABLED: enabled,
    SOLANA_CLUSTER: 'devnet',
  };
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService;
}

/** Each select resolves to the next queued result set, in call order. */
function makeDb(opts: { selects: unknown[][]; insertError?: Error }): {
  db: DbService;
  inserted: unknown[];
} {
  const inserted: unknown[] = [];
  const queue = [...opts.selects];
  const client = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(queue.shift() ?? []) }),
      }),
    }),
    insert: () => ({
      values: (row: unknown) => ({
        returning: () => {
          if (opts.insertError) return Promise.reject(opts.insertError);
          inserted.push(row);
          return Promise.resolve([{ id: 'so_1' }]);
        },
      }),
    }),
  };
  return { db: { client } as unknown as DbService, inserted };
}

function makeProvider(
  opts: {
    enabled?: boolean;
    db?: DbService;
    paj?: Partial<PajClient>;
    directUsdc?: Partial<DirectUsdcProvider>;
  } = {},
) {
  const publish = jest.fn().mockResolvedValue(undefined);
  const provider = new PajSettlementProvider(
    opts.db ?? makeDb({ selects: [] }).db,
    makeConfig(opts.enabled ?? true),
    (opts.paj ?? {}) as PajClient,
    (opts.directUsdc ?? {}) as DirectUsdcProvider,
    { publish } as unknown as EventPublisher,
  );
  return { provider, publish };
}

describe('PajSettlementProvider', () => {
  it('serves NGN only while enabled', () => {
    expect(
      makeProvider({ enabled: true }).provider.capabilities.currencies,
    ).toEqual(['NGN']);
    expect(
      makeProvider({ enabled: false }).provider.capabilities.currencies,
    ).toEqual([]);
  });

  it('never advertises refunds', () => {
    expect(makeProvider().provider.capabilities.refundSupport).toBe(false);
  });

  describe('provision', () => {
    it('settles into the USDC account of the address PAJ assigns', async () => {
      const registerBankAccount = jest.fn().mockResolvedValue({
        id: 'ba_1',
        accountName: 'ADA STORES LTD',
        accountNumber: '0123456789',
        bank: 'GTBank',
        address: PAJ_WALLET,
      });
      const provision = jest.fn().mockResolvedValue({
        address: TOKEN_ACCOUNT,
        providerReference: PAJ_WALLET,
        attributionRef: null,
        payoutConfig: null,
      });
      const { provider } = makeProvider({
        paj: { registerBankAccount },
        directUsdc: { provision },
      });

      const endpoint = await provider.provision({
        merchantId: 'm_1',
        bankAccount: { bankCode: '058', accountNumber: '0123456789' },
      });

      expect(provision).toHaveBeenCalledWith({
        merchantId: 'm_1',
        merchantAddress: PAJ_WALLET,
      });
      expect(endpoint.address).toBe(TOKEN_ACCOUNT);
      // The recorded owner is what a Spend names as its destination.
      expect(endpoint.providerReference).toBe(PAJ_WALLET);
      expect(JSON.parse(endpoint.payoutConfig ?? '{}')).toEqual({
        pajBankAccountId: 'ba_1',
        bankCode: '058',
        bankName: 'GTBank',
        accountName: 'ADA STORES LTD',
        accountLast4: '6789',
        verified: true,
      });
    });

    it('refuses to provision without a bank account', async () => {
      const registerBankAccount = jest.fn();
      const { provider } = makeProvider({ paj: { registerBankAccount } });

      await expect(provider.provision({ merchantId: 'm_1' })).rejects.toThrow(
        'A bank account is required',
      );
      expect(registerBankAccount).not.toHaveBeenCalled();
    });
  });

  describe('handleIncomingSettlement', () => {
    const params = {
      endpointAddress: TOKEN_ACCOUNT,
      signature: 'sig_1',
      amountRaw: '25000000',
    };
    const account = [{ merchantId: 'm_1', providerReference: PAJ_WALLET }];

    it('records a pending payout keyed by the transfer signature', async () => {
      const { db, inserted } = makeDb({
        selects: [
          account,
          [{ kybStatus: 'verified' }],
          [{ intentId: 'pi_1' }],
          [{ id: 'pay_1' }],
        ],
      });
      const { provider, publish } = makeProvider({ db });

      await expect(provider.handleIncomingSettlement(params)).resolves.toEqual({
        status: 'pending',
      });
      expect(inserted).toEqual([
        expect.objectContaining({
          provider: 'paj',
          merchantId: 'm_1',
          paymentId: 'pay_1',
          signature: 'sig_1',
          providerRef: 'sig_1',
          usdcAmountRaw: '25000000',
        }),
      ]);
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'payout.initiated' }),
      );
    });

    it('is a no-op when the signature was already recorded', async () => {
      const { db } = makeDb({
        selects: [account, [{ kybStatus: 'verified' }], []],
        insertError: Object.assign(new Error('duplicate key'), {
          code: '23505',
        }),
      });
      const { provider, publish } = makeProvider({ db });

      await expect(provider.handleIncomingSettlement(params)).resolves.toEqual({
        status: 'pending',
      });
      expect(publish).not.toHaveBeenCalled();
    });

    it('rejects a Merchant that is not verified before recording anything', async () => {
      const { db, inserted } = makeDb({
        selects: [account, [{ kybStatus: 'pending' }]],
      });
      const { provider } = makeProvider({ db });

      await expect(provider.handleIncomingSettlement(params)).rejects.toThrow(
        'not KYB-verified',
      );
      expect(inserted).toEqual([]);
    });
  });

  describe('confirmBankAccount', () => {
    it('returns the holder name without the full account number', async () => {
      const { provider } = makeProvider({
        paj: {
          registerBankAccount: jest.fn().mockResolvedValue({
            id: 'ba_1',
            accountName: 'ADA STORES LTD',
            accountNumber: '0123456789',
            bank: 'GTBank',
            address: PAJ_WALLET,
          }),
        },
      });

      await expect(
        provider.confirmBankAccount({
          bankCode: '058',
          accountNumber: '0123456789',
        }),
      ).resolves.toEqual({
        accountName: 'ADA STORES LTD',
        bankName: 'GTBank',
        accountLast4: '6789',
      });
    });

    it('reports an account the bank rejected as unconfirmed', async () => {
      const { provider } = makeProvider({
        paj: {
          registerBankAccount: jest
            .fn()
            .mockRejectedValue(new PajRequestError(400, 'not found')),
        },
      });

      await expect(
        provider.confirmBankAccount({
          bankCode: '058',
          accountNumber: '0000000000',
        }),
      ).rejects.toBeInstanceOf(BankAccountUnconfirmedError);
    });
  });

  it('fetches the bank list once and serves it sorted', async () => {
    const getBanks = jest.fn().mockResolvedValue([
      { code: '058', name: 'GTBank' },
      { code: '090133', name: ' AL-Barakah Microfinance Bank' },
    ]);
    const { provider } = makeProvider({ paj: { getBanks } });

    const first = await provider.listBanks();
    await provider.listBanks();

    expect(first.map((bank) => bank.name)).toEqual([
      'AL-Barakah Microfinance Bank',
      'GTBank',
    ]);
    expect(getBanks).toHaveBeenCalledTimes(1);
  });

  it('rejects a reversal', async () => {
    await expect(makeProvider().provider.reverse()).rejects.toThrow(
      'cannot be reversed',
    );
  });

  describe('parseWebhookEvent', () => {
    const delivery = {
      id: 'tx_9',
      status: 'COMPLETED',
      transactionType: 'OFF_RAMP',
      signature: 'sig_1',
      fiatAmount: 34402.5,
      rate: 1376.08,
    };
    const { provider } = makeProvider();

    it('reads a completed payout in kobo', () => {
      expect(provider.parseWebhookEvent(delivery)).toEqual({
        type: 'paid',
        eventId: 'tx_9:COMPLETED',
        depositSignature: 'sig_1',
        providerTxRef: 'tx_9',
        ngnSettledMinor: '3440250',
        fxRate: '1376.08',
      });
    });

    it.each([
      ['PROCESSING', 'processing'],
      ['ERROR', 'failed'],
    ])('maps %s to %s', (status, type) => {
      expect(provider.parseWebhookEvent({ ...delivery, status })?.type).toBe(
        type,
      );
    });

    it.each([
      ['an on-ramp update', { ...delivery, transactionType: 'ON_RAMP' }],
      ['an order still waiting for funds', { ...delivery, status: 'INIT' }],
      ['a delivery with no signature', { ...delivery, signature: undefined }],
      ['a KYC event', { event: 'kyc.status_changed', customerId: 'cus_1' }],
    ])('ignores %s', (_label, payload) => {
      expect(provider.parseWebhookEvent(payload)).toBeNull();
    });
  });
});
