import { FailoverSolanaRpc } from './failover-solana-rpc';
import type { HeliusAdapter } from './helius.adapter';
import type { PublicMainnetAdapter } from './public-mainnet.adapter';
import type { SignatureStatus, TokenBalance } from './solana-rpc.interface';

/**
 * Unit tests for FailoverSolanaRpc.
 *
 * Hits the failover seam directly with stub adapters; no real Solana
 * connection. The critical invariant is the no-fallback on
 * sendRawTransaction, tested explicitly below.
 */

function makeStub(
  overrides: Partial<HeliusAdapter | PublicMainnetAdapter> = {},
) {
  return {
    getRecentBlockhash: jest.fn(),
    getTokenBalances: jest.fn(),
    sendRawTransaction: jest.fn(),
    getSignatureStatuses: jest.fn(),
    accountExists: jest.fn(),
    streamConfirmedTransfers: jest.fn(),
    registerWebhookAddress: jest.fn(),
    unregisterWebhookAddress: jest.fn(),
    verifyWebhookSignature: jest.fn(),
    ...overrides,
  };
}

function makeFailover(
  primary: ReturnType<typeof makeStub>,
  fallback: ReturnType<typeof makeStub>,
) {
  return new FailoverSolanaRpc(
    primary as unknown as HeliusAdapter,
    fallback as unknown as PublicMainnetAdapter,
  );
}

const sampleBalances: TokenBalance[] = [
  { mint: 'mint1', amountRaw: 1_000_000n, decimals: 6 },
];

describe('FailoverSolanaRpc', () => {
  describe('read paths fall back when primary throws', () => {
    it('getRecentBlockhash: falls back on primary throw', async () => {
      const primary = makeStub({
        getRecentBlockhash: jest
          .fn()
          .mockRejectedValue(new Error('helius down')),
      });
      const fallback = makeStub({
        getRecentBlockhash: jest.fn().mockResolvedValue({
          blockhash: 'abc',
          lastValidBlockHeight: 42,
        }),
      });
      const rpc = makeFailover(primary, fallback);
      const result = await rpc.getRecentBlockhash();
      expect(result.blockhash).toBe('abc');
      expect(primary.getRecentBlockhash).toHaveBeenCalledTimes(1);
      expect(fallback.getRecentBlockhash).toHaveBeenCalledTimes(1);
    });

    it('getTokenBalances: returns primary result without calling fallback when primary succeeds', async () => {
      const primary = makeStub({
        getTokenBalances: jest.fn().mockResolvedValue(sampleBalances),
      });
      const fallback = makeStub();
      const rpc = makeFailover(primary, fallback);
      const result = await rpc.getTokenBalances('owner');
      expect(result).toEqual(sampleBalances);
      expect(fallback.getTokenBalances).not.toHaveBeenCalled();
    });

    it('getTokenBalances: falls back on primary throw and returns multi-mint list', async () => {
      const multiMint: TokenBalance[] = [
        { mint: 'usdc', amountRaw: 1_000_000n, decimals: 6 },
        { mint: 'usdt', amountRaw: 2_000_000n, decimals: 6 },
        { mint: 'bonk', amountRaw: 100_000_000n, decimals: 5 },
      ];
      const primary = makeStub({
        getTokenBalances: jest.fn().mockRejectedValue(new Error('helius 429')),
      });
      const fallback = makeStub({
        getTokenBalances: jest.fn().mockResolvedValue(multiMint),
      });
      const rpc = makeFailover(primary, fallback);
      const result = await rpc.getTokenBalances('owner');
      expect(result).toHaveLength(3);
      expect(result.map((b) => b.mint)).toEqual(['usdc', 'usdt', 'bonk']);
    });

    it('getSignatureStatuses: falls back on primary throw', async () => {
      const statuses: SignatureStatus[] = [
        {
          signature: 'sig1',
          slot: 1n,
          confirmationStatus: 'confirmed',
          err: null,
        },
      ];
      const primary = makeStub({
        getSignatureStatuses: jest.fn().mockRejectedValue(new Error('boom')),
      });
      const fallback = makeStub({
        getSignatureStatuses: jest.fn().mockResolvedValue(statuses),
      });
      const rpc = makeFailover(primary, fallback);
      const result = await rpc.getSignatureStatuses(['sig1']);
      expect(result).toEqual(statuses);
    });

    it('propagates the fallback error when BOTH fail', async () => {
      const primary = makeStub({
        getRecentBlockhash: jest.fn().mockRejectedValue(new Error('primary')),
      });
      const fallback = makeStub({
        getRecentBlockhash: jest.fn().mockRejectedValue(new Error('fallback')),
      });
      const rpc = makeFailover(primary, fallback);
      await expect(rpc.getRecentBlockhash()).rejects.toThrow('fallback');
    });
  });

  describe('sendRawTransaction does NOT fallback (no double-broadcast)', () => {
    // Failing this test means we may double-broadcast a signed
    // transaction, which wastes blockhashes and can mask real Helius
    // errors. See the failover-solana-rpc.ts class doc.

    it('returns primary result directly on success', async () => {
      const primary = makeStub({
        sendRawTransaction: jest.fn().mockResolvedValue('sig-from-helius'),
      });
      const fallback = makeStub({
        sendRawTransaction: jest.fn().mockResolvedValue('sig-from-public'),
      });
      const rpc = makeFailover(primary, fallback);
      const sig = await rpc.sendRawTransaction('base64payload==');
      expect(sig).toBe('sig-from-helius');
      expect(primary.sendRawTransaction).toHaveBeenCalledTimes(1);
      expect(fallback.sendRawTransaction).not.toHaveBeenCalled();
    });

    it('propagates primary error WITHOUT calling fallback', async () => {
      const primary = makeStub({
        sendRawTransaction: jest
          .fn()
          .mockRejectedValue(new Error('helius rejected: blockhash expired')),
      });
      const fallback = makeStub({
        sendRawTransaction: jest
          .fn()
          .mockResolvedValue('sig-from-public-WOULD-DOUBLE-BROADCAST'),
      });
      const rpc = makeFailover(primary, fallback);
      await expect(rpc.sendRawTransaction('payload')).rejects.toThrow(
        'helius rejected',
      );
      // The defining assertion: fallback MUST NOT be touched on the write
      // path, even when primary fails. See class doc rationale.
      expect(fallback.sendRawTransaction).not.toHaveBeenCalled();
    });
  });

  describe('streamConfirmedTransfers', () => {
    it('yields from primary when primary primes successfully', async () => {
      const event = {
        signature: 'sig1',
        slot: 100n,
        mint: 'mint',
        amountRaw: 1n,
        fromAddress: 'a',
        toAddress: 'b',
        confirmedAt: new Date(),
      };
      const primary = makeStub({
        streamConfirmedTransfers: jest.fn().mockImplementation(
          // eslint-disable-next-line @typescript-eslint/require-await
          async function* () {
            yield event;
          },
        ),
      });
      const fallback = makeStub();
      const rpc = makeFailover(primary, fallback);
      const out: unknown[] = [];
      for await (const e of rpc.streamConfirmedTransfers('owner', 0n)) {
        out.push(e);
      }
      expect(out).toEqual([event]);
      expect(fallback.streamConfirmedTransfers).not.toHaveBeenCalled();
    });

    it('falls back when the primary generator rejects on the first page', async () => {
      const event = {
        signature: 'sigF',
        slot: 200n,
        mint: 'mint',
        amountRaw: 2n,
        fromAddress: 'a',
        toAddress: 'b',
        confirmedAt: new Date(),
      };
      // A real adapter is an async generator: calling it and taking its
      // iterator never throw; the RPC error surfaces only on the first
      // `.next()` (after an await inside the body). The failover must
      // trigger on that first pull, not on iterator construction.
      const primary = makeStub({
        streamConfirmedTransfers: jest.fn().mockImplementation(
          // eslint-disable-next-line require-yield
          async function* (): AsyncGenerator<never> {
            await Promise.resolve();
            throw new Error('helius down');
          },
        ),
      });
      const fallback = makeStub({
        streamConfirmedTransfers: jest.fn().mockImplementation(
          // eslint-disable-next-line @typescript-eslint/require-await
          async function* () {
            yield event;
          },
        ),
      });
      const rpc = makeFailover(primary, fallback);
      const out: unknown[] = [];
      for await (const e of rpc.streamConfirmedTransfers('owner', 0n)) {
        out.push(e);
      }
      expect(out).toEqual([event]);
      expect(fallback.streamConfirmedTransfers).toHaveBeenCalledTimes(1);
    });

    it('does NOT fall back once the primary has yielded (mid-stream errors propagate)', async () => {
      const event = {
        signature: 'sigMid',
        slot: 300n,
        mint: 'mint',
        amountRaw: 3n,
        fromAddress: 'a',
        toAddress: 'b',
        confirmedAt: new Date(),
      };
      const primary = makeStub({
        streamConfirmedTransfers: jest.fn().mockImplementation(
          // eslint-disable-next-line @typescript-eslint/require-await
          async function* () {
            yield event;
            throw new Error('helius down mid-stream');
          },
        ),
      });
      const fallback = makeStub();
      const rpc = makeFailover(primary, fallback);
      const out: unknown[] = [];
      await expect(
        (async () => {
          for await (const e of rpc.streamConfirmedTransfers('owner', 0n)) {
            out.push(e);
          }
        })(),
      ).rejects.toThrow('helius down mid-stream');
      expect(out).toEqual([event]);
      expect(fallback.streamConfirmedTransfers).not.toHaveBeenCalled();
    });
  });

  describe('control plane (Helius-only) proxies to primary', () => {
    it('registerWebhookAddress hits primary only', async () => {
      const primary = makeStub({
        registerWebhookAddress: jest.fn().mockResolvedValue(undefined),
      });
      const fallback = makeStub();
      const rpc = makeFailover(primary, fallback);
      await rpc.registerWebhookAddress('addr');
      expect(primary.registerWebhookAddress).toHaveBeenCalledWith('addr');
      expect(fallback.registerWebhookAddress).not.toHaveBeenCalled();
    });

    it('unregisterWebhookAddress hits primary only', async () => {
      const primary = makeStub({
        unregisterWebhookAddress: jest.fn().mockResolvedValue(undefined),
      });
      const fallback = makeStub();
      const rpc = makeFailover(primary, fallback);
      await rpc.unregisterWebhookAddress('addr');
      expect(primary.unregisterWebhookAddress).toHaveBeenCalled();
      expect(fallback.unregisterWebhookAddress).not.toHaveBeenCalled();
    });

    it('verifyWebhookSignature delegates to primary', () => {
      const primary = makeStub({
        verifyWebhookSignature: jest.fn(),
      });
      const fallback = makeStub();
      const rpc = makeFailover(primary, fallback);
      rpc.verifyWebhookSignature(Buffer.from('body'), 'sig');
      expect(primary.verifyWebhookSignature).toHaveBeenCalledWith(
        Buffer.from('body'),
        'sig',
      );
      expect(fallback.verifyWebhookSignature).not.toHaveBeenCalled();
    });
  });
});
