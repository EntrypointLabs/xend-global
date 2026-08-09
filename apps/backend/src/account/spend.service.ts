import { Inject, Injectable, Logger } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import {
  buildSpend,
  deriveAccountAddresses,
  derivePolicyAddress,
  resolveSpendRoute,
  type SpendingLimit,
  type SpendRoute,
} from '@xend/smart-account';

import { AccountCreationError } from './account.errors';
import {
  ABOVE_LIMIT_POLICY_SEED,
  SPEND_CHAIN,
  SQUADS_ACCOUNT_STORE,
} from './account.interface';
import type {
  SpendChain,
  SquadsAccountStore,
  UnsignedSpend,
} from './account.interface';

export interface PrepareSpendParams {
  userId: string;
  destination: string;
  mint: string;
  /** Integer string at the mint's native decimals. */
  amountRaw: string;
  decimals: number;
}

/**
 * Prepares a Spend out of the Consumer's Squads vault.
 *
 * ## Who pays the fee
 *
 * The primary signer (S1, the Privy wallet), not the relayer. D7 keeps sends
 * gasless through the relayer, but the relayer's allowlist deliberately
 * excludes everything except ComputeBudget, Token and ATA, so it cannot pay for
 * a Squads instruction without widening a surface that was made narrow on
 * purpose. Paying from S1 is correct today and gasless is an optimisation on
 * top, not a prerequisite for spending.
 *
 * ## How many signatures
 *
 * Decided by the chain, not by us. `resolveSpendRoute` only returns the
 * one-signature route when a spending limit positively admits the Spend;
 * anything unresolved falls through to two signatures. An Account with no
 * spending limit therefore needs S2 on every Spend, which is the safe default
 * rather than an oversight.
 */
@Injectable()
export class SpendService {
  private readonly logger = new Logger(SpendService.name);

  constructor(
    @Inject(SQUADS_ACCOUNT_STORE) private readonly store: SquadsAccountStore,
    @Inject(SPEND_CHAIN) private readonly chain: SpendChain,
  ) {}

  async prepare(params: PrepareSpendParams): Promise<UnsignedSpend> {
    const account = await this.store.findByUserId(params.userId);
    if (!account) {
      throw new AccountCreationError('No Account exists for this Consumer');
    }

    const addresses = deriveAccountAddresses(account.settingsSeed);
    const request = {
      mint: new PublicKey(params.mint),
      amount: BigInt(params.amountRaw),
      destination: new PublicKey(params.destination),
    };

    const limits = await this.chain.readSpendingLimits();
    const aboveLimitPolicy = derivePolicyAddress(
      addresses.settings,
      ABOVE_LIMIT_POLICY_SEED,
    );
    const route = resolveSpendRoute(request, limits, aboveLimitPolicy);
    const signers = signersFor(route, account);

    const instruction = buildSpend({
      addresses,
      request,
      route,
      signers,
      decimals: params.decimals,
    });

    const unsigned = await this.chain.compile({
      instruction,
      // S1 pays, so it is both a signer on the Spend and the fee payer.
      feePayer: new PublicKey(account.primarySigner),
    });

    this.logger.log(
      `spend.prepared userId=${params.userId} route=${route.kind}` +
        (route.kind === 'two-signature' ? ` reason=${route.reason}` : ''),
    );

    return {
      ...unsigned,
      route: route.kind,
      /** Mobile needs this to know whether to ask Turnkey for a signature. */
      needsApprovalSignature: route.kind === 'two-signature',
    };
  }
}

function signersFor(
  route: SpendRoute,
  account: { primarySigner: string; approvalSigner: string },
): PublicKey[] {
  const primary = new PublicKey(account.primarySigner);
  if (route.kind === 'spending-limit') return [primary];
  return [primary, new PublicKey(account.approvalSigner)];
}

export type { SpendingLimit };
