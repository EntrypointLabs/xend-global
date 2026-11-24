import type { ConfigService } from '@nestjs/config';
import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  ABOVE_LIMIT_PROGRAM_ALLOWLIST,
  associatedTokenAddress,
  deriveAccountAddresses,
  describeTransaction,
  JUPITER_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WRAPPED_SOL_MINT,
} from '@prydd/smart-account';

import type { SquadsAccountStore } from '../account/account.interface';
import type { PreparedTxStore } from '../prepared/prepared-tx.interface';
import type { SettlementAuthoritySigner } from '../settlement/settlement-authority.interface';
import {
  AccountNeedsUpdateError,
  NoSwapRouteError,
  SwapMismatchError,
  SwapPriceMovedError,
  SwapQuoteExpiredError,
  SwapUnavailableError,
} from './swap.errors';
import type {
  SwapChain,
  SwapPrice,
  SwapProvider,
  SwapRecord,
} from './swap.interface';
import { SwapService } from './swap.service';

const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const BLOCKHASH = 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k';
const SETTINGS_SEED = 11n;
const addresses = deriveAccountAddresses(SETTINGS_SEED);
const key = () => Keypair.generate().publicKey;

const primary = Keypair.generate();
const approval = Keypair.generate();
const feePayer = Keypair.generate();

/** A `shared_accounts_route` shaped the way Jupiter's API returns one. */
function jupiterRoute(
  sourceMint: PublicKey,
  destinationMint: PublicKey,
  amountIn: bigint,
  quotedOut: bigint,
  venueAccounts: PublicKey[] = [key()],
): TransactionInstruction {
  const tail = Buffer.alloc(19);
  tail.writeBigUInt64LE(amountIn, 0);
  tail.writeBigUInt64LE(quotedOut, 8);
  tail.writeUInt16LE(50, 16);
  const ata = (mint: PublicKey) =>
    associatedTokenAddress(addresses.vault, mint, TOKEN_PROGRAM_ID);
  const fixed: [PublicKey, boolean, boolean][] = [
    [TOKEN_PROGRAM_ID, false, false],
    [key(), false, false],
    [addresses.vault, true, false],
    [ata(sourceMint), false, true],
    [key(), false, true],
    [key(), false, true],
    [ata(destinationMint), false, true],
    [sourceMint, false, false],
    [destinationMint, false, false],
    [JUPITER_PROGRAM_ID, false, false],
    [JUPITER_PROGRAM_ID, false, false],
    [key(), false, false],
    [JUPITER_PROGRAM_ID, false, false],
    ...venueAccounts.map((account): [PublicKey, boolean, boolean] => [
      account,
      false,
      true,
    ]),
  ];
  return new TransactionInstruction({
    programId: JUPITER_PROGRAM_ID,
    data: Buffer.concat([
      Buffer.from('c1209b3341d69c81', 'hex'),
      Buffer.from([3, 1, 0, 0, 0, 7, 100, 0, 1]),
      tail,
    ]),
    keys: fixed.map(([pubkey, isSigner, isWritable]) => ({
      pubkey,
      isSigner,
      isWritable,
    })),
  });
}

function setUp({
  env = {},
  allowed = [...ABOVE_LIMIT_PROGRAM_ALLOWLIST],
  existing = [] as PublicKey[],
  unsignable = 'none' as 'none' | 'multi-hop' | 'every' | 'whirlpool',
  runs = [] as ('price-moved' | 'fails')[],
}: {
  env?: Record<string, unknown>;
  allowed?: PublicKey[];
  existing?: PublicKey[];
  /** Which routes name the vault among a venue's accounts. */
  unsignable?: 'none' | 'multi-hop' | 'every' | 'whirlpool';
  /** How each run of a swap against the chain ends, in order; then they pass. */
  runs?: ('price-moved' | 'fails')[];
} = {}) {
  const values: Record<string, unknown> = {
    SOLANA_CLUSTER: 'mainnet',
    SWAP_KILLSWITCH: false,
    ...env,
  };
  const config = { get: (name: string) => values[name] } as ConfigService;

  const kept = new Map<string, unknown>();
  const prepared: PreparedTxStore = {
    set: (k, v) => Promise.resolve(void kept.set(k, v)),
    get: <T>(k: string) => Promise.resolve((kept.get(k) as T) ?? null),
    delete: (k) => Promise.resolve(void kept.delete(k)),
  };

  const store = {
    findByUserId: (userId: string) =>
      Promise.resolve(
        userId === 'consumer'
          ? {
              userId,
              settingsSeed: SETTINGS_SEED,
              settingsAddress: addresses.settings.toBase58(),
              vaultAddress: addresses.vault.toBase58(),
              primarySigner: primary.publicKey.toBase58(),
              approvalSigner: approval.publicKey.toBase58(),
              approvalSubOrgId: 'sub-org',
            }
          : null,
      ),
  } as unknown as SquadsAccountStore;

  const provider: SwapProvider = {
    name: 'fake',
    quote: (params) => {
      const venue = params.directOnly
        ? 'Direct'
        : params.excludeVenues?.includes('Whirlpool')
          ? 'Raydium'
          : 'Whirlpool';
      return Promise.resolve<SwapPrice>({
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amountInRaw: params.amountInRaw,
        amountOutRaw: '1440000000',
        slippageBps: params.slippageBps,
        venue,
        venues: [venue],
        providerQuote: { directOnly: params.directOnly === true },
      });
    },
    route: (price) =>
      Promise.resolve({
        instruction: jupiterRoute(
          new PublicKey(price.inputMint),
          new PublicKey(price.outputMint),
          BigInt(price.amountInRaw),
          BigInt(price.amountOutRaw),
          unsignable === 'every' ||
            (unsignable === 'whirlpool' && price.venue === 'Whirlpool') ||
            (unsignable === 'multi-hop' &&
              !(price.providerQuote as { directOnly: boolean }).directOnly)
            ? [addresses.vault]
            : undefined,
        ),
        lookupTables: [],
      }),
  };

  const chain: SwapChain = {
    feePayer: feePayer.publicKey.toBase58(),
    tokenProgramFor: () => Promise.resolve(TOKEN_PROGRAM_ID),
    decimalsFor: (mint) =>
      Promise.resolve(mint.equals(WRAPPED_SOL_MINT) ? 9 : 6),
    exists: (asked) =>
      Promise.resolve(asked.map((a) => existing.some((e) => e.equals(a)))),
    allowedPrograms: () => Promise.resolve(allowed),
    lookupTables: () => Promise.resolve([]),
    draft: ({ instructions }) =>
      Buffer.from(
        new VersionedTransaction(
          new TransactionMessage({
            payerKey: feePayer.publicKey,
            recentBlockhash: BLOCKHASH,
            instructions,
          }).compileToV0Message(),
        ).serialize(),
      ).toString('base64'),
    compile: ({ instructions }) => {
      const outcome = runs.shift();
      if (outcome === 'price-moved') {
        return Promise.reject(new SwapPriceMovedError('moved'));
      }
      if (outcome === 'fails') {
        return Promise.reject(new NoSwapRouteError('would not run'));
      }
      const message = new TransactionMessage({
        payerKey: feePayer.publicKey,
        recentBlockhash: BLOCKHASH,
        instructions,
      }).compileToV0Message();
      return Promise.resolve({
        unsignedTxBase64: Buffer.from(
          new VersionedTransaction(message).serialize(),
        ).toString('base64'),
        messageBase64: Buffer.from(message.serialize()).toString('base64'),
        blockhash: BLOCKHASH,
        lastValidBlockHeight: 1,
      });
    },
  };

  const sent: string[] = [];
  const authority: SettlementAuthoritySigner = {
    address: feePayer.publicKey.toBase58(),
    signAndSend: (wire) => {
      sent.push(wire);
      return Promise.resolve('signature');
    },
  };

  const recorded: SwapRecord[] = [];
  return {
    service: new SwapService(
      config,
      store,
      provider,
      chain,
      authority,
      prepared,
      {
        record: (swap) => {
          recorded.push(swap);
          return Promise.resolve();
        },
      },
    ),
    kept,
    sent,
    recorded,
  };
}

const usdcToSol = {
  inputMint: USDC.toBase58(),
  outputMint: WRAPPED_SOL_MINT.toBase58(),
  amountRaw: '100000000',
};

function sign(unsignedTxBase64: string, signers: Keypair[]): string {
  const tx = VersionedTransaction.deserialize(
    Buffer.from(unsignedTxBase64, 'base64'),
  );
  tx.sign(signers);
  return Buffer.from(tx.serialize()).toString('base64');
}

describe('SwapService', () => {
  it('quotes the least a swap can settle at, not only the price', async () => {
    const { service } = setUp();
    const quote = await service.quote('consumer', usdcToSol);
    expect(quote).toMatchObject({
      amountInRaw: '100000000',
      amountOutRaw: '1440000000',
      minAmountOutRaw: '1432800000',
      slippageBps: 50,
      venue: 'Whirlpool',
    });
  });

  it.each([
    ['the kill switch is set', { SWAP_KILLSWITCH: true }],
    ['the backend is on devnet', { SOLANA_CLUSTER: 'devnet' }],
  ])('is unavailable while %s', async (_, env) => {
    const { service } = setUp({ env });
    await expect(service.quote('consumer', usdcToSol)).rejects.toBeInstanceOf(
      SwapUnavailableError,
    );
  });

  it('quotes a single-venue route when the best one could not be signed', async () => {
    const { service } = setUp({ unsignable: 'multi-hop' });
    await expect(service.quote('consumer', usdcToSol)).resolves.toMatchObject({
      venue: 'Direct',
    });
  });

  it("routes around a venue that wants the vault's signature", async () => {
    const { service } = setUp({ unsignable: 'whirlpool' });
    await expect(service.quote('consumer', usdcToSol)).resolves.toMatchObject({
      venue: 'Raydium',
    });
  });

  it('routes around a venue that has already moved off its price', async () => {
    const { service } = setUp({ runs: ['price-moved'] });
    await expect(service.quote('consumer', usdcToSol)).resolves.toMatchObject({
      venue: 'Raydium',
    });
  });

  it('still prices a swap that would not run, such as one past the balance', async () => {
    const { service } = setUp({ runs: ['fails'] });
    await expect(service.quote('consumer', usdcToSol)).resolves.toMatchObject({
      venue: 'Whirlpool',
    });
  });

  it('says the price moved when it moves between the quote and the swap', async () => {
    const { service } = setUp({ runs: [undefined as never, 'price-moved'] });
    const { quoteId } = await service.quote('consumer', usdcToSol);
    await expect(service.prepare('consumer', quoteId)).rejects.toBeInstanceOf(
      SwapPriceMovedError,
    );
  });

  it('quotes nothing when no route could be signed', async () => {
    const { service } = setUp({ unsignable: 'every' });
    await expect(service.quote('consumer', usdcToSol)).rejects.toBeInstanceOf(
      NoSwapRouteError,
    );
  });

  it('prepares the swap the device will recognise as the one quoted', async () => {
    const { service } = setUp({
      existing: [
        associatedTokenAddress(addresses.vault, USDC, TOKEN_PROGRAM_ID),
      ],
    });
    const quote = await service.quote('consumer', usdcToSol);
    const prepared = await service.prepare('consumer', quote.quoteId);

    const described = describeTransaction(prepared.unsignedTxBase64, {
      addresses,
    });
    expect(described).toMatchObject({
      kind: 'swap',
      outputMint: 'SOL',
      amountIn: 100_000_000n,
      quotedAmountOut: 1_440_000_000n,
      slippageBps: 50,
      // The fee payer opened the wrapped SOL account the swap then closes.
      refundsRent: true,
    });
    if (described.kind !== 'swap') throw new Error('unreachable');
    expect(described.inputMint.toString()).toBe(USDC.toBase58());
    expect(described.signers.map(String)).toEqual([
      primary.publicKey.toBase58(),
      approval.publicKey.toBase58(),
    ]);
  });

  it('takes no rent back when the wrapped SOL account was already there', async () => {
    const { service } = setUp({
      existing: [
        associatedTokenAddress(addresses.vault, USDC, TOKEN_PROGRAM_ID),
        associatedTokenAddress(
          addresses.vault,
          WRAPPED_SOL_MINT,
          TOKEN_PROGRAM_ID,
        ),
      ],
    });
    const quote = await service.quote('consumer', usdcToSol);
    const prepared = await service.prepare('consumer', quote.quoteId);
    expect(
      describeTransaction(prepared.unsignedTxBase64, { addresses }),
    ).toMatchObject({ kind: 'swap', refundsRent: false });
  });

  it('wraps SOL when SOL is what is paid', async () => {
    const { service } = setUp();
    const quote = await service.quote('consumer', {
      inputMint: WRAPPED_SOL_MINT.toBase58(),
      outputMint: USDC.toBase58(),
      amountRaw: '1000000000',
    });
    const prepared = await service.prepare('consumer', quote.quoteId);
    expect(
      describeTransaction(prepared.unsignedTxBase64, { addresses }),
    ).toMatchObject({
      kind: 'swap',
      inputMint: 'SOL',
      amountIn: 1_000_000_000n,
      refundsRent: true,
    });
  });

  it("will not prepare another Consumer's quote", async () => {
    const { service } = setUp();
    const quote = await service.quote('consumer', usdcToSol);
    await expect(
      service.prepare('someone-else', quote.quoteId),
    ).rejects.toBeInstanceOf(SwapQuoteExpiredError);
  });

  it('will not prepare a price that has expired', async () => {
    const { service, kept } = setUp();
    const quote = await service.quote('consumer', usdcToSol);
    const stored = kept.get(`swap-quote:${quote.quoteId}`) as {
      expiresAt: number;
    };
    stored.expiresAt = Math.floor(Date.now() / 1000) - 1;
    await expect(
      service.prepare('consumer', quote.quoteId),
    ).rejects.toBeInstanceOf(SwapQuoteExpiredError);
  });

  describe('an Account provisioned before Swap', () => {
    const BEFORE_SWAP = ABOVE_LIMIT_PROGRAM_ALLOWLIST.filter(
      (program) => !program.equals(JUPITER_PROGRAM_ID),
    );

    async function preparedSwap(request = usdcToSol) {
      const context = setUp({ allowed: BEFORE_SWAP });
      const quote = await context.service.quote('consumer', request);
      const prepared = await context.service.prepare('consumer', quote.quoteId);
      return { ...context, quote, prepared };
    }

    const programsCalled = (unsignedTxBase64: string) => {
      const { message } = VersionedTransaction.deserialize(
        Buffer.from(unsignedTxBase64, 'base64'),
      );
      return message.compiledInstructions.map((ix) =>
        message.staticAccountKeys[ix.programIdIndex].toBase58(),
      );
    };

    it('swaps without a settings change, on an allowance from the vault', async () => {
      const { prepared, quote } = await preparedSwap();

      // What the device will be shown is the swap that was quoted.
      const described = describeTransaction(prepared.unsignedTxBase64, {
        addresses,
      });
      expect(described).toMatchObject({
        kind: 'swap',
        outputMint: 'SOL',
        amountIn: BigInt(quote.amountInRaw),
        quotedAmountOut: BigInt(quote.amountOutRaw),
        slippageBps: quote.slippageBps,
      });
    });

    it('calls the swap program beside the vault, not from inside it', async () => {
      const { prepared } = await preparedSwap();

      // The policy does not admit the swap program, so the vault cannot be
      // the one calling it.
      expect(programsCalled(prepared.unsignedTxBase64)).toContain(
        JUPITER_PROGRAM_ID.toBase58(),
      );
    });

    it('still asks for both of the Account’s signatures', async () => {
      const { prepared } = await preparedSwap();
      const { message } = VersionedTransaction.deserialize(
        Buffer.from(prepared.unsignedTxBase64, 'base64'),
      );
      const required = message.staticAccountKeys
        .slice(0, message.header.numRequiredSignatures)
        .map(String);

      expect(required).toEqual(
        expect.arrayContaining([
          primary.publicKey.toBase58(),
          approval.publicKey.toBase58(),
        ]),
      );
    });

    it('swaps SOL the same way', async () => {
      const { prepared } = await preparedSwap({
        inputMint: WRAPPED_SOL_MINT.toBase58(),
        outputMint: USDC.toBase58(),
        amountRaw: '1000000000',
      });

      expect(
        describeTransaction(prepared.unsignedTxBase64, { addresses }),
      ).toMatchObject({ kind: 'swap', inputMint: 'SOL' });
    });

    it('refuses an Account whose policy was not written by provisioning', async () => {
      const { service } = setUp({ allowed: [] });

      await expect(service.quote('consumer', usdcToSol)).rejects.toBeInstanceOf(
        AccountNeedsUpdateError,
      );
    });
  });

  it('keeps calling the swap program from the vault where the policy admits it', async () => {
    const { service } = setUp();
    const quote = await service.quote('consumer', usdcToSol);
    const { unsignedTxBase64 } = await service.prepare(
      'consumer',
      quote.quoteId,
    );
    const { message } = VersionedTransaction.deserialize(
      Buffer.from(unsignedTxBase64, 'base64'),
    );
    const called = message.compiledInstructions.map((ix) =>
      message.staticAccountKeys[ix.programIdIndex].toBase58(),
    );

    expect(called).not.toContain(JUPITER_PROGRAM_ID.toBase58());
  });

  describe('submit', () => {
    async function prepared() {
      const context = setUp();
      const quote = await context.service.quote('consumer', usdcToSol);
      const { unsignedTxBase64 } = await context.service.prepare(
        'consumer',
        quote.quoteId,
      );
      return { ...context, unsignedTxBase64 };
    }

    it('broadcasts a swap both of the Account signers have signed', async () => {
      const { service, sent, recorded, unsignedTxBase64 } = await prepared();
      const signed = sign(unsignedTxBase64, [primary, approval]);
      await expect(service.submit('consumer', signed)).resolves.toEqual({
        signature: 'signature',
      });
      expect(sent).toEqual([signed]);
      expect(recorded).toEqual([
        {
          userId: 'consumer',
          signature: 'signature',
          inputMint: USDC.toBase58(),
          outputMint: WRAPPED_SOL_MINT.toBase58(),
          amountInRaw: '100000000',
          amountOutRaw: '1440000000',
          venues: ['Whirlpool'],
          inputDecimals: 6,
          outputDecimals: 9,
        },
      ]);
      // A second submit of the same bytes finds nothing prepared.
      await expect(service.submit('consumer', signed)).rejects.toBeInstanceOf(
        SwapMismatchError,
      );
    });

    it('refuses a swap one signature short', async () => {
      const { service, sent, unsignedTxBase64 } = await prepared();
      await expect(
        service.submit('consumer', sign(unsignedTxBase64, [primary])),
      ).rejects.toBeInstanceOf(SwapMismatchError);
      expect(sent).toEqual([]);
    });

    it('refuses a swap prepared for another Consumer', async () => {
      const { service, unsignedTxBase64 } = await prepared();
      await expect(
        service.submit(
          'someone-else',
          sign(unsignedTxBase64, [primary, approval]),
        ),
      ).rejects.toBeInstanceOf(SwapMismatchError);
    });

    it('refuses a transaction it did not build', async () => {
      const { service, sent } = await prepared();
      const message = new TransactionMessage({
        payerKey: feePayer.publicKey,
        recentBlockhash: BLOCKHASH,
        instructions: [],
      }).compileToV0Message();
      await expect(
        service.submit(
          'consumer',
          Buffer.from(new VersionedTransaction(message).serialize()).toString(
            'base64',
          ),
        ),
      ).rejects.toBeInstanceOf(SwapMismatchError);
      expect(sent).toEqual([]);
    });
  });
});
