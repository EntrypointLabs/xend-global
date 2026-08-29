import type { DbService } from '../db/db.service';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import type { SquadsAccountRow, SquadsAccountStore } from './account.interface';
import { SweepService } from './sweep.service';

const VAULT = 'Vault5555555555555555555555555555555555555';
const PRIVY = 'Privy1111111111111111111111111111111111111';

const account: SquadsAccountRow = {
  userId: 'user-1',
  settingsSeed: 1n,
  settingsAddress: 'Settg4444444444444444444444444444444444444',
  vaultAddress: VAULT,
  primarySigner: PRIVY,
  approvalSigner: 'Turnk2222222222222222222222222222222222222',
  approvalSubOrgId: 'suborg-1',
};

function store(row: SquadsAccountRow | null): SquadsAccountStore {
  return {
    findByUserId: () => Promise.resolve(row),
    insert: (r) => Promise.resolve(r),
    listAll: () => Promise.resolve([]),
    findUserEmail: () => Promise.resolve('consumer@example.com'),
    withUserLock: <T>(_userId: string, fn: () => Promise<T>) => fn(),
    updateByUserId: () =>
      Promise.reject(new Error('updateByUserId is not exercised here')),
  };
}

function db(rows: { walletAddress: string }[]): DbService {
  return {
    client: {
      select: () => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
      }),
    },
  } as unknown as DbService;
}

function rpc(
  tokens: { mint: string; amountRaw: bigint; decimals: number }[],
): SolanaRpc {
  return {
    getSolBalance: () => Promise.resolve(0n),
    getTokenBalances: () => Promise.resolve(tokens),
  } as unknown as SolanaRpc;
}

describe('SweepService.plan', () => {
  it('reports the balances still sitting in the Privy wallet', async () => {
    const service = new SweepService(
      db([{ walletAddress: PRIVY }]),
      store(account),
      rpc([{ mint: 'usdc', amountRaw: 750_000n, decimals: 6 }]),
    );

    await expect(service.plan('user-1')).resolves.toEqual({
      needed: true,
      destination: VAULT,
      balances: [{ mint: 'usdc', amountRaw: '750000', decimals: 6 }],
    });
  });

  it('needs no sweep when the Privy wallet is empty', async () => {
    const service = new SweepService(
      db([{ walletAddress: PRIVY }]),
      store(account),
      // A zero-balance token account still exists on chain long after it is
      // drained, so its presence must not read as something to move.
      rpc([{ mint: 'usdc', amountRaw: 0n, decimals: 6 }]),
    );

    const plan = await service.plan('user-1');

    expect(plan.needed).toBe(false);
    expect(plan.balances).toEqual([]);
  });

  it('needs no sweep before an Account exists', async () => {
    const service = new SweepService(
      db([{ walletAddress: PRIVY }]),
      store(null),
      rpc([{ mint: 'usdc', amountRaw: 750_000n, decimals: 6 }]),
    );

    // Nowhere to sweep to yet, and the Privy wallet is still the live address.
    await expect(service.plan('user-1')).resolves.toEqual({
      needed: false,
      balances: [],
    });
  });
});
