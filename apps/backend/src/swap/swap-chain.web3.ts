import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { decodeAllowedPrograms } from '@prydd/smart-account';

import {
  SETTLEMENT_AUTHORITY_SIGNER,
  type SettlementAuthoritySigner,
} from '../settlement/settlement-authority.interface';
import { withPriorityFee } from '../solana/priority-fee';
import { NoSwapRouteError } from './swap.errors';
import type { CompiledSwap, SwapChain } from './swap.interface';

const MAX_TRANSACTION_BYTES = 1232;
const MAX_COMPUTE_UNITS = 1_400_000;

/**
 * Room above what the simulation used. Pool state moves between the
 * simulation and the swap landing, and a different tick or bin costs a
 * different amount of compute.
 */
const COMPUTE_HEADROOM = 1.3;

/** Chain reads and transaction assembly for swaps, on web3.js per ADR 0020. */
@Injectable()
export class Web3SwapChain implements SwapChain, OnModuleInit {
  private readonly logger = new Logger(Web3SwapChain.name);
  private rpc!: Connection;
  /** A mint's owner never changes, and every quote asks for two of them. */
  private readonly tokenPrograms = new Map<string, PublicKey>();

  get feePayer(): string {
    return this.authority.address;
  }

  constructor(
    private readonly config: ConfigService,
    @Inject(SETTLEMENT_AUTHORITY_SIGNER)
    private readonly authority: SettlementAuthoritySigner,
  ) {}

  onModuleInit(): void {
    this.rpc = new Connection(
      this.config.getOrThrow<string>('HELIUS_RPC_URL'),
      'confirmed',
    );
  }

  async tokenProgramFor(mint: PublicKey): Promise<PublicKey> {
    const known = this.tokenPrograms.get(mint.toBase58());
    if (known) return known;
    const info = await this.rpc.getAccountInfo(mint, 'confirmed');
    if (!info) {
      throw new NoSwapRouteError(`Mint ${mint.toBase58()} does not exist`);
    }
    this.tokenPrograms.set(mint.toBase58(), info.owner);
    return info.owner;
  }

  async exists(addresses: PublicKey[]): Promise<boolean[]> {
    const infos = await this.rpc.getMultipleAccountsInfo(
      addresses,
      'confirmed',
    );
    return infos.map((info) => info !== null);
  }

  async allowedPrograms(policy: PublicKey): Promise<PublicKey[]> {
    const info = await this.rpc.getAccountInfo(policy, 'confirmed');
    return info ? decodeAllowedPrograms(policy, info) : [];
  }

  async lookupTables(
    addresses: string[],
  ): Promise<AddressLookupTableAccount[]> {
    const tables = await Promise.all(
      addresses.map((address) =>
        this.rpc.getAddressLookupTable(new PublicKey(address)),
      ),
    );
    return tables.map((table, i) => {
      // A missing table drops the accounts it carried, and the swap would fail
      // on chain with an error that says nothing about why.
      if (!table.value) {
        throw new NoSwapRouteError(`Lookup table ${addresses[i]} is gone`);
      }
      return table.value;
    });
  }

  draft(params: {
    instructions: TransactionInstruction[];
    lookupTables: AddressLookupTableAccount[];
  }): string {
    return wire(
      this.build({
        ...params,
        instructions: [
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
          ...params.instructions,
        ],
        blockhash: PublicKey.default.toBase58(),
        units: MAX_COMPUTE_UNITS,
      }),
    );
  }

  async compile(params: {
    instructions: TransactionInstruction[];
    lookupTables: AddressLookupTableAccount[];
  }): Promise<CompiledSwap> {
    const priced = await withPriorityFee(
      this.rpc,
      this.config,
      new PublicKey(this.feePayer),
      params.instructions,
    );
    const { blockhash, lastValidBlockHeight } =
      await this.rpc.getLatestBlockhash('confirmed');
    const build = (units: number) =>
      this.build({
        instructions: priced,
        lookupTables: params.lookupTables,
        blockhash,
        units,
      });

    const simulated = await this.rpc.simulateTransaction(
      build(MAX_COMPUTE_UNITS),
      { sigVerify: false, commitment: 'confirmed' },
    );
    if (simulated.value.err) {
      this.logger.warn(
        `swap.simulation_failed err=${JSON.stringify(simulated.value.err)}` +
          ` logs=${JSON.stringify(simulated.value.logs?.slice(-6) ?? [])}`,
      );
      throw new NoSwapRouteError('The swap would not go through right now');
    }

    const used = simulated.value.unitsConsumed ?? MAX_COMPUTE_UNITS;
    const transaction = build(
      Math.min(Math.ceil(used * COMPUTE_HEADROOM), MAX_COMPUTE_UNITS),
    );
    return {
      unsignedTxBase64: wire(transaction),
      messageBase64: Buffer.from(transaction.message.serialize()).toString(
        'base64',
      ),
      blockhash,
      lastValidBlockHeight,
    };
  }

  /**
   * A swap outruns the default compute budget, which counts 200k units per
   * instruction and has only the one wrapping instruction to count, so every
   * swap states its own.
   */
  private build(params: {
    instructions: TransactionInstruction[];
    lookupTables: AddressLookupTableAccount[];
    blockhash: string;
    units: number;
  }): VersionedTransaction {
    return new VersionedTransaction(
      new TransactionMessage({
        payerKey: new PublicKey(this.feePayer),
        recentBlockhash: params.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: params.units }),
          ...params.instructions,
        ],
      }).compileToV0Message(params.lookupTables),
    );
  }
}

/**
 * The bytes already reserve room for every signature, so this is the size
 * that will be broadcast.
 */
function wire(transaction: VersionedTransaction): string {
  let bytes: Uint8Array;
  try {
    bytes = transaction.serialize();
  } catch {
    throw new NoSwapRouteError('The route is too large to send');
  }
  if (bytes.length > MAX_TRANSACTION_BYTES) {
    throw new NoSwapRouteError('The route is too large to send');
  }
  return Buffer.from(bytes).toString('base64');
}
