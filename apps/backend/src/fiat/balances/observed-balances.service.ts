import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublicKey } from '@solana/web3.js';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DbService } from '../../db/db.service';
import { SOLANA_RPC } from '../../solana/solana-rpc.interface';
import type { SolanaRpc } from '../../solana/solana-rpc.interface';
import { BankingRegistry } from '../banking/banking.registry';
import type { BankAccount } from '../banking/banking-provider.interface';
import type {
  ObservedBalances,
  ObservedHolding,
} from './observed-balances.types';

const MINTS = {
  devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
} as const;
const RPC_HOSTS = {
  devnet: ['devnet.helius-rpc.com', 'api.devnet.solana.com'],
  mainnet: ['mainnet.helius-rpc.com', 'api.mainnet-beta.solana.com'],
};
const unsigned = (value: unknown): value is string =>
  typeof value === 'string' && /^(0|[1-9]\d{0,39})$/.test(value);
const unavailable = (
  currency: 'NGN' | 'USDC',
  reason: string,
): ObservedHolding => ({
  currency,
  decimals: currency === 'NGN' ? 2 : 6,
  status: 'unavailable',
  amountMinor: null,
  observedAt: null,
  reason,
});

/** Observational read path only. Never credits the ledger or reserves funds. */
@Injectable()
export class ObservedBalancesService {
  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    private readonly banking: BankingRegistry,
    @Inject(SOLANA_RPC) private readonly rpc: SolanaRpc,
  ) {}

  async get(ownerId: string): Promise<ObservedBalances> {
    const cluster = this.config.get<string>('SOLANA_CLUSTER');
    const network =
      cluster === 'mainnet' || cluster === 'devnet' ? cluster : null;
    const [ngn, usdc] = await Promise.all([
      this.naira(ownerId),
      this.usdc(ownerId, network),
    ]);
    const result: ObservedBalances = {
      mode: 'observed',
      bankEnvironment: 'sandbox',
      network,
      holdings: [ngn, usdc],
      total: null,
      valuationReason: 'BALANCE_UNAVAILABLE',
    };
    if (network !== 'devnet') {
      result.valuationReason = 'ENVIRONMENTS_DO_NOT_MATCH';
      return result;
    }
    if (ngn.amountMinor === null || usdc.amountMinor === null) return result;
    if (ngn.amountMinor === '0') {
      result.total = {
        currency: 'USD',
        amountMinor: (BigInt(usdc.amountMinor) / 10_000n).toString(),
        estimate: true,
        asOf: new Date(
          Math.min(Date.parse(ngn.observedAt!), Date.parse(usdc.observedAt!)),
        ).toISOString(),
      };
      result.valuationReason = null;
      return result;
    }
    result.valuationReason = 'QUOTE_UNAVAILABLE';
    const valuation = this.banking.usdValuationReader();
    if (!valuation) return result;
    try {
      // Only the sandbox estimate seam is called. /money/convert calculates
      // a quote; /exchange/authorize is a separate money-moving operation.
      // USD display assumes USDC/USD parity and is never a spendable amount.
      const quote = await valuation.quoteNgnUsd(ngn.amountMinor);
      const observed = Date.parse(quote.observedAt);
      const expires = Date.parse(quote.expiresAt);
      if (
        quote.environment !== 'sandbox' ||
        quote.evidence !== 'fixture' ||
        quote.debitNgnMinor !== ngn.amountMinor ||
        !unsigned(quote.creditUsdMinor) ||
        BigInt(quote.creditUsdMinor) === 0n ||
        !Number.isFinite(observed) ||
        !Number.isFinite(expires) ||
        observed > Date.now() + 5000 ||
        observed < Date.now() - 60000 ||
        expires <= Date.now()
      )
        return result;
      result.total = {
        currency: 'USD',
        amountMinor: (
          BigInt(quote.creditUsdMinor) +
          BigInt(usdc.amountMinor) / 10000n
        ).toString(),
        estimate: true,
        asOf: new Date(
          Math.min(
            observed,
            Date.parse(ngn.observedAt!),
            Date.parse(usdc.observedAt!),
          ),
        ).toISOString(),
      };
      result.valuationReason = null;
    } catch {
      // Preserve the independent holdings when a rate cannot be obtained.
    }
    return result;
  }

  private async naira(ownerId: string): Promise<ObservedHolding> {
    const provider = this.config.get<string>('FIAT_NGN_ACCOUNT_PROVIDER');
    if (provider !== 'paga' && provider !== 'nomba')
      return unavailable('NGN', 'BANK_PROVIDER_NOT_CONFIGURED');
    const rows = await this.db.client.execute(sql`
      SELECT status, account, account_reference FROM fiat_bank_accounts
      WHERE owner_id = ${ownerId} AND provider = ${provider}
        AND environment = 'sandbox'
    `);
    if (rows.rows.length !== 1)
      return unavailable('NGN', 'BANK_ACCOUNT_UNAVAILABLE');
    const row = rows.rows[0] as {
      status: string;
      account: BankAccount | null;
      account_reference: string;
    };
    if (row.status !== 'active' || !row.account)
      return unavailable('NGN', 'BANK_ACCOUNT_NOT_ACTIVE');
    if (
      row.account.provider !== provider ||
      row.account.currency !== 'NGN' ||
      row.account.reference !== row.account_reference
    )
      return unavailable('NGN', 'BANK_ACCOUNT_MISMATCH');
    const reader = this.banking.balanceReader(provider);
    if (!reader) return unavailable('NGN', 'CUSTOMER_BALANCE_UNAVAILABLE');
    try {
      const balance = await reader.getBalance(
        row.account_reference,
        randomUUID(),
      );
      const time = Date.parse(balance.observedAt);
      if (
        balance.currency !== 'NGN' ||
        !unsigned(balance.amountMinor) ||
        !Number.isFinite(time) ||
        time > Date.now() + 30_000 ||
        time < Date.now() - 120_000
      )
        return unavailable('NGN', 'BANK_BALANCE_INVALID_OR_STALE');
      return {
        currency: 'NGN',
        decimals: 2,
        status: 'available',
        amountMinor: balance.amountMinor,
        observedAt: new Date(time).toISOString(),
        reason: null,
      };
    } catch {
      return unavailable('NGN', 'BANK_BALANCE_UNAVAILABLE');
    }
  }

  private async usdc(
    ownerId: string,
    network: 'devnet' | 'mainnet' | null,
  ): Promise<ObservedHolding> {
    const mint = this.config.get<string>('EXPO_PUBLIC_USDC_MINT_ADDRESS');
    if (!network || mint !== MINTS[network])
      return unavailable('USDC', 'CHAIN_CONFIGURATION_MISMATCH');
    // Failover can switch endpoints mid-read: both must be on the same cluster.
    // Unknown/custom RPC hosts need explicit network attestation before use here.
    try {
      for (const key of ['HELIUS_RPC_URL', 'SOLANA_PUBLIC_RPC_URL']) {
        const url = new URL(this.config.get<string>(key) ?? '');
        if (
          url.protocol !== 'https:' ||
          !RPC_HOSTS[network].includes(url.hostname)
        )
          return unavailable('USDC', 'RPC_NETWORK_UNVERIFIED');
      }
    } catch {
      return unavailable('USDC', 'RPC_NETWORK_UNVERIFIED');
    }
    const rows = await this.db.client.execute(sql`
      SELECT vault_address FROM squads_accounts WHERE user_id = ${ownerId}
    `);
    if (rows.rows.length !== 1) return unavailable('USDC', 'VAULT_UNAVAILABLE');
    try {
      const vault = (rows.rows[0] as { vault_address: string }).vault_address;
      new PublicKey(vault);
      const balances = await this.rpc.getTokenBalances(vault);
      let amount = 0n;
      for (const balance of balances) {
        if (balance.mint !== mint) continue;
        if (balance.decimals !== 6 || balance.amountRaw < 0n)
          return unavailable('USDC', 'CHAIN_BALANCE_INVALID');
        amount += balance.amountRaw;
      }
      return {
        currency: 'USDC',
        decimals: 6,
        status: 'available',
        amountMinor: amount.toString(),
        observedAt: new Date().toISOString(),
        reason: null,
      };
    } catch {
      return unavailable('USDC', 'CHAIN_BALANCE_UNAVAILABLE');
    }
  }
}
