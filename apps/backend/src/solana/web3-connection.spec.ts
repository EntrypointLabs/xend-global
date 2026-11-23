import {
  Connection,
  Keypair,
  PublicKey,
  type ParsedTransactionWithMeta,
} from '@solana/web3.js';

import {
  extractTokenTransfers,
  sendRawTransactionViaConnection,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WRAPPED_SOL_MINT,
} from './web3-connection';

describe('sendRawTransactionViaConnection', () => {
  it('leaves rebroadcasting to the RPC node', async () => {
    const send = jest.fn(() => Promise.resolve('signature'));
    const conn = { sendRawTransaction: send } as unknown as Connection;

    const signature = await sendRawTransactionViaConnection(
      conn,
      Buffer.from('signed').toString('base64'),
    );

    expect(signature).toBe('signature');
    const [, options] = send.mock.calls[0] as unknown as [
      Buffer,
      { maxRetries?: number },
    ];
    expect(options).not.toHaveProperty('maxRetries');
  });
});

describe('extractTokenTransfers', () => {
  const address = () => Keypair.generate().publicKey.toBase58();
  const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const USDG = '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH';
  const ATA_PROGRAM = new PublicKey(
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  );
  const vault = address();
  const venue = address();
  const feePayer = address();
  const vaultUsdc = address();
  const venueUsdc = address();
  const venueWrappedSol = address();
  const vaultWrappedSol = address();
  const RENT = 2_039_280;

  const parsed = (programId: PublicKey, type: string, info: object) => ({
    programId,
    program: 'test',
    parsed: { type, info },
  });
  const balance = (account: string, owner: string, mint: string) => ({
    accountIndex: accounts.indexOf(account),
    owner,
    mint,
    uiTokenAmount: {
      decimals: mint === USDC ? 6 : 9,
      amount: '0',
      uiAmount: 0,
    },
  });
  const accounts = [vaultUsdc, venueUsdc, venueWrappedSol, vaultWrappedSol];

  /** `instructions` as a confirmed transaction that only USDC accounts outlive. */
  const transaction = (instructions: object[]) =>
    ({
      slot: 10,
      blockTime: 1_800_000_000,
      transaction: {
        signatures: ['signature'],
        message: {
          accountKeys: accounts.map((account) => ({
            pubkey: new PublicKey(account),
          })),
          instructions,
        },
      },
      meta: {
        err: null,
        innerInstructions: [],
        preTokenBalances: [
          balance(vaultUsdc, vault, USDC),
          balance(venueUsdc, venue, USDC),
          balance(venueWrappedSol, venue, WRAPPED_SOL_MINT),
        ],
        postTokenBalances: [],
      },
    }) as unknown as ParsedTransactionWithMeta;

  it('sees SOL received through a wrapped account the swap opens and closes', () => {
    const events = extractTokenTransfers(
      transaction([
        parsed(ATA_PROGRAM, 'createIdempotent', {
          account: vaultWrappedSol,
          wallet: vault,
          mint: WRAPPED_SOL_MINT,
          source: feePayer,
        }),
        parsed(SYSTEM_PROGRAM_ID, 'createAccount', {
          source: feePayer,
          newAccount: vaultWrappedSol,
          lamports: RENT,
        }),
        parsed(TOKEN_PROGRAM_ID, 'transfer', {
          source: vaultUsdc,
          destination: venueUsdc,
          authority: vault,
          amount: '5000000',
        }),
        parsed(TOKEN_PROGRAM_ID, 'transfer', {
          source: venueWrappedSol,
          destination: vaultWrappedSol,
          authority: venue,
          amount: '72000000',
        }),
        parsed(TOKEN_PROGRAM_ID, 'closeAccount', {
          account: vaultWrappedSol,
          destination: vault,
          owner: vault,
        }),
        parsed(SYSTEM_PROGRAM_ID, 'transfer', {
          source: vault,
          destination: feePayer,
          lamports: RENT,
        }),
      ]),
      vault,
    );

    expect(
      events.map((e) => [e.mint, e.fromAddress, e.toAddress, e.amountRaw]),
    ).toEqual([
      [USDC, vault, venue, 5_000_000n],
      [WRAPPED_SOL_MINT, venue, vault, 72_000_000n],
    ]);
    expect(events[1].decimals).toBe(9);
  });

  it('sees both sides of a swap into a token on the newer token program', () => {
    const events = extractTokenTransfers(
      transaction([
        parsed(TOKEN_PROGRAM_ID, 'transfer', {
          source: vaultUsdc,
          destination: venueUsdc,
          authority: vault,
          amount: '5000000',
        }),
        parsed(TOKEN_2022_PROGRAM_ID, 'transferChecked', {
          source: venueWrappedSol,
          destination: vaultWrappedSol,
          authority: venue,
          mint: USDG,
          tokenAmount: { amount: '4999000', decimals: 6 },
        }),
        parsed(ATA_PROGRAM, 'createIdempotent', {
          account: vaultWrappedSol,
          wallet: vault,
          mint: USDG,
          source: feePayer,
        }),
      ]),
      vault,
    );

    expect(
      events.map((e) => [e.mint, e.fromAddress, e.toAddress, e.amountRaw]),
    ).toEqual([
      [USDC, vault, venue, 5_000_000n],
      [USDG, venue, vault, 4_999_000n],
    ]);
  });

  it('still records SOL the owner sends to whoever fronted no rent', () => {
    const events = extractTokenTransfers(
      transaction([
        parsed(SYSTEM_PROGRAM_ID, 'transfer', {
          source: vault,
          destination: feePayer,
          lamports: RENT,
        }),
      ]),
      vault,
    );
    expect(
      events.map((e) => [e.fromAddress, e.toAddress, e.amountRaw]),
    ).toEqual([[vault, feePayer, BigInt(RENT)]]);
  });

  it('counts SOL paid into a swap once, not again as it is wrapped', () => {
    const events = extractTokenTransfers(
      transaction([
        parsed(ATA_PROGRAM, 'createIdempotent', {
          account: vaultWrappedSol,
          wallet: vault,
          mint: WRAPPED_SOL_MINT,
          source: feePayer,
        }),
        parsed(SYSTEM_PROGRAM_ID, 'transfer', {
          source: vault,
          destination: vaultWrappedSol,
          lamports: 50_000_000,
        }),
        parsed(TOKEN_PROGRAM_ID, 'transfer', {
          source: vaultWrappedSol,
          destination: venueWrappedSol,
          authority: vault,
          amount: '50000000',
        }),
        parsed(TOKEN_PROGRAM_ID, 'transfer', {
          source: venueUsdc,
          destination: vaultUsdc,
          authority: venue,
          amount: '3470000',
        }),
      ]),
      vault,
    );

    expect(
      events.map((e) => [e.mint, e.fromAddress, e.toAddress, e.amountRaw]),
    ).toEqual([
      [WRAPPED_SOL_MINT, vault, venue, 50_000_000n],
      [USDC, venue, vault, 3_470_000n],
    ]);
  });
});
