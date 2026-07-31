import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import type { DbService } from '../db/db.service';
import { users } from '../db/schema';

type UsersRow = typeof users.$inferSelect;

function makeConfig(): ConfigService {
  return {
    getOrThrow: () => 'test-secret',
  } as unknown as ConfigService;
}

function makeDb(row: Pick<UsersRow, 'deletedAt'> | null): DbService {
  const client = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(row ? [row] : []),
        }),
      }),
    }),
  };
  return { client } as unknown as DbService;
}

describe('JwtStrategy.validate', () => {
  const payload = { sub: 'u_1', walletAddress: 'Wallet1' };

  it('returns the request-user shape for an active account', async () => {
    const strategy = new JwtStrategy(makeConfig(), makeDb({ deletedAt: null }));
    await expect(strategy.validate(payload)).resolves.toEqual({
      userId: 'u_1',
      walletAddress: 'Wallet1',
    });
  });

  it('rejects a token whose user no longer exists', async () => {
    const strategy = new JwtStrategy(makeConfig(), makeDb(null));
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token for a soft-deleted (Delete Account) user', async () => {
    const strategy = new JwtStrategy(
      makeConfig(),
      makeDb({ deletedAt: new Date() }),
    );
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
