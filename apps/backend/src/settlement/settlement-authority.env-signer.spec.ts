import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Keypair } from '@solana/web3.js';
import {
  address,
  appendTransactionMessageInstructions,
  type Blockhash,
  compileTransaction,
  createTransactionMessage,
  getBase58Decoder,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { getSetComputeUnitLimitInstruction } from '@solana-program/compute-budget';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import { SettlementAuthorityEnvSigner } from './settlement-authority.env-signer';

function makeConfig(secretBase58: string): ConfigService {
  return {
    getOrThrow: (key: string): string => {
      if (key === 'SETTLEMENT_AUTHORITY_SECRET_KEY') return secretBase58;
      throw new Error(`missing config ${key}`);
    },
  } as unknown as ConfigService;
}

function makeSolana(sendRawTransaction: jest.Mock): SolanaRpc {
  return { sendRawTransaction } as unknown as SolanaRpc;
}

/** Build an unsigned wire tx whose fee payer is `feePayer` so the authority
 *  is the sole required signer. A pubkey string doubles as a valid 32-byte
 *  base58 blockhash for compilation. */
function unsignedWireTx(feePayer: string): string {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(feePayer), m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: feePayer as Blockhash,
          lastValidBlockHeight: 1_000n,
        },
        m,
      ),
    (m) =>
      appendTransactionMessageInstructions(
        [getSetComputeUnitLimitInstruction({ units: 60_000 })],
        m,
      ),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}

describe('SettlementAuthorityEnvSigner', () => {
  const keypair = Keypair.generate();
  const secretBase58 = getBase58Decoder().decode(keypair.secretKey);
  const expectedAddress = keypair.publicKey.toBase58();

  it('derives the authority address from the base58 secret and logs the pubkey only', async () => {
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const signer = new SettlementAuthorityEnvSigner(
      makeConfig(secretBase58),
      makeSolana(jest.fn()),
    );
    await signer.onModuleInit();

    expect(signer.address).toBe(expectedAddress);
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain(`address=${expectedAddress}`);
    // The secret key must never appear in any log line.
    expect(logged).not.toContain(secretBase58);
    logSpy.mockRestore();
  });

  it('signAndSend partial-signs as the authority and broadcasts via SOLANA_RPC', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    let broadcastBase64 = '';
    const sendRawTransaction = jest.fn((tx: string): Promise<string> => {
      broadcastBase64 = tx;
      return Promise.resolve('broadcast-sig');
    });
    const signer = new SettlementAuthorityEnvSigner(
      makeConfig(secretBase58),
      makeSolana(sendRawTransaction),
    );
    await signer.onModuleInit();

    const wire = unsignedWireTx(expectedAddress);
    const sig = await signer.signAndSend(wire);

    expect(sig).toBe('broadcast-sig');
    expect(sendRawTransaction).toHaveBeenCalledTimes(1);

    // The broadcast payload carries the authority's signature.
    const decoded = getTransactionDecoder().decode(
      getBase64Encoder().encode(broadcastBase64),
    );
    const authoritySig = decoded.signatures[address(expectedAddress)];
    expect(authoritySig).not.toBeNull();
  });
});
