import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NombaAdapter } from './nomba.adapter';
import { NombaSandboxAuth } from './nomba-auth';
import { PagaProvider } from './paga.provider';
import type {
  BankAccountProvider,
  BankAccountReader,
  BankBalanceReader,
  BankUsdValuationReader,
  BankPayoutProvider,
} from './banking-provider.interface';
type BankProvider = BankAccountProvider & BankPayoutProvider;
/** Banking capabilities stay separate from executable conversion routes. */
@Injectable()
export class BankingRegistry {
  private readonly providers = new Map<string, BankProvider>();
  private readonly authenticated = new Set<string>();
  constructor(config: ConfigService) {
    if (config.get<string>('NODE_ENV') === 'production') return;
    const enabled = new Set(
      (config.get<string>('FIAT_BANKING_PROVIDERS') ?? '')
        .split(',')
        .map((name) => name.trim()),
    );
    if (enabled.has('nomba')) {
      const clientId = config.get<string>('NOMBA_SANDBOX_CLIENT_ID');
      const clientSecret = config.get<string>('NOMBA_SANDBOX_CLIENT_SECRET');
      const accountId = config.get<string>('NOMBA_SANDBOX_ACCOUNT_ID');
      if (clientId && clientSecret && accountId) {
        const auth = new NombaSandboxAuth({
          clientId,
          clientSecret,
          accountId,
        });
        this.providers.set(
          'nomba',
          new NombaAdapter({
            senderName: 'Xend Sandbox',
            accountId,
            accessToken: () => auth.getAccessToken(),
            onUnauthorized: (token) => auth.invalidate(token),
          }),
        );
        this.authenticated.add('nomba');
      } else if (!clientId && !clientSecret && !accountId) {
        this.providers.set(
          'nomba',
          new NombaAdapter({ senderName: 'Xend Sandbox' }),
        );
      }
    }
    if (enabled.has('paga')) {
      const publicKey = config.get<string>('PAGA_SANDBOX_PUBLIC_KEY');
      const secretKey = config.get<string>('PAGA_SANDBOX_SECRET_KEY');
      const hashKey = config.get<string>('PAGA_SANDBOX_HASH_KEY');
      if (publicKey && secretKey && hashKey) {
        this.providers.set(
          'paga',
          new PagaProvider({
            environment: 'sandbox',
            publicKey,
            secretKey,
            hashKey,
          }),
        );
        this.authenticated.add('paga');
      }
    }
  }
  capabilities() {
    return [...this.providers.keys()].map((provider) => ({
      provider,
      environment: 'sandbox' as const,
      authentication: this.authenticated.has(provider)
        ? ('authenticated' as const)
        : ('anonymous' as const),
      collection: true,
      bankPayout: true,
      conversion: false,
      productionExecution: false,
    }));
  }
  accountProvisioningReady(name: string): boolean {
    return this.providers.has(name) && this.authenticated.has(name);
  }
  accountReader(name: string): BankAccountReader | null {
    if (!this.authenticated.has(name)) return null;
    const provider = this.providers.get(name);
    if (!(provider instanceof PagaProvider)) return null;
    return {
      async retrieveAccount(accountReference, requestReference) {
        const account = await provider.retrieveAccount(
          accountReference,
          requestReference,
        );
        return {
          provider: provider.name,
          reference: account.accountReference,
          accountNumber: account.accountNumber,
          accountName: account.accountName,
          bankName: 'Paga',
          currency: 'NGN',
          custody: 'pooled',
        };
      },
    };
  }
  balanceReader(name: string): BankBalanceReader | null {
    // Nomba virtual accounts route collections to a parent account. Returning
    // the merchant balance would misattribute other customers' money.
    if (name !== 'paga' || !this.authenticated.has(name)) return null;
    const provider = this.providers.get(name);
    return provider instanceof PagaProvider ? provider : null;
  }
  usdValuationReader(): BankUsdValuationReader | null {
    if (!this.authenticated.has('nomba')) return null;
    const provider = this.providers.get('nomba');
    return provider instanceof NombaAdapter ? provider : null;
  }
  get(name: string): BankProvider {
    const provider = this.providers.get(name);
    if (!provider) throw new Error('BANK_PROVIDER_UNAVAILABLE');
    return provider;
  }
}
