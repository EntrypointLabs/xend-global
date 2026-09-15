import { InMemoryPreparedTxStore } from './prepared-tx.memory';

describe('InMemoryPreparedTxStore', () => {
  it('returns what was set until the ttl passes', async () => {
    let now = 1_000_000;
    const store = new InMemoryPreparedTxStore(() => now);

    await store.set('k', { messageBase64: 'm' }, 60);
    await expect(store.get('k')).resolves.toEqual({ messageBase64: 'm' });

    now += 61_000;
    await expect(store.get('k')).resolves.toBeNull();
  });

  it('forgets a deleted key', async () => {
    const store = new InMemoryPreparedTxStore();
    await store.set('k', 'v', 60);
    await store.delete('k');
    await expect(store.get('k')).resolves.toBeNull();
  });
});
