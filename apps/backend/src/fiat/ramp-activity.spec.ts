import { matchRampOrders, type RampTransferRef } from './ramp-activity';
import type { FiatOrder } from './fiat.types';

const OPENED = '2026-11-21T20:55:00.000Z';

function deposit(overrides: Partial<FiatOrder> = {}): FiatOrder {
  return {
    id: 'ord_dep',
    route: { id: 'paj:ngn-usdc', provider: 'paj', direction: 'receive' },
    quote: {
      debit: { currency: 'NGN', amountMinor: '1000000', decimals: 2 },
      credit: { currency: 'USDC', amountMinor: '6904024', decimals: 6 },
      fees: [],
    },
    status: 'completed',
    instructions: { kind: 'bank_transfer', message: '' },
    createdAt: OPENED,
    updatedAt: OPENED,
    simulation: false,
    ...overrides,
  } as unknown as FiatOrder;
}

function bankSend(overrides: Partial<FiatOrder> = {}): FiatOrder {
  return {
    id: 'ord_send',
    route: { id: 'paycrest:usdc-ngn', provider: 'paycrest', direction: 'send' },
    quote: {
      debit: { currency: 'USDC', amountMinor: '3489354', decimals: 6 },
      credit: { currency: 'NGN', amountMinor: '500000', decimals: 2 },
      fees: [],
    },
    status: 'completed',
    instructions: {
      kind: 'crypto_transfer',
      message: '',
      depositAddress: 'DepositAddr1111',
      depositAmount: { currency: 'USDC', amountMinor: '3512817', decimals: 6 },
      payoutAccountName: 'Ada Okafor',
      payoutBankCode: 'KUDANGPC',
      payoutBankName: 'Kuda Microfinance Bank',
      payoutAccountNumber: '0123456789',
    },
    createdAt: OPENED,
    updatedAt: OPENED,
    simulation: false,
    ...overrides,
  } as unknown as FiatOrder;
}

function transfer(overrides: Partial<RampTransferRef>): RampTransferRef {
  return {
    id: 't1',
    direction: 'RECEIVE',
    toAddress: 'vault',
    signature: 'sig',
    amountRaw: '6904024',
    decimals: 6,
    createdAt: new Date('2026-11-21T20:57:30.000Z'),
    ...overrides,
  };
}

describe('matchRampOrders', () => {
  it('names a bank send by its deposit address, with the bank and person', () => {
    const t = transfer({
      direction: 'SEND',
      toAddress: 'DepositAddr1111',
      amountRaw: '3512817',
    });
    const match = matchRampOrders([t], [bankSend()]).get('t1');
    expect(match).toMatchObject({
      direction: 'send',
      fiatAmountMinor: '500000',
      counterpartyName: 'Ada Okafor',
      bankName: 'Kuda Microfinance Bank',
      logoKey: 'kuda',
      accountLast4: '6789',
      feeMinor: '23463',
    });
    expect(match?.rate).toBe('1432.92');
  });

  it('names a deposit by the signature its partner reported', () => {
    const match = matchRampOrders(
      [transfer({ signature: 'pajSig', amountRaw: '1' })],
      [deposit({ settlementSignature: 'pajSig' })],
    ).get('t1');
    expect(match?.fiatAmountMinor).toBe('1000000');
    expect(match?.rate).toBe('1448.43');
    expect(match?.counterpartyName).toBeNull();
  });

  it('names a deposit that arrives before its signature is reported', () => {
    const match = matchRampOrders(
      [transfer({ signature: 'unseen' })],
      [deposit({ status: 'processing' })],
    );
    expect(match.get('t1')?.orderId).toBe('ord_dep');
  });

  it('leaves an ordinary arrival of a different size alone', () => {
    const match = matchRampOrders(
      [transfer({ amountRaw: '5000000' })],
      [deposit({ status: 'processing' })],
    );
    expect(match.size).toBe(0);
  });

  it('does not take an arrival long after the order opened for the naira', () => {
    const match = matchRampOrders(
      [transfer({ createdAt: new Date('2026-11-22T02:00:00.000Z') })],
      [deposit({ status: 'processing' })],
    );
    expect(match.size).toBe(0);
  });

  it('ignores expired orders and simulations', () => {
    expect(
      matchRampOrders([transfer({})], [deposit({ status: 'expired' })]).size,
    ).toBe(0);
    expect(
      matchRampOrders([transfer({})], [deposit({ simulation: true })]).size,
    ).toBe(0);
  });

  it('gives one deposit to one arrival only', () => {
    const match = matchRampOrders(
      [
        transfer({ id: 'a' }),
        transfer({
          id: 'b',
          createdAt: new Date('2026-11-21T20:58:30.000Z'),
        }),
      ],
      [deposit({ status: 'processing' })],
    );
    expect([...match.keys()]).toEqual(['a']);
  });
});
