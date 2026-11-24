import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import {
  PublicKey,
  TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js';
import { createHash, randomUUID } from 'node:crypto';
import {
  ABOVE_LIMIT_PROGRAM_ALLOWLIST,
  associatedTokenAddress,
  buildSwap,
  buildSwapOnAllowance,
  deriveAccountAddresses,
  derivePolicyAddress,
  describeTransaction,
  JUPITER_PROGRAM_ID,
  minimumAmountOut,
  ROUTE_TERMS_UNREADABLE,
  TOKEN_PROGRAM_ID,
  VENUE_TAKES_VAULT_SIGNATURE,
  WRAPPED_SOL_MINT,
  type AccountAddresses,
} from '@prydd/smart-account';

import { AccountCreationError } from '../account/account.errors';
import {
  ABOVE_LIMIT_POLICY_SEED,
  SQUADS_ACCOUNT_STORE,
} from '../account/account.interface';
import type { SquadsAccountStore } from '../account/account.interface';
import {
  PREPARED_TX_STORE,
  PREPARED_TX_TTL_SECONDS,
} from '../prepared/prepared-tx.interface';
import type { PreparedTxStore } from '../prepared/prepared-tx.interface';
import {
  SETTLEMENT_AUTHORITY_SIGNER,
  type SettlementAuthoritySigner,
} from '../settlement/settlement-authority.interface';
import type {
  SwapPrepareResponse,
  SwapQuoteRequest,
  SwapQuoteResponse,
} from './dtos';
import {
  AccountNeedsUpdateError,
  NoSwapRouteError,
  SwapMismatchError,
  SwapQuoteExpiredError,
  SwapUnavailableError,
} from './swap.errors';
import { SWAP_CHAIN, SWAP_PROVIDER, SWAP_RECORDS } from './swap.interface';
import type {
  SwapChain,
  SwapPrice,
  SwapProvider,
  SwapRecord,
  SwapRecords,
  SwapRoute,
} from './swap.interface';

/** How far short of the quote a swap may settle before it fails instead. */
const SLIPPAGE_BPS = 50;

/** How long a price is offered for. Short, because it is a price. */
const QUOTE_LIFETIME_SECONDS = 30;

/**
 * How long the quote is kept. Longer than it is offered for, so a Consumer who
 * confirms in the last second is told the price expired rather than that the
 * quote never existed.
 */
const QUOTE_RETENTION_SECONDS = 120;

/**
 * How many times a price is asked for again after a refused route. Each one
 * is a round trip the Consumer waits through while the keypad shows nothing.
 */
const MAX_QUOTE_ATTEMPTS = 5;

/** Refusals that are about the venues on a route, so other venues may pass. */
const VENUE_REFUSALS = new Set([
  VENUE_TAKES_VAULT_SIGNATURE,
  ROUTE_TERMS_UNREADABLE,
]);

interface StoredRoute {
  programId: string;
  data: string;
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  lookupTables: string[];
}

interface StoredQuote {
  userId: string;
  price: SwapPrice;
  route: StoredRoute;
  expiresAt: number;
}

/**
 * Swaps one asset in a Consumer's vault for another.
 *
 * A swap is a Spend that pays the vault itself. It executes under the
 * above-limit policy, so it takes both signatures whatever the amount: a
 * spending limit caps what leaves for a destination, and a swap has none.
 *
 * The policy admits the swap program and checks nothing finer, so the chain
 * will run any route the two signers approve. Holding the route to the quote
 * is the signing device's job, which is why the route is built in one fixed
 * shape here and never handed over as the provider wrote it.
 *
 * An Account set up before Swap has a policy that does not admit the swap
 * program, and adding it is a settings change that waits out the time lock.
 * Such an Account swaps on an allowance instead: the vault lends its primary
 * signer the right to move exactly the amount being swapped, and the route
 * runs beside the vault. Same two signatures, same check on the device, and
 * nothing to wait for.
 */
@Injectable()
export class SwapService {
  private readonly logger = new Logger(SwapService.name);
  /**
   * Policies already seen to admit the swap program. A program is never
   * taken off a policy, so only the ones without it are worth reading again.
   */
  private readonly admitsSwap = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    @Inject(SQUADS_ACCOUNT_STORE) private readonly store: SquadsAccountStore,
    @Inject(SWAP_PROVIDER) private readonly provider: SwapProvider,
    @Inject(SWAP_CHAIN) private readonly chain: SwapChain,
    @Inject(SETTLEMENT_AUTHORITY_SIGNER)
    private readonly authority: SettlementAuthoritySigner,
    @Inject(PREPARED_TX_STORE) private readonly prepared: PreparedTxStore,
    @Inject(SWAP_RECORDS) private readonly records: SwapRecords,
  ) {}

  /**
   * Prices a swap the Consumer could actually make.
   *
   * The best price on offer is not always one that can be taken. A route may
   * be too large to send inside a Spend, or shaped in a way the signing
   * device refuses, and a Consumer shown that price would confirm it and be
   * turned away. So the route is built and checked before the price is
   * quoted. A route through a venue that wants the vault's signature is asked
   * for again without that venue, and one too large to send is asked for
   * again as a single venue.
   */
  async quote(
    userId: string,
    request: SwapQuoteRequest,
  ): Promise<SwapQuoteResponse> {
    this.assertAvailable();
    if (request.inputMint === request.outputMint) {
      throw new NoSwapRouteError('Choose two different assets');
    }
    const account = await this.accountOf(userId);
    const shape = await this.shapeFor(account);

    let refusal = 'No route for this pair';
    const avoid = new Set<string>();
    let directOnly = false;
    for (let attempt = 0; attempt < MAX_QUOTE_ATTEMPTS; attempt++) {
      let price: SwapPrice;
      let route: SwapRoute | undefined;
      try {
        price = await this.provider.quote({
          inputMint: request.inputMint,
          outputMint: request.outputMint,
          amountInRaw: request.amountRaw,
          slippageBps: SLIPPAGE_BPS,
          directOnly,
          excludeVenues: [...avoid],
        });
      } catch (err) {
        if (!(err instanceof NoSwapRouteError)) throw err;
        refusal = err.message;
        if (directOnly) break;
        directOnly = true;
        continue;
      }
      // An exact-in quote for another amount is another trade.
      if (price.amountInRaw !== request.amountRaw) break;
      try {
        route = await this.provider.route(price, account.addresses.vault);
        refusal = (await this.unsendable(account, price, route, shape)) ?? '';
      } catch (err) {
        if (!(err instanceof NoSwapRouteError)) throw err;
        refusal = err.message;
      }
      if (refusal || !route) {
        this.logger.warn(
          `swap.route_refused direct=${directOnly} venues=${price.venues.join('>') || 'unknown'} reason=${refusal}`,
        );
        const unseen = price.venues.filter((venue) => !avoid.has(venue));
        if (VENUE_REFUSALS.has(refusal) && unseen.length > 0) {
          unseen.forEach((venue) => avoid.add(venue));
        } else if (!directOnly) {
          directOnly = true;
        } else {
          break;
        }
        continue;
      }

      const quoteId = randomUUID();
      const expiresAt = Math.floor(Date.now() / 1000) + QUOTE_LIFETIME_SECONDS;
      await this.prepared.set<StoredQuote>(
        quoteKey(quoteId),
        { userId, price, route: store(route), expiresAt },
        QUOTE_RETENTION_SECONDS,
      );
      return {
        quoteId,
        inputMint: price.inputMint,
        outputMint: price.outputMint,
        amountInRaw: price.amountInRaw,
        amountOutRaw: price.amountOutRaw,
        minAmountOutRaw: minimumAmountOut(
          BigInt(price.amountOutRaw),
          price.slippageBps,
        ).toString(),
        slippageBps: price.slippageBps,
        venue: price.venue,
        expiresAt,
      };
    }
    throw new NoSwapRouteError(refusal);
  }

  async prepare(userId: string, quoteId: string): Promise<SwapPrepareResponse> {
    this.assertAvailable();
    const stored = await this.prepared.get<StoredQuote>(quoteKey(quoteId));
    if (
      !stored ||
      stored.userId !== userId ||
      stored.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      throw new SwapQuoteExpiredError('The price expired; ask for a new one');
    }
    const { price } = stored;
    const route = restore(stored.route);
    const account = await this.accountOf(userId);

    const shape = await this.shapeFor(account);

    const pair = await this.pairOf(account, price);
    const [inputExists, outputExists] = await this.chain.exists([
      pair.inputAccount,
      pair.outputAccount,
    ]);
    const compiled = await this.chain.compile({
      instructions: this.instructions(account, pair, route, {
        inputExists,
        outputExists,
        ...shape,
      }),
      lookupTables: await this.chain.lookupTables(route.lookupTables),
    });

    await this.prepared.set<PreparedSwap>(
      preparedKey(compiled.messageBase64),
      {
        userId,
        inputMint: price.inputMint,
        outputMint: price.outputMint,
        amountInRaw: price.amountInRaw,
        amountOutRaw: price.amountOutRaw,
      },
      PREPARED_TX_TTL_SECONDS,
    );
    this.logger.log(
      `swap.prepared userId=${userId} provider=${this.provider.name}` +
        ` venue=${price.venue ?? 'unknown'} in=${price.inputMint}` +
        ` out=${price.outputMint} onAllowance=${shape.onAllowance}`,
    );

    return {
      unsignedTxBase64: compiled.unsignedTxBase64,
      vaultAddress: account.addresses.vault.toBase58(),
      primarySigner: account.primarySigner.toBase58(),
      blockhash: compiled.blockhash,
      lastValidBlockHeight: compiled.lastValidBlockHeight,
    };
  }

  /**
   * Why a route cannot be sent, or null when it can.
   *
   * Drafted as its largest case, with both token accounts still to open, and
   * read back through the same code the signing device runs.
   */
  private async unsendable(
    account: SwapAccount,
    price: SwapPrice,
    route: SwapRoute,
    shape: SwapShape,
  ): Promise<string | null> {
    const pair = await this.pairOf(account, price);
    const lookupTables = await this.chain.lookupTables(route.lookupTables);
    let draft: string;
    try {
      draft = this.chain.draft({
        instructions: this.instructions(account, pair, route, {
          inputExists: false,
          outputExists: false,
          // An Account that calls Jupiter itself is drafted against the full
          // list, as it always was. One on an allowance is drafted against
          // its own, because its own is what the instruction has to index.
          ...shape,
          allowed: shape.onAllowance
            ? shape.allowed
            : ABOVE_LIMIT_PROGRAM_ALLOWLIST,
        }),
        lookupTables,
      });
    } catch (err) {
      // Building refuses the same routes the device would, only sooner.
      return err instanceof Error ? err.message : String(err);
    }
    const described = describeTransaction(draft, {
      addresses: account.addresses,
      lookupTables,
    });
    if (described.kind === 'swap') return null;
    return described.kind === 'unknown' ? described.reason : described.kind;
  }

  private instructions(
    account: SwapAccount,
    pair: SwapPair,
    route: SwapRoute,
    state: SwapShape & { inputExists: boolean; outputExists: boolean },
  ): TransactionInstruction[] {
    const feePayer = new PublicKey(this.chain.feePayer);
    const open = (
      mint: PublicKey,
      tokenAccount: PublicKey,
      program: PublicKey,
    ) =>
      createAssociatedTokenAccountIdempotentInstruction(
        feePayer,
        tokenAccount,
        account.addresses.vault,
        mint,
        program,
      );

    const opens: TransactionInstruction[] = [];
    // Only native SOL has an input account to open: any other asset being
    // paid from an account that does not exist is a swap of nothing.
    if (pair.wrapInput && !state.inputExists) {
      opens.push(open(pair.inputMint, pair.inputAccount, TOKEN_PROGRAM_ID));
    }
    if (!state.outputExists) {
      opens.push(open(pair.outputMint, pair.outputAccount, pair.outputProgram));
    }

    // The wrapped SOL account is closed into the vault when the swap ends.
    // Where the fee payer opened it, that hands the vault rent the fee payer
    // paid, so the swap sends it back.
    const frontedWrappedSolRent =
      (pair.wrapInput && !state.inputExists) ||
      (pair.unwrapOutput && !state.outputExists);

    const swap = {
      addresses: account.addresses,
      policy: account.policy,
      signers: [account.primarySigner, account.approvalSigner],
      route: route.instruction,
      wrapInput: pair.wrapInput,
      unwrapOutput: pair.unwrapOutput,
      refundRentTo: frontedWrappedSolRent ? feePayer : undefined,
      allowedPrograms: state.allowed,
    };
    return [
      ...opens,
      ...(state.onAllowance
        ? buildSwapOnAllowance({ ...swap, delegate: account.primarySigner })
        : [buildSwap(swap)]),
    ];
  }

  /**
   * Which of the two shapes this Account's swap takes, read off its policy.
   *
   * A policy with no Token program on it is not one provisioning wrote, and
   * neither shape can run under it.
   */
  private async shapeFor(account: SwapAccount): Promise<SwapShape> {
    const policy = account.policy.toBase58();
    if (this.admitsSwap.has(policy)) {
      return { onAllowance: false, allowed: ABOVE_LIMIT_PROGRAM_ALLOWLIST };
    }
    const allowed = await this.chain.allowedPrograms(account.policy);
    if (allowed.some((program) => program.equals(JUPITER_PROGRAM_ID))) {
      this.admitsSwap.add(policy);
      return { onAllowance: false, allowed };
    }
    if (!allowed.some((program) => program.equals(TOKEN_PROGRAM_ID))) {
      throw new AccountNeedsUpdateError('This Account is not set up to swap');
    }
    return { onAllowance: true, allowed };
  }

  private async pairOf(
    account: SwapAccount,
    price: SwapPrice,
  ): Promise<SwapPair> {
    const inputMint = new PublicKey(price.inputMint);
    const outputMint = new PublicKey(price.outputMint);
    const [inputProgram, outputProgram] = await Promise.all([
      this.chain.tokenProgramFor(inputMint),
      this.chain.tokenProgramFor(outputMint),
    ]);
    return {
      inputMint,
      outputMint,
      outputProgram,
      inputAccount: associatedTokenAddress(
        account.addresses.vault,
        inputMint,
        inputProgram,
      ),
      outputAccount: associatedTokenAddress(
        account.addresses.vault,
        outputMint,
        outputProgram,
      ),
      wrapInput: inputMint.equals(WRAPPED_SOL_MINT),
      unwrapOutput: outputMint.equals(WRAPPED_SOL_MINT),
    };
  }

  private async accountOf(userId: string): Promise<SwapAccount> {
    const row = await this.store.findByUserId(userId);
    if (!row) {
      throw new AccountCreationError('No Account exists for this Consumer');
    }
    const addresses = deriveAccountAddresses(row.settingsSeed);
    return {
      addresses,
      policy: derivePolicyAddress(addresses.settings, ABOVE_LIMIT_POLICY_SEED),
      primarySigner: new PublicKey(row.primarySigner),
      approvalSigner: new PublicKey(row.approvalSigner),
    };
  }

  /**
   * Adds the fee payer's signature to a swap the device signed, and
   * broadcasts it.
   *
   * Only a message this service compiled for this Consumer is completed: the
   * authority would otherwise co-sign any transaction naming it as fee payer.
   * Both of the Account's signatures have to be on it already, which is also
   * what proves the Consumer was there, because the approval signer cannot
   * sign without the device biometric.
   */
  async submit(
    userId: string,
    signedTxBase64: string,
  ): Promise<{ signature: string }> {
    this.assertAvailable();
    let transaction: VersionedTransaction;
    try {
      transaction = VersionedTransaction.deserialize(
        Buffer.from(signedTxBase64, 'base64'),
      );
    } catch {
      throw new SwapMismatchError('signedTxBase64 is not a valid transaction');
    }

    const key = preparedKey(
      Buffer.from(transaction.message.serialize()).toString('base64'),
    );
    const prepared = await this.prepared.get<PreparedSwap>(key);
    if (prepared?.userId !== userId) {
      throw new SwapMismatchError(
        'signed transaction does not match a prepared swap',
      );
    }

    // Slot zero is the fee payer's, filled below. Every other required
    // signature belongs to the Account and has to arrive already made.
    const missing = transaction.signatures
      .slice(1)
      .some((signature) => signature.every((byte) => byte === 0));
    if (missing) {
      throw new SwapMismatchError('the swap is missing a signature');
    }

    const signature = await this.authority.signAndSend(signedTxBase64);
    await this.prepared.delete(key);
    this.logger.log(`swap.submitted userId=${userId} signature=${signature}`);
    // The swap is already on its way, so a label that fails to save costs
    // Activity a word and must not turn a broadcast swap into an error.
    await this.records.record({ ...prepared, signature }).catch((cause) => {
      this.logger.warn(
        `swap.record_failed signature=${signature}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    });
    return { signature };
  }

  private assertAvailable(): void {
    if (this.config.get<boolean>('SWAP_KILLSWITCH') === true) {
      throw new SwapUnavailableError('Swap is switched off');
    }
    // The venues, and the liquidity that makes a price, are on mainnet only.
    if (this.config.get<string>('SOLANA_CLUSTER') !== 'mainnet') {
      throw new SwapUnavailableError('Swap is available on mainnet only');
    }
  }
}

type PreparedSwap = Omit<SwapRecord, 'signature'>;

interface SwapAccount {
  addresses: AccountAddresses;
  policy: PublicKey;
  primarySigner: PublicKey;
  approvalSigner: PublicKey;
}

interface SwapShape {
  /** True when the vault lends an allowance and the route runs beside it. */
  onAllowance: boolean;
  /** The programs the Account's policy admits, in constraint order. */
  allowed: readonly PublicKey[];
}

interface SwapPair {
  inputMint: PublicKey;
  outputMint: PublicKey;
  outputProgram: PublicKey;
  inputAccount: PublicKey;
  outputAccount: PublicKey;
  /** Native SOL travels through the vault's wrapped SOL account. */
  wrapInput: boolean;
  unwrapOutput: boolean;
}

function store(route: SwapRoute): StoredRoute {
  return {
    programId: route.instruction.programId.toBase58(),
    data: Buffer.from(route.instruction.data).toString('base64'),
    keys: route.instruction.keys.map((key) => ({
      pubkey: key.pubkey.toBase58(),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    lookupTables: route.lookupTables,
  };
}

function restore(stored: StoredRoute): SwapRoute {
  return {
    instruction: new TransactionInstruction({
      programId: new PublicKey(stored.programId),
      data: Buffer.from(stored.data, 'base64'),
      keys: stored.keys.map((key) => ({
        ...key,
        pubkey: new PublicKey(key.pubkey),
      })),
    }),
    lookupTables: stored.lookupTables,
  };
}

function quoteKey(quoteId: string): string {
  return `swap-quote:${quoteId}`;
}

function preparedKey(messageBase64: string): string {
  return `swap:${createHash('sha256').update(messageBase64).digest('hex')}`;
}
