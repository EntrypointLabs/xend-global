import { ABANDONED_AFTER_MS, SignupReaper } from './signup.reaper';
import type { SignupStore } from './signup.store';

describe('SignupReaper', () => {
  it('reaps rows older than the token lifetime plus its margin', async () => {
    const cutoffs: Date[] = [];
    const store = {
      deleteAbandonedBefore: (before: Date) => {
        cutoffs.push(before);
        return Promise.resolve(2);
      },
    } as unknown as SignupStore;
    const now = new Date('2026-08-30T12:00:00Z');

    await new SignupReaper(store).tick(now);

    expect(cutoffs).toEqual([new Date(now.getTime() - ABANDONED_AFTER_MS)]);
    // Nothing a Consumer could still be holding is inside the window.
    expect(ABANDONED_AFTER_MS).toBeGreaterThan(15 * 60 * 1000 + 10 * 60 * 1000);
  });

  it('survives a failed sweep', async () => {
    const store = {
      deleteAbandonedBefore: () => Promise.reject(new Error('db away')),
    } as unknown as SignupStore;

    await expect(new SignupReaper(store).tick()).resolves.toBeUndefined();
  });
});
