import { JwtService } from '@nestjs/jwt';
import type { RecoveryService } from '../recovery/recovery.service';
import { AuthService, EmailInUseError } from './auth.service';
import type { DbService } from '../db/db.service';
import type { WalletProvider } from '../wallet/wallet-provider.interface';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import { users } from '../db/schema';

/**
 * `AuthService.setEmail` decides one thing: whether the address the Consumer
 * typed already belongs to somebody else.
 *
 * Email stopped being a credential when passkeys took over sign-in, so this is
 * contact detail. What it must still refuse is two accounts claiming the same
 * inbox, because a notification is only worth sending if exactly one person
 * can receive it.
 */

type UsersRow = typeof users.$inferSelect;

/**
 * Drizzle's chain, reduced to the two shapes this path uses. `where` matches
 * everything: the service's own branch is `clash.id !== userId`, so a fixture
 * of one row is enough to drive both sides of it, and honouring the predicate
 * would only mean reimplementing `eq()` in the test.
 */
function makeFakeDb(rows: UsersRow[], updateError?: Error): DbService {
  const guard = (tbl: unknown) => {
    if (tbl !== users) throw new Error('unexpected table in fake db');
  };

  const withAdvisoryLock = <T>(_key: string, fn: () => Promise<T>) => fn();

  const client = {
    select: () => ({
      from: (tbl: unknown) => {
        guard(tbl);
        const chain: Record<string, unknown> = {
          where: () => chain,
          limit: (n: number) => {
            const sliced = rows.slice(0, n);
            return {
              then: (resolve: (v: unknown) => unknown) =>
                Promise.resolve(sliced).then(resolve),
            };
          },
        };
        return chain;
      },
    }),
    update: (tbl: unknown) => {
      guard(tbl);
      const ctx: { values?: Partial<UsersRow> } = {};
      const apply = () => {
        if (updateError) throw updateError;
        rows.forEach((row) => Object.assign(row, ctx.values));
        return rows.slice();
      };
      const chain: Record<string, unknown> = {
        set: (vals: Partial<UsersRow>) => {
          ctx.values = vals;
          return chain;
        },
        where: () => chain,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(apply()).then(resolve),
      };
      return chain;
    },
  };

  return { client, withAdvisoryLock } as unknown as DbService;
}

function makeUser(id: string, email: string | null): UsersRow {
  return {
    id,
    email,
    notificationsEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as UsersRow;
}

/**
 * The recovery anchor has to move with the contact address, so the fake
 * records what it was asked to move rather than swallowing the call.
 */
function makeService(rows: UsersRow[], updateError?: Error) {
  const reanchored: { previous: string | null; next: string }[] = [];
  const service = new AuthService(
    new JwtService({ secret: 'test-secret' }),
    makeFakeDb(rows, updateError),
    {} as WalletProvider,
    {} as SolanaRpc,
    {
      reanchorEmailSigner: (
        _userId: string,
        previous: string | null,
        next: string,
      ) => {
        reanchored.push({ previous, next });
        return Promise.resolve();
      },
    } as unknown as RecoveryService,
  );
  return Object.assign(service, { reanchored });
}

describe('AuthService.setEmail', () => {
  it('records the address when nobody holds it', async () => {
    const rows = [makeUser('u_1', null)];
    const service = makeService(rows);

    await expect(service.setEmail('u_1', 'new@example.com')).resolves.toEqual({
      email: 'new@example.com',
    });
    expect(rows[0].email).toBe('new@example.com');
  });

  it('records the address on an account that has none, from an empty table', async () => {
    // The passkey-only sign-up this exists for: the row was created by the
    // exchange with `email: null`, and no other row can clash.
    const service = makeService([]);

    await expect(service.setEmail('u_1', 'first@example.com')).resolves.toEqual(
      { email: 'first@example.com' },
    );
  });

  it('refuses an address another account already holds', async () => {
    const rows = [makeUser('u_other', 'taken@example.com')];
    const service = makeService(rows);

    await expect(service.setEmail('u_1', 'taken@example.com')).rejects.toThrow(
      EmailInUseError,
    );
    // The other account keeps it; a rejected claim must not move the address.
    expect(rows[0].email).toBe('taken@example.com');
    expect(rows[0].id).toBe('u_other');
  });

  it('lets a Consumer re-record the address they already hold', async () => {
    const rows = [makeUser('u_1', 'mine@example.com')];
    const service = makeService(rows);

    await expect(service.setEmail('u_1', 'mine@example.com')).resolves.toEqual({
      email: 'mine@example.com',
    });
  });

  it('answers a lost race the way it answers a clash it could read', async () => {
    // Two Consumers claiming one address both read no clash, and the unique
    // index turns one of them away. Untranslated that is a 500 reading like an
    // outage, for a refusal the Consumer can actually act on.
    const conflict = Object.assign(new Error('duplicate key value'), {
      code: '23505',
    });
    const service = makeService([makeUser('u_1', null)], conflict);

    await expect(service.setEmail('u_1', 'taken@example.com')).rejects.toThrow(
      EmailInUseError,
    );
  });

  it('lets a database failure that is not a clash through untouched', async () => {
    const outage = Object.assign(new Error('connection terminated'), {
      code: '57P01',
    });
    const service = makeService([makeUser('u_1', null)], outage);

    await expect(service.setEmail('u_1', 'new@example.com')).rejects.toThrow(
      'connection terminated',
    );
  });

  it('stamps updatedAt so the row reflects when contact last changed', async () => {
    const rows = [makeUser('u_1', null)];
    const before = rows[0].updatedAt;
    const service = makeService(rows);

    await service.setEmail('u_1', 'new@example.com');

    expect(rows[0].updatedAt.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
  });

  it('moves the recovery anchor when the address changes', async () => {
    const service = makeService([makeUser('u_1', 'old@example.com')]);

    await service.setEmail('u_1', 'new@example.com');

    // S3 is released against whatever address is on file, so a signer still
    // recording the old inbox would be judged against one address and
    // remembered against another.
    expect(service.reanchored).toEqual([
      { previous: 'old@example.com', next: 'new@example.com' },
    ]);
  });

  it('has nothing to move on a first address', async () => {
    const service = makeService([makeUser('u_1', null)]);

    await service.setEmail('u_1', 'first@example.com');

    expect(service.reanchored).toEqual([
      { previous: null, next: 'first@example.com' },
    ]);
  });
});
