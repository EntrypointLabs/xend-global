import { ConfigService } from '@nestjs/config';
import { PrivyAdapter } from './privy.adapter';
import {
  InvalidPrivyTokenError,
  PrivyUnavailableError,
  PrivyUserShapeError,
} from './privy.errors';
import type { User } from '@privy-io/server-auth';

/**
 * Unit tests for PrivyAdapter. The underlying PrivyClient is stubbed —
 * these tests cover our error mapping and user-shape extraction, NOT the
 * Privy SDK's correctness.
 */

type GetUserFn = (props: { idToken: string }) => Promise<User>;
type GetUserByIdFn = (id: string) => Promise<User>;

function makeAdapter(opts: {
  getUser?: GetUserFn;
  getUserById?: GetUserByIdFn;
}): PrivyAdapter {
  const adapter = new PrivyAdapter({
    getOrThrow: (key: string) => {
      const map: Record<string, string> = {
        PRIVY_APP_ID: 'app-id',
        PRIVY_APP_SECRET: 'app-secret',
      };
      return map[key] ?? '';
    },
    get: () => '',
  } as unknown as ConfigService);
  adapter.onModuleInit();
  // Replace the real PrivyClient with a stub. We reach into the private
  // field intentionally — Nest does not give us a clean seam without
  // building a wrapper class we do not need outside tests.
  (adapter as unknown as { client: unknown }).client = {
    getUser: opts.getUser ?? jest.fn(),
    getUserById: opts.getUserById ?? jest.fn(),
  };
  return adapter;
}

const privyUserWithEmbeddedSolana: User = {
  id: 'did:privy:abc123',
  createdAt: new Date(),
  isGuest: false,
  customMetadata: {},
  email: {
    address: 'user@example.com',
    verifiedAt: new Date(),
    firstVerifiedAt: new Date(),
    latestVerifiedAt: new Date(),
  },
  linkedAccounts: [
    {
      type: 'email',
      address: 'user@example.com',
      verifiedAt: new Date(),
      firstVerifiedAt: new Date(),
      latestVerifiedAt: new Date(),
    } as unknown as User['linkedAccounts'][number],
    {
      type: 'wallet',
      address: 'SoLAnAaDdRess111111111111111111111111111111',
      chainType: 'solana',
      walletClientType: 'privy',
      verifiedAt: new Date(),
      firstVerifiedAt: new Date(),
      latestVerifiedAt: new Date(),
    } as unknown as User['linkedAccounts'][number],
  ],
};

describe('PrivyAdapter', () => {
  describe('verifyIdToken', () => {
    it('returns providerUserId + email + walletAddress on a valid token', async () => {
      const adapter = makeAdapter({
        getUser: jest.fn().mockResolvedValue(privyUserWithEmbeddedSolana),
      });
      const result = await adapter.verifyIdToken('valid.id.token');
      expect(result).toEqual({
        providerUserId: 'did:privy:abc123',
        email: 'user@example.com',
        walletAddress: 'SoLAnAaDdRess111111111111111111111111111111',
      });
    });

    it('throws InvalidPrivyTokenError on empty token', async () => {
      const adapter = makeAdapter({});
      await expect(adapter.verifyIdToken('')).rejects.toBeInstanceOf(
        InvalidPrivyTokenError,
      );
    });

    it('throws InvalidPrivyTokenError when SDK rejects (4xx)', async () => {
      const adapter = makeAdapter({
        getUser: jest
          .fn()
          .mockRejectedValue(
            Object.assign(new Error('invalid token'), { status: 401 }),
          ),
      });
      await expect(adapter.verifyIdToken('bad.token')).rejects.toBeInstanceOf(
        InvalidPrivyTokenError,
      );
    });

    it('throws PrivyUnavailableError when SDK throws 5xx', async () => {
      const adapter = makeAdapter({
        getUser: jest
          .fn()
          .mockRejectedValue(
            Object.assign(new Error('upstream down'), { status: 503 }),
          ),
      });
      await expect(adapter.verifyIdToken('any.token')).rejects.toBeInstanceOf(
        PrivyUnavailableError,
      );
    });

    it('throws PrivyUnavailableError on network errors (ECONNREFUSED / JWKS fetch failure)', async () => {
      const adapter = makeAdapter({
        getUser: jest.fn().mockRejectedValue(
          Object.assign(new Error('connect ECONNREFUSED'), {
            code: 'ECONNREFUSED',
          }),
        ),
      });
      await expect(adapter.verifyIdToken('any.token')).rejects.toBeInstanceOf(
        PrivyUnavailableError,
      );
    });

    it('throws PrivyUserShapeError when user has no email', async () => {
      const adapter = makeAdapter({
        getUser: jest.fn().mockResolvedValue({
          ...privyUserWithEmbeddedSolana,
          email: undefined,
        }),
      });
      await expect(
        adapter.verifyIdToken('valid.id.token'),
      ).rejects.toBeInstanceOf(PrivyUserShapeError);
    });

    it('throws PrivyUserShapeError when user has no Solana wallet', async () => {
      const adapter = makeAdapter({
        getUser: jest.fn().mockResolvedValue({
          ...privyUserWithEmbeddedSolana,
          linkedAccounts: privyUserWithEmbeddedSolana.linkedAccounts.filter(
            (a) => a.type !== 'wallet',
          ),
        }),
      });
      await expect(
        adapter.verifyIdToken('valid.id.token'),
      ).rejects.toBeInstanceOf(PrivyUserShapeError);
    });

    it('prefers embedded (walletClientType=privy) Solana wallet when multiple exist', async () => {
      const adapter = makeAdapter({
        getUser: jest.fn().mockResolvedValue({
          ...privyUserWithEmbeddedSolana,
          linkedAccounts: [
            ...privyUserWithEmbeddedSolana.linkedAccounts,
            {
              type: 'wallet',
              address: 'ExternalSolana111111111111111111111111111111',
              chainType: 'solana',
              walletClientType: 'phantom',
              verifiedAt: new Date(),
              firstVerifiedAt: new Date(),
              latestVerifiedAt: new Date(),
            } as unknown as User['linkedAccounts'][number],
          ],
        }),
      });
      const result = await adapter.verifyIdToken('valid.id.token');
      expect(result.walletAddress).toBe(
        'SoLAnAaDdRess111111111111111111111111111111',
      );
    });
  });

  describe('getUser', () => {
    it('returns user by DID', async () => {
      const adapter = makeAdapter({
        getUserById: jest.fn().mockResolvedValue(privyUserWithEmbeddedSolana),
      });
      const result = await adapter.getUser('did:privy:abc123');
      expect(result.providerUserId).toBe('did:privy:abc123');
    });

    it('throws InvalidPrivyTokenError on empty providerUserId', async () => {
      const adapter = makeAdapter({});
      await expect(adapter.getUser('')).rejects.toBeInstanceOf(
        InvalidPrivyTokenError,
      );
    });
  });

  describe('signTransaction', () => {
    it('always throws NotImplementedException (Privy signs client-side)', async () => {
      const adapter = makeAdapter({});
      await expect(
        adapter.signTransaction({
          unsignedTxBase64: 'aGVsbG8=',
          walletAddress: 'addr',
        }),
      ).rejects.toThrow(/Privy signs client-side/);
    });
  });
});
