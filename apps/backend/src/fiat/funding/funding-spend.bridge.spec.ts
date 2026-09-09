import { ConfigService } from '@nestjs/config';
import type { Principal } from '../../auth/principal';
import { FundingSpendBridge } from './funding-spend.bridge';
import { planFunding } from './funding-planner';
import { createFundingState, reduceFundingState } from './funding-state';
import type { ReservedFundingIntent } from './funding-store';

describe('FundingSpendBridge', () => {
  const principal: Principal = {
    userId: 'consumer',
    walletAddress: 'primary',
    tier: 'full',
  };
  function setup() {
    const plan = planFunding(
      {
        NGN: { settledMinor: '0', reservedMinor: '0' },
        USDC: { settledMinor: '100000000', reservedMinor: '0' },
      },
      'USDC',
      '20000000',
      '0',
      null,
      Date.now(),
    );
    const intent: ReservedFundingIntent = {
      id: 'funding-id',
      ownerId: 'consumer',
      idempotencyKey: 'request-id',
      plan,
      executionBinding: {
        payoutDestination: 'recipient',
        payoutProvider: 'solana-vault',
        solana: {
          network: 'devnet',
          mint: 'configured-devnet-usdc',
          vaultAddress: 'vault',
        },
      },
      payoutActionReference: 'funding-id_payout',
      conversionActionReference: null,
      holdingsReconciliationReference: 'chain-finalized',
      holdingsReconciledAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      state: reduceFundingState(
        createFundingState({
          id: 'funding-id',
          destinationCurrency: 'USDC',
          nativeReservedMinor: '20000000',
          payoutMinor: '20000000',
          payoutActionReference: 'funding-id_payout',
        }),
        {
          id: 'ready',
          actionReference: 'funding-id_payout',
          type: 'native_funding_ready',
        },
      ),
    };
    const get = jest.fn().mockResolvedValue(intent);
    const findByUserId = jest
      .fn()
      .mockResolvedValue({ userId: 'consumer', vaultAddress: 'vault' });
    const prepare = jest.fn().mockResolvedValue({
      intentId: 'transfer-id',
      unsignedTxBase64: 'unsigned',
      feeLamports: 0,
      expiresAt: new Date().toISOString(),
      needsApprovalSignature: true,
    });
    const bridge = new FundingSpendBridge(
      { get },
      { findByUserId },
      { prepare },
      new ConfigService<Record<string | symbol, unknown>>({
        SOLANA_CLUSTER: 'devnet',
        EXPO_PUBLIC_USDC_MINT_ADDRESS: 'configured-devnet-usdc',
      }),
    );
    return { bridge, intent, get, prepare, findByUserId };
  }

  it('prepares the persisted exact destination through existing transfer authorization flow', async () => {
    const { bridge, prepare, intent } = setup();
    const result = await bridge.prepare(principal, intent.id);
    expect(prepare).toHaveBeenCalledWith('consumer', {
      toAddress: 'recipient',
      mint: 'configured-devnet-usdc',
      amountRaw: '20000000',
    });
    expect(result.transfer.needsApprovalSignature).toBe(true);
    expect(result.payoutActionReference).toBe(intent.payoutActionReference);
    expect(intent.state.status).toBe('ready_to_send');
  });

  it.each([
    { ...principal, tier: 'entry' as const },
    { ...principal, userId: 'local-unified-simulation' },
  ])(
    'refuses unauthorised or simulator principal before reading funds',
    async (caller) => {
      const { bridge, get, prepare } = setup();
      await expect(bridge.prepare(caller, 'funding-id')).rejects.toThrow(
        'AUTHENTICATED_CONSUMER_REQUIRED',
      );
      expect(get).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
    },
  );

  it.each(['converting', 'sending', 'completed', 'failed'] as const)(
    'refuses %s funding',
    async (status) => {
      const { bridge, intent, prepare } = setup();
      intent.state.status = status;
      await expect(bridge.prepare(principal, intent.id)).rejects.toThrow(
        'NOT_READY',
      );
      expect(prepare).not.toHaveBeenCalled();
    },
  );

  it.each([
    'owner',
    'network',
    'mint',
    'vault',
    'self',
    'fee',
    'state-amount',
    'missing-binding',
  ])('fails closed for %s mismatch', async (mutation) => {
    const { bridge, intent, prepare } = setup();
    if (mutation === 'owner') intent.ownerId = 'other';
    if (mutation === 'network')
      intent.executionBinding.solana!.network = 'mainnet';
    if (mutation === 'mint')
      intent.executionBinding.solana!.mint = 'other-mint';
    if (mutation === 'vault')
      intent.executionBinding.solana!.vaultAddress = 'other-vault';
    if (mutation === 'self')
      intent.executionBinding.payoutDestination = 'vault';
    if (mutation === 'fee') intent.plan.payoutFeeMinor = '1';
    if (mutation === 'state-amount') intent.state.payoutMinor = '1';
    if (mutation === 'missing-binding') delete intent.executionBinding.solana;
    await expect(bridge.prepare(principal, intent.id)).rejects.toThrow();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('does not promote an unreconciled conversion based only on ready status', async () => {
    const { bridge, intent, prepare } = setup();
    intent.plan.conversion = {
      reference: 'conversion',
      sourceCurrency: 'NGN',
      destinationCurrency: 'USDC',
      sourceDebitMinor: '100000',
      destinationCreditMinor: '20000000',
      expiresAt: new Date().toISOString(),
    };
    await expect(bridge.prepare(principal, intent.id)).rejects.toThrow(
      'CONVERSION_NOT_RECONCILED',
    );
    expect(prepare).not.toHaveBeenCalled();
  });

  it('prepares only after both conversion legs reconcile, including quote surplus', async () => {
    const { bridge, intent, prepare } = setup();
    intent.plan = planFunding(
      {
        NGN: { settledMinor: '100000', reservedMinor: '0' },
        USDC: { settledMinor: '10000000', reservedMinor: '0' },
      },
      'USDC',
      '20000000',
      '0',
      {
        reference: 'quote',
        sourceCurrency: 'NGN',
        destinationCurrency: 'USDC',
        sourceDebitMinor: '100000',
        destinationCreditMinor: '11000000',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
      Date.now(),
    );
    intent.conversionActionReference = 'funding-id_conversion';
    let state = createFundingState({
      id: intent.id,
      destinationCurrency: 'USDC',
      nativeReservedMinor: '10000000',
      payoutMinor: '20000000',
      payoutActionReference: intent.payoutActionReference,
      conversion: {
        actionReference: intent.conversionActionReference,
        sourceCurrency: 'NGN',
        sourceMinor: '100000',
        destinationMinor: '11000000',
      },
    });
    state = reduceFundingState(state, {
      id: 'start',
      actionReference: intent.conversionActionReference,
      type: 'conversion_started',
    });
    state = reduceFundingState(state, {
      id: 'debit',
      actionReference: intent.conversionActionReference,
      type: 'conversion_source_debited',
      evidence: {
        kind: 'bank_reconciliation',
        reference: 'bank-debit',
        currency: 'NGN',
        amountMinor: '100000',
      },
    });
    intent.state = state;
    await expect(bridge.prepare(principal, intent.id)).rejects.toThrow(
      'NOT_READY',
    );
    state = reduceFundingState(state, {
      id: 'credit',
      actionReference: intent.conversionActionReference,
      type: 'conversion_destination_confirmed',
      evidence: {
        kind: 'onchain_finality',
        reference: 'finalized-signature',
        currency: 'USDC',
        amountMinor: '11000000',
      },
    });
    intent.state = state;
    await bridge.prepare(principal, intent.id);
    expect(prepare).toHaveBeenCalledWith('consumer', {
      toAddress: 'recipient',
      mint: 'configured-devnet-usdc',
      amountRaw: '20000000',
    });
  });
});
