import { ConfigService } from '@nestjs/config';
import { EarnSnapshotJob } from './earn-snapshot.job';
import type { EarnRecords } from './earn-records';
import type { EarnService } from './earn.service';

function setup(cluster = 'mainnet') {
  const config = new ConfigService({ SOLANA_CLUSTER: cluster });
  const usersWithEarn = jest.fn().mockResolvedValue(['a', 'b', 'c']);
  const records = { usersWithEarn } as unknown as EarnRecords;
  let inFlight = 0;
  let maxInFlight = 0;
  const snapshot = jest.fn(async (userId: string) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight -= 1;
    if (userId === 'b') throw new Error('rpc down');
  });
  const job = new EarnSnapshotJob(
    config,
    { snapshot } as unknown as EarnService,
    records,
  );
  return { job, usersWithEarn, snapshot, maxInFlight: () => maxInFlight };
}

describe('EarnSnapshotJob', () => {
  it('snapshots every Earn user one at a time and survives a failing one', async () => {
    const h = setup();
    await h.job.tick();
    expect(h.snapshot.mock.calls.map(([userId]) => userId)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(h.maxInFlight()).toBe(1);
  });
  it('does nothing off mainnet', async () => {
    const h = setup('devnet');
    await h.job.tick();
    expect(h.usersWithEarn).not.toHaveBeenCalled();
    expect(h.snapshot).not.toHaveBeenCalled();
  });
  it('does not overlap a run still in progress', async () => {
    const h = setup();
    await Promise.all([h.job.tick(), h.job.tick()]);
    expect(h.snapshot).toHaveBeenCalledTimes(3);
  });
});
