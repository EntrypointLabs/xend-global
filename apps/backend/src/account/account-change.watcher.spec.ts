import type { AccountEventsService } from '../activity/account-events.service';
import type {
  AccountChangeService,
  StagedChange,
} from './account-change.service';
import type { SquadsAccountRow, SquadsAccountStore } from './account.interface';
import { SettingsActivitySignal } from '../activity/settings-activity.signal';
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
    findBySettingsAddresses: (addresses: string[]) =>
      Promise.resolve(
        accounts.filter((a) => addresses.includes(a.settingsAddress)),
      ),
  } as unknown as SquadsAccountStore;
  const settingsActivity = new SettingsActivitySignal();
  const watcher = new AccountChangeWatcher(
    changes,
    events,
    store,
    settingsActivity,
  );
  watcher.onModuleInit();

  return { watcher, recorded, settingsActivity };
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

  it('checks an Account as soon as a delivery touches its Settings', async () => {
    const { watcher, recorded } = setUp({
      'user-1': staged(),
      'user-2': staged({ transactionIndex: '3' }),
    });

    await watcher.onSettingsActivity(['settings-user-2', 'someone-else']);

    // Only the Account the delivery touched, not every Account.
    expect(recorded).toEqual([
      { userId: 'user-2', params: { changeIndex: '3', change: undefined } },
    ]);
  });

  it('hears deliveries through the signal the webhook emits on', async () => {
    const { recorded, settingsActivity } = setUp({ 'user-1': staged() });

    settingsActivity.emit(['settings-user-1']);
    await new Promise((resolve) => setImmediate(resolve));

    expect(recorded).toHaveLength(1);
  });

  it('ignores a delivery that touches no Account Settings', async () => {
    const { watcher, recorded } = setUp({ 'user-1': staged() });

    await watcher.onSettingsActivity(['vault-user-1']);

    expect(recorded).toEqual([]);
  });
});
