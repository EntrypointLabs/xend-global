import { Inject, Injectable, Logger } from '@nestjs/common';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import {
  buildSpend,
  deriveAccountAddresses,
  derivePolicyAddress,
  resolveSpendRoute,
  type AccountAddresses,
  type SpendingLimit,
  type SpendRequest,
  type SpendRoute,
} from '@xend/smart-account';

import {
  PREPARED_TX_STORE,
  PREPARED_TX_TTL_SECONDS,
} from '../prepared/prepared-tx.interface';
import type { PreparedTxStore } from '../prepared/prepared-tx.interface';
import {
  SETTLEMENT_AUTHORITY_SIGNER,
  type SettlementAuthoritySigner,
} from '../settlement/settlement-authority.interface';
import { AccountCreationError } from './account.errors';
import {
  ABOVE_LIMIT_POLICY_SEED,
  spendingLimitSeed,
  SPEND_CHAIN,
  SQUADS_ACCOUNT_STORE,
} from './account.interface';
import type {
  SpendChain,
  SquadsAccountRow,
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
  /**
   * The token account to credit, when the destination does not hold the money
   * in its associated one. A Merchant's settlement endpoint is such an account.
   * Naming it also means there is nothing to open, so the Spend carries no
   * account-creation instruction.
   */
  destinationTokenAccount?: string;
}

/**
 * Prepares a Spend out of the Consumer's Squads vault.
 *
 * ## Who pays the fee
 *
 * The settlement authority. Not the relayer, whose allowlist deliberately
 * excludes everything except ComputeBudget, Token and ATA and so cannot carry a
 * Squads instruction without widening a surface that was made narrow on
 * purpose. And not S1: a Consumer paid only in USDC holds no lamports at all,
 * so a Spend charged to their Privy wallet dies before it reaches the program.
 *
 * That splits the Spend across two parties, which is why {@link submit} exists.
 * The device returns a transaction one signature short, and only the authority
 * can complete it.
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
    @Inject(SETTLEMENT_AUTHORITY_SIGNER)
    private readonly authority: SettlementAuthoritySigner,
    /**
     * Every message this service compiled and has not yet broadcast.
     *
     * Keyed by the message rather than the Consumer because two callers
     * prepare through here, a Send and a Checkout settlement, and either may
     * have more than one Spend open at once.
     */
    @Inject(PREPARED_TX_STORE) private readonly prepared: PreparedTxStore,
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
      ...(params.destinationTokenAccount
        ? {
            destinationTokenAccount: new PublicKey(
              params.destinationTokenAccount,
            ),
          }
        : {}),
    };

    // Native SOL has no token program; anything else needs its mint's own.
    const tokenProgram = request.mint.equals(PublicKey.default)
      ? undefined
      : await this.chain.tokenProgramFor(request.mint.toBase58());

    const limits = await this.chain.readSpendingLimits(
      account.settingsAddress,
      spendingLimitSeed(account),
    );
    const aboveLimitPolicy = derivePolicyAddress(
      addresses.settings,
      ABOVE_LIMIT_POLICY_SEED,
    );
    const resolved = resolveSpendRoute(request, limits, aboveLimitPolicy);
    const route = await this.recheckAgainstProgram(
      resolved,
      limits,
      request,
      addresses,
      account,
      params.decimals,
      tokenProgram,
    );
    const signers = signersFor(route, account);

    const instruction = buildSpend({
      addresses,
      request,
      route,
      signers,
      decimals: params.decimals,
      tokenProgram,
    });

    // A recipient who has never held this token has no account to receive it
    // into, and the policy refuses the Spend rather than opening one. Rent
    // falls to the fee payer for the same reason fees do. A caller that named
    // the account is pointing at one that already exists, so there is nothing
    // to open.
    const openDestination =
      tokenProgram && !params.destinationTokenAccount
        ? await this.chain.createDestinationTokenAccount({
            mint: params.mint,
            destination: params.destination,
            tokenProgram,
          })
        : null;

    const unsigned = await this.chain.compile({
      instructions: openDestination
        ? [openDestination, instruction]
        : [instruction],
    });

    await this.prepared.set(
      preparedKey(unsigned.messageBase64),
      params.userId,
      PREPARED_TX_TTL_SECONDS,
    );

    this.logger.log(
      `spend.prepared userId=${params.userId} route=${route.kind}` +
        ` feePayer=${this.chain.feePayer}` +
        (route.kind === 'two-signature' ? ` reason=${route.reason}` : ''),
    );

    return {
      ...unsigned,
      vaultAddress: addresses.vault.toBase58(),
      primarySigner: account.primarySigner,
      route: route.kind,
      /** Mobile needs this to know whether to ask Turnkey for a signature. */
      needsApprovalSignature: route.kind === 'two-signature',
    };
  }

  /**
   * Second-guesses a two-signature route that only exists because the stored
   * counter says the period is spent.
   *
   * `remainingInPeriod` is refilled by the program when a Spend executes under
   * the spending limit. A Consumer who exhausts the limit then reads zero
   * forever, because every later Spend routes two-signature, and that executes
   * under the above-limit policy without ever touching the counter. The day
   * rolls over and nothing notices.
   *
   * Only `exceeds-remaining` is worth rechecking. `exceeds-per-use` is a hard
   * cap on a single Spend and never refills, and the rest do not depend on
   * time. Asking on those would spend an RPC round trip to be told what we
   * already know.
   *
   * A refusal, or an unanswered question, leaves the two-signature route in
   * place. That is the floor, and being wrong in that direction costs a
   * fingerprint rather than a Spend the Consumer did not authorise.
   */
  private async recheckAgainstProgram(
    route: SpendRoute,
    limits: readonly SpendingLimit[],
    request: SpendRequest,
    addresses: AccountAddresses,
    account: SquadsAccountRow,
    decimals: number,
    tokenProgram: PublicKey | undefined,
  ): Promise<SpendRoute> {
    if (
      route.kind !== 'two-signature' ||
      route.reason !== 'exceeds-remaining'
    ) {
      return route;
    }

    const limit = limits.find(
      (candidate) =>
        candidate.mint.equals(request.mint) &&
        request.amount <= candidate.maxPerUse,
    );
    if (!limit) return route;

    const optimistic: SpendRoute = {
      kind: 'spending-limit',
      policy: limit.policy,
    };
    const accepted = await this.chain.wouldSucceed(
      buildSpend({
        addresses,
        request,
        route: optimistic,
        signers: signersFor(optimistic, account),
        decimals,
        tokenProgram,
      }),
    );

    if (!accepted) return route;

    this.logger.log(
      `spend.limit_rolled_over userId=${account.userId} policy=${limit.policy.toBase58()}`,
    );
    return optimistic;
  }

  /**
   * Adds the fee payer's signature to a Spend the device signed, and broadcasts
   * it.
   *
   * A Spend cannot be broadcast straight from the device. The fee payer is the
   * settlement authority, so what comes back is missing the signature in the
   * first slot and the cluster rejects it outright. Signing here is partial and
   * leaves the device's signatures intact, so authorisation still comes from the
   * Account's own signers.
   *
   * Only a message this service compiled is completed. The authority would
   * otherwise co-sign any transaction that named it as fee payer.
   */
  async submit(signedTxBase64: string): Promise<string> {
    const key = preparedKey(messageOf(signedTxBase64));
    if ((await this.prepared.get<string>(key)) === null) {
      throw new AccountCreationError(
        'signed transaction does not match a prepared Spend',
      );
    }

    const signature = await this.authority.signAndSend(signedTxBase64);
    await this.prepared.delete(key);
    this.logger.log(`spend.submitted signature=${signature}`);
    return signature;
  }
}

function messageOf(signedTxBase64: string): string {
  try {
    return Buffer.from(
      VersionedTransaction.deserialize(
        Buffer.from(signedTxBase64, 'base64'),
      ).message.serialize(),
    ).toString('base64');
  } catch {
    throw new AccountCreationError('signedTxBase64 is not a valid transaction');
  }
}

function preparedKey(messageBase64: string): string {
  return `spend:${createHash('sha256').update(messageBase64).digest('hex')}`;
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
