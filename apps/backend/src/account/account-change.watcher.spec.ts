import type { AccountEventsService } from '../activity/account-events.service';
import type {
  AccountChangeService,
  StagedChange,
} from './account-change.service';
import type { SquadsAccountRow, SquadsAccountStore } from './account.interface';
import { AccountChangeWatcher } from './account-change.watcher';

function account(userId: string): SquadsAccountRow {
  return {
    userId,
    settingsSeed: 1n,
    settingsAddress: `settings-${userId}`,
    vaultAddress: `vault-${userId}`,
    primarySigner: 'primary',
    approvalSigner: 'approval',
    approvalSubOrgId: `suborg-${userId}`,
  };
}

function staged(overrides: Partial<StagedChange> = {}): StagedChange {
  return {
    transactionIndex: '8',
    status: 'Active',
    approvals: [],
    executableAt: null,
    selfInitiated: false,
    ...overrides,
  };
}

function setUp(
  pending: Record<string, StagedChange | null | Error>,
  accounts = Object.keys(pending).map(account),
) {
  const recorded: { userId: string; params: Record<string, unknown> }[] = [];
  const changes = {
    pendingFor: (row: SquadsAccountRow) => {
      const answer = pending[row.userId];
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer ?? null);
    },
  } as unknown as AccountChangeService;
  const events = {
    recordSettingsChangeStaged: (
      userId: string,
      params: Record<string, unknown>,
    ) => {
      recorded.push({ userId, params });
      return Promise.resolve({});
    },
  } as unknown as AccountEventsService;
  const store = {
    listAll: () => Promise.resolve(accounts),
  } as unknown as SquadsAccountStore;

  return {
    watcher: new AccountChangeWatcher(changes, events, store),
    recorded,
  };
}

describe('AccountChangeWatcher', () => {
  it('records a staged change it finds, against the change itself', async () => {
    const { watcher, recorded } = setUp({ 'user-1': staged() });

    await watcher.tick();

    // Recording is what announces it, and the dedupe on (user, index) is what
    // keeps the next tick, and the service that staged it, from repeating it.
    expect(recorded).toEqual([
      { userId: 'user-1', params: { changeIndex: '8', change: undefined } },
    ]);
  });

  it('names the change when the backend staged it, and admits ignorance otherwise', async () => {
    const { watcher, recorded } = setUp({
      'user-1': staged({ selfInitiated: true }),
      'user-2': staged({ selfInitiated: false }),
    });

    await watcher.tick();

    expect(recorded.map((r) => r.params.change)).toEqual([
      'recovery_key',
      undefined,
    ]);
  });

  it('records nothing for an Account with no change pending', async () => {
    const { watcher, recorded } = setUp({ 'user-1': null });

    await watcher.tick();

    expect(recorded).toEqual([]);
  });

  it('keeps checking the rest when one Account cannot be read', async () => {
    const { watcher, recorded } = setUp({
      'user-1': new Error('rpc down'),
      'user-2': staged(),
    });

    await watcher.tick();

    expect(recorded.map((r) => r.userId)).toEqual(['user-2']);
  });
});
