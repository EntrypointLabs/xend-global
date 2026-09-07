import { Keypair } from '@solana/web3.js';

import type { DbService } from '../db/db.service';
import type { squadsAccounts } from '../db/schema';
import { DrizzleSquadsAccountStore } from './squads-account.store';

/**
 * The store's only logic is the column mapping, and a dropped column here is
 * invisible to every service test: they run on in-memory stores that keep
 * whatever they are handed. This reads a full database row through the real
 * mapping.
 */

type DbRow = typeof squadsAccounts.$inferSelect;

const PENDING_PRIMARY = Keypair.generate().publicKey.toBase58();
const PENDING_APPROVAL = Keypair.generate().publicKey.toBase58();

function dbRow(patch: Partial<DbRow> = {}): DbRow {
  return {
    id: 'row-1',
    userId: 'user-1',
    settingsSeed: 42n,
    settingsAddress: Keypair.generate().publicKey.toBase58(),
    vaultAddress: Keypair.generate().publicKey.toBase58(),
    primarySigner: Keypair.generate().publicKey.toBase58(),
    approvalSigner: Keypair.generate().publicKey.toBase58(),
    approvalSubOrgId: 'suborg-1',
    pendingApprovalSigner: PENDING_APPROVAL,
    pendingApprovalSubOrgId: 'suborg-2',
    pendingApprovalChangeIndex: '8',
    pendingPrimarySigner: PENDING_PRIMARY,
    pendingPrimaryProviderId: 'did:privy:new',
    pendingPrimaryChangeIndex: '9',
    spendingLimitPolicySeed: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...patch,
  };
}

/** Enough of Drizzle's fluent client for a select and an update. */
function fakeDb(row: DbRow) {
  const updates: Record<string, unknown>[] = [];
  const db = {
    client: {
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([row]) }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({
            returning: () => {
              updates.push(values);
              return Promise.resolve([{ ...row, ...values }]);
            },
          }),
        }),
      }),
    },
  } as unknown as DbService;
  return { db, updates };
}

describe('DrizzleSquadsAccountStore', () => {
  it('reads every staged rotation column off the row', async () => {
    const { db } = fakeDb(dbRow());
    const store = new DrizzleSquadsAccountStore(db);

    const account = await store.findByUserId('user-1');

    expect(account).toMatchObject({
      pendingApprovalSigner: PENDING_APPROVAL,
      pendingApprovalSubOrgId: 'suborg-2',
      pendingApprovalChangeIndex: '8',
      pendingPrimarySigner: PENDING_PRIMARY,
      pendingPrimaryProviderId: 'did:privy:new',
      pendingPrimaryChangeIndex: '9',
    });
  });

  it('returns the patched row from an update, staged columns included', async () => {
    const { db, updates } = fakeDb(
      dbRow({
        pendingPrimarySigner: null,
        pendingPrimaryProviderId: null,
        pendingPrimaryChangeIndex: null,
      }),
    );
    const store = new DrizzleSquadsAccountStore(db);

    const staged = await store.updateByUserId('user-1', {
      pendingPrimarySigner: PENDING_PRIMARY,
      pendingPrimaryProviderId: 'did:privy:new',
      pendingPrimaryChangeIndex: '9',
    });

    // A rotation builds its propose step from the row this returns, so a
    // mapping that dropped these would stage a change with no signer in it.
    expect(staged.pendingPrimarySigner).toBe(PENDING_PRIMARY);
    expect(staged.pendingPrimaryProviderId).toBe('did:privy:new');
    expect(staged.pendingPrimaryChangeIndex).toBe('9');
    expect(updates[0]).toMatchObject({ pendingPrimaryChangeIndex: '9' });
  });
});
