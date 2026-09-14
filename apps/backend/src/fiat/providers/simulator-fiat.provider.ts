// Implements an asynchronous provider port using local deterministic results.
/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from '@nestjs/common';
import type {
  FiatProvider,
  FiatRoute,
  ProviderFiatQuote,
  ProviderFiatOrder,
} from '../fiat-provider.interface';
import { FiatError } from '../fiat.errors';

/** No bank details, signing, network calls or balance writes, even in error paths. */
@Injectable()
export class SimulatorFiatProvider implements FiatProvider {
  readonly name = 'simulator';
  async routes(): Promise<FiatRoute[]> {
    return (['receive', 'send'] as const).map((direction) => ({
      id: `simulator:${direction}`,
      provider: this.name,
      direction,
      environment: 'simulation',
      sourceCurrency: direction === 'receive' ? 'NGN' : 'USDC',
      destinationCurrency: direction === 'receive' ? 'USDC' : 'NGN',
      network: 'solana',
      quoteAvailable: true,
      orderAvailable: true,
      accountKinds: [],
      holdsFiat: false,
      thirdPartyPayments: 'unknown',
    }));
  }
  async quote(
    route: FiatRoute,
    amountMinor: string,
  ): Promise<ProviderFiatQuote> {
    const amount = BigInt(amountMinor);
    // Fixed simulation price: NGN 1500 / USDC; zero fees. Never a market rate.
    const credit =
      route.direction === 'receive'
        ? (amount * 1000000n) / 150000n
        : (amount * 150000n) / 1000000n;
    if (credit <= 0n)
      throw new FiatError('INVALID_AMOUNT', 'Amount is too small.');
    return {
      reference: `simulation-${Date.now()}`,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      debit: {
        currency: route.sourceCurrency,
        amountMinor,
        decimals: route.direction === 'receive' ? 2 : 6,
      },
      credit: {
        currency: route.destinationCurrency,
        amountMinor: credit.toString(),
        decimals: route.direction === 'receive' ? 6 : 2,
      },
      fees: [],
      fields: [],
      paymentStep: 'simulation',
    };
  }
  async createOrder(
    input: Parameters<FiatProvider['createOrder']>[0],
  ): Promise<ProviderFiatOrder> {
    return {
      reference: input.idempotencyKey,
      status: 'awaiting_payment',
      instructions: {
        kind: 'simulation',
        message: 'Test mode. No real bank account, transfer or Balance change.',
        expiresAt: input.quote.expiresAt,
      },
    };
  }
  async getOrder(): Promise<ProviderFiatOrder> {
    throw new FiatError(
      'SIMULATION_LOCAL_STATE',
      'Simulation state is stored by Xend.',
    );
  }
}
