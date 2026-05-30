import { FailoverSolanaRpc } from './failover-solana-rpc';
import type { HeliusAdapter } from './helius.adapter';
import type { PublicMainnetAdapter } from './public-mainnet.adapter';
import type { SignatureStatus, TokenBalance } from './solana-rpc.interface';

/**
 * Unit tests for FailoverSolanaRpc.
 *
 * Hits the failover seam directly with stub adapters; no real Solana
 * connection. The critical invariant is the no-fallback on
 * sendRawTransaction (PLAN.md hard rule), tested explicitly below.
 */

function makeStub(
  overrides: Partial<HeliusAdapter | PublicMainnetAdapter> = {},
) {
  return {
    getRecentBlockhash: jest.fn(),
    getTokenBalances: jest.fn(),
    sendRawTransaction: jest.fn(),
    getSignatureStatuses: jest.fn(),
    streamConfirmedTransfers: jest.fn(),
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
    // This test enforces the hard rule from PLAN.md / failover-solana-rpc.ts
    // class doc. Failing this test means we may double-broadcast a signed
    // transaction, which wastes blockhashes and can mask real Helius errors.
    // Do not relax without updating the spec.

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

  describe('streamConfirmedTransfers (Phase 2 stub)', () => {
    it('throws NotImplementedException with Phase 2 marker', () => {
      const rpc = makeFailover(makeStub(), makeStub());
      expect(() => rpc.streamConfirmedTransfers('owner', 0n)).toThrow(
        /Phase 2/,
      );
    });
  });
});
