import type { ConfigService } from '@nestjs/config';
import type { SquadsAccountStore } from '../../account/account.interface';
import type { Principal } from '../../auth/principal';
import type { TransferService } from '../../transfer/transfer.service';
import type { PgFundingStore } from './funding-store';

/** Preparation adapter only; deliberately not exposed as an HTTP endpoint.
 * The execution coordinator must pin the returned transfer intent before enabling
 * submission and reconcile its signature against the funding ledger. Preparation
 * is not a payout event and must never release or consume a reservation.
 */
export class FundingSpendBridge {
  constructor(
    private readonly funding: Pick<PgFundingStore, 'get'>,
    private readonly accounts: Pick<SquadsAccountStore, 'findByUserId'>,
    private readonly transfers: Pick<TransferService, 'prepare'>,
    private readonly config: Pick<ConfigService, 'get'>,
  ) {}

  async prepare(principal: Principal, fundingIntentId: string) {
    if (
      principal.tier !== 'full' ||
      !principal.userId?.trim() ||
      principal.userId === 'local-unified-simulation'
    ) {
      throw new Error('FUNDING_AUTHENTICATED_CONSUMER_REQUIRED');
    }
    const intent = await this.funding.get(principal.userId, fundingIntentId);
    if (
      !intent ||
      intent.ownerId !== principal.userId ||
      intent.id !== fundingIntentId
    ) {
      throw new Error('FUNDING_INTENT_NOT_FOUND');
    }
    const { state, plan, executionBinding: binding } = intent;
    if (
      !state ||
      state.id !== intent.id ||
      state.status !== 'ready_to_send' ||
      state.payoutStarted ||
      state.destinationCurrency !== 'USDC' ||
      plan.destinationCurrency !== 'USDC' ||
      state.payoutActionReference !== intent.payoutActionReference ||
      state.nativeReservedMinor !== plan.directMinor ||
      state.payoutMinor !== plan.recipientMinor ||
      plan.payoutFeeMinor !== '0' ||
      !/^[1-9]\d*$/.test(plan.recipientMinor) ||
      BigInt(plan.recipientMinor) > 18446744073709551615n
    ) {
      throw new Error('FUNDING_USDC_PAYOUT_NOT_READY');
    }
    // The durable reducer requires independently reconciled debit AND credit.
    // Recheck its projection against the immutable quote; a status label alone
    // cannot turn a simulated credit or a mismatched conversion into funding.
    if (plan.conversion) {
      const conversion = state.conversion;
      if (
        !conversion ||
        !conversion.sourceDebited ||
        !conversion.destinationConfirmed ||
        conversion.actionReference !== intent.conversionActionReference ||
        conversion.sourceCurrency !== 'NGN' ||
        conversion.sourceMinor !== plan.conversion.sourceDebitMinor ||
        conversion.destinationMinor !==
          plan.conversion.destinationCreditMinor ||
        conversion.sourceEvidence?.kind !== 'bank_reconciliation' ||
        conversion.sourceEvidence.currency !== 'NGN' ||
        conversion.sourceEvidence.amountMinor !== conversion.sourceMinor ||
        !conversion.sourceEvidence.reference?.trim() ||
        conversion.destinationEvidence?.kind !== 'onchain_finality' ||
        conversion.destinationEvidence.currency !== 'USDC' ||
        conversion.destinationEvidence.amountMinor !==
          conversion.destinationMinor ||
        !conversion.destinationEvidence.reference?.trim()
      ) {
        throw new Error('FUNDING_CONVERSION_NOT_RECONCILED');
      }
    } else if (state.conversion) {
      throw new Error('FUNDING_CONVERSION_NOT_RECONCILED');
    }
    const solana = binding.solana;
    const network = this.config.get<string>('SOLANA_CLUSTER');
    const mint = this.config.get<string>('EXPO_PUBLIC_USDC_MINT_ADDRESS');
    if (
      !solana ||
      (network !== 'devnet' && network !== 'mainnet') ||
      !mint ||
      solana.network !== network ||
      solana.mint !== mint ||
      binding.payoutProvider !== 'solana-vault'
    ) {
      throw new Error('FUNDING_SOLANA_BINDING_MISMATCH');
    }
    const account = await this.accounts.findByUserId(principal.userId);
    if (
      !account ||
      account.userId !== principal.userId ||
      account.vaultAddress !== solana.vaultAddress ||
      binding.payoutDestination === account.vaultAddress
    ) {
      // TransferService treats a destination equal to the vault as a wallet
      // sweep. Funding payouts must always spend the bound Consumer vault.
      throw new Error('FUNDING_VAULT_BINDING_MISMATCH');
    }
    const transfer = await this.transfers.prepare(principal.userId, {
      toAddress: binding.payoutDestination,
      mint: solana.mint,
      amountRaw: plan.recipientMinor,
    });
    return {
      fundingIntentId: intent.id,
      payoutActionReference: intent.payoutActionReference,
      transfer,
    };
  }
}
