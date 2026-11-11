import { ConfigService } from '@nestjs/config';
import {
  ComputeBudgetInstruction,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';

import { withPriorityFee } from './priority-fee';

const FLOOR = 50_000;
const CEILING = 1_000_000;

const config = {
  getOrThrow: (key: string) =>
    key === 'SOLANA_MIN_COMPUTE_UNIT_PRICE' ? FLOOR : CEILING,
} as unknown as ConfigService;

const payer = Keypair.generate().publicKey;
const key = () => Keypair.generate().publicKey;

function instruction(
  ...keys: { pubkey: PublicKey; isWritable: boolean }[]
): TransactionInstruction {
  return new TransactionInstruction({
    programId: key(),
    keys: keys.map((k) => ({ ...k, isSigner: false })),
  });
}

function rpcReturning(fees: number[]): {
  rpc: Connection;
  read: jest.Mock;
} {
  const read = jest.fn(() =>
    Promise.resolve(
      fees.map((prioritizationFee, slot) => ({ slot, prioritizationFee })),
    ),
  );
  return {
    rpc: { getRecentPrioritizationFees: read } as unknown as Connection,
    read,
  };
}

async function priceFor(rpc: Connection): Promise<number> {
  const [priced] = await withPriorityFee(rpc, config, payer, [instruction()]);
  return Number(
    ComputeBudgetInstruction.decodeSetComputeUnitPrice(priced).microLamports,
  );
}

describe('withPriorityFee', () => {
  it('prepends the price and leaves the instructions in order', async () => {
    const original = [instruction(), instruction()];

    const priced = await withPriorityFee(
      rpcReturning([]).rpc,
      config,
      payer,
      original,
    );

    expect(priced).toHaveLength(3);
    expect(ComputeBudgetInstruction.decodeInstructionType(priced[0])).toBe(
      'SetComputeUnitPrice',
    );
    expect(priced.slice(1)).toEqual(original);
  });

  it('bids the upper quartile of recent fees, not the highest', async () => {
    const fees = [60_000, 70_000, 80_000, 90_000, 900_000];

    expect(await priceFor(rpcReturning(fees).rpc)).toBe(90_000);
  });

  it('reads the same market in any order', async () => {
    const fees = [900_000, 60_000, 90_000, 70_000, 80_000];

    expect(await priceFor(rpcReturning(fees).rpc)).toBe(90_000);
  });

  it('holds the floor on an idle cluster', async () => {
    expect(await priceFor(rpcReturning([0, 0, 0, 0]).rpc)).toBe(FLOOR);
  });

  it('holds the floor when the cluster reports nothing', async () => {
    expect(await priceFor(rpcReturning([]).rpc)).toBe(FLOOR);
  });

  it('never pays past the ceiling in a spike', async () => {
    const fees = [5_000_000, 5_000_000, 5_000_000, 5_000_000];

    expect(await priceFor(rpcReturning(fees).rpc)).toBe(CEILING);
  });

  it('prices at the floor rather than failing when the read fails', async () => {
    const rpc = {
      getRecentPrioritizationFees: () => Promise.reject(new Error('429')),
    } as unknown as Connection;

    expect(await priceFor(rpc)).toBe(FLOOR);
  });

  it('asks about the payer and the writable accounts only', async () => {
    const written = key();
    const read = key();
    const { rpc, read: getFees } = rpcReturning([]);

    await withPriorityFee(rpc, config, payer, [
      instruction({ pubkey: written, isWritable: true }),
      instruction(
        { pubkey: written, isWritable: true },
        { pubkey: read, isWritable: false },
      ),
    ]);

    const [{ lockedWritableAccounts }] = getFees.mock.calls[0] as unknown as [
      { lockedWritableAccounts: PublicKey[] },
    ];
    expect(lockedWritableAccounts.map((k) => k.toBase58())).toEqual([
      payer.toBase58(),
      written.toBase58(),
    ]);
  });

  it('stays within what the RPC accepts on a very wide transaction', async () => {
    const { rpc, read } = rpcReturning([]);
    const wide = Array.from({ length: 200 }, () => ({
      pubkey: key(),
      isWritable: true,
    }));

    await withPriorityFee(rpc, config, payer, [instruction(...wide)]);

    const [{ lockedWritableAccounts }] = read.mock.calls[0] as unknown as [
      { lockedWritableAccounts: PublicKey[] },
    ];
    expect(lockedWritableAccounts).toHaveLength(128);
  });
});
