import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Keypair } from '@solana/web3.js';
import type { SolanaRpc } from '../../solana/solana-rpc.interface';
import type { SettlementAuthoritySigner } from '../settlement-authority.interface';
import { DirectUsdcProvider } from './direct-usdc.provider';
import { RefundNotSupportedError } from '../settlement.errors';

const USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const AUTHORITY = Keypair.generate().publicKey.toBase58();
const BLOCKHASH = Keypair.generate().publicKey.toBase58();

function makeConfig(): ConfigService {
  return {
    getOrThrow: (key: string): string => {
      if (key === 'EXPO_PUBLIC_USDC_MINT_ADDRESS') return USDC;
      throw new Error(`missing config ${key}`);
    },
  } as unknown as ConfigService;
}

function makeAuthority(signAndSend: jest.Mock): SettlementAuthoritySigner {
  return { address: AUTHORITY, signAndSend };
}

function makeSolana(overrides: Partial<SolanaRpc> = {}): SolanaRpc {
  return {
    getMinimumBalanceForRentExemption: jest.fn().mockResolvedValue(2_039_280n),
    getRecentBlockhash: jest.fn().mockResolvedValue({
      blockhash: BLOCKHASH,
      lastValidBlockHeight: 1_000,
    }),
    accountExists: jest.fn().mockResolvedValue(true),
    getTokenAccountOwner: jest.fn().mockResolvedValue(AUTHORITY),
    getTokenAccountBalanceRaw: jest.fn().mockResolvedValue('0'),
    ...overrides,
  } as unknown as SolanaRpc;
}

function makeProvider(
  solana: SolanaRpc,
  signAndSend = jest.fn().mockResolvedValue('sig'),
): DirectUsdcProvider {
  const provider = new DirectUsdcProvider(
    solana,
    makeAuthority(signAndSend),
    makeConfig(),
  );
  provider.onModuleInit();
  return provider;
}

describe('DirectUsdcProvider', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('advertises USDC, refund support, and instant settlement', () => {
    const provider = makeProvider(makeSolana());
    expect(provider.capabilities).toEqual({
      provider: 'direct_usdc',
      currencies: ['USDC'],
      refundSupport: true,
      settlementLatency: 'instant',
    });
  });

  it('provisions a distinct authority-owned token account per Merchant, reading rent through the seam', async () => {
    const rentMock = jest.fn().mockResolvedValue(2_039_280n);
    const solana = makeSolana({ getMinimumBalanceForRentExemption: rentMock });
    const signAndSend = jest.fn().mockResolvedValue('provision-sig');
    const provider = makeProvider(solana, signAndSend);

    const a = await provider.provision({ merchantId: 'm_1' });
    const b = await provider.provision({ merchantId: 'm_2' });

    expect(a.attributionRef).toBe(AUTHORITY);
    expect(a.payoutConfig).toBeNull();
    expect(a.address).toBe(a.providerReference);
    // Distinct addresses per Merchant (REQ-ATTRIBUTABLE truth #4).
    expect(a.address).not.toBe(b.address);
    expect(rentMock).toHaveBeenCalledWith(165n);
    // The authority co-signs and broadcasts the create-account tx.
    expect(signAndSend).toHaveBeenCalledTimes(2);
  });

  it('links a recorded merchant-own address with null attribution (no Xend custody)', async () => {
    const merchantWallet = Keypair.generate().publicKey.toBase58();
    const accountExists = jest.fn().mockResolvedValue(true);
    const provider = makeProvider(makeSolana({ accountExists }));

    const endpoint = await provider.provision({
      merchantId: 'm_own',
      merchantAddress: merchantWallet,
    });

    expect(accountExists).toHaveBeenCalledWith(merchantWallet);
    expect(endpoint.attributionRef).toBeNull();
    expect(endpoint.providerReference).toBe(merchantWallet);
    expect(endpoint.payoutConfig).toBeNull();
  });

  it('handleIncomingSettlement returns complete synchronously (USDC landed is settlement)', async () => {
    const provider = makeProvider(makeSolana());
    const completion = await provider.handleIncomingSettlement({
      endpointAddress: Keypair.generate().publicKey.toBase58(),
      signature: 'sig123',
      amountRaw: '1000000',
    });
    expect(completion).toEqual({ status: 'complete' });
  });

  it('reverse authority-signs a USDC TransferChecked back to the Consumer', async () => {
    const endpoint = Keypair.generate().publicKey.toBase58();
    const consumer = Keypair.generate().publicKey.toBase58();
    const signAndSend = jest.fn().mockResolvedValue('reverse-sig');
    // Endpoint is authority-owned -> refund proceeds.
    const solana = makeSolana({
      getTokenAccountOwner: jest.fn().mockResolvedValue(AUTHORITY),
    });
    const provider = makeProvider(solana, signAndSend);

    const result = await provider.reverse({
      endpointAddress: endpoint,
      consumerAddress: consumer,
      amountRaw: '500000',
      paymentId: 'pay_1',
    });

    expect(result.signature).toBe('reverse-sig');
    expect(signAndSend).toHaveBeenCalledTimes(1);
  });

  it('reverse on a merchant-own endpoint throws REFUND_NOT_SUPPORTED', async () => {
    const endpoint = Keypair.generate().publicKey.toBase58();
    const consumer = Keypair.generate().publicKey.toBase58();
    const otherOwner = Keypair.generate().publicKey.toBase58();
    const signAndSend = jest.fn();
    const solana = makeSolana({
      getTokenAccountOwner: jest.fn().mockResolvedValue(otherOwner),
    });
    const provider = makeProvider(solana, signAndSend);

    await expect(
      provider.reverse({
        endpointAddress: endpoint,
        consumerAddress: consumer,
        amountRaw: '500000',
        paymentId: 'pay_2',
      }),
    ).rejects.toThrow(RefundNotSupportedError);
    expect(signAndSend).not.toHaveBeenCalled();
  });
});
