import { ExpoPushAdapter } from './expo-push.adapter';

describe('ExpoPushAdapter', () => {
  const fetchMock = jest.fn();
  const realFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ status: 'ok' }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  const sentBody = (): Record<string, unknown>[] => {
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    return JSON.parse(init.body) as Record<string, unknown>[];
  };

  it('sends a time-sensitive notice at high priority on the urgent channel', async () => {
    const expiresAt = new Date('2026-11-20T12:00:00.000Z');
    await new ExpoPushAdapter().send([
      {
        token: 'ExponentPushToken[a]',
        title: 'Approve',
        body: 'Tap',
        data: { kind: 'payment_approval', reference: 'pi_1' },
        urgency: 'time_sensitive',
        expiresAt,
      },
    ]);

    expect(sentBody()[0]).toMatchObject({
      to: 'ExponentPushToken[a]',
      priority: 'high',
      interruptionLevel: 'time-sensitive',
      channelId: 'payment-approval',
      expiration: expiresAt.getTime() / 1000,
      data: { kind: 'payment_approval', reference: 'pi_1' },
    });
  });

  it('leaves an ordinary notice at the provider defaults', async () => {
    await new ExpoPushAdapter().send([
      { token: 'ExponentPushToken[b]', title: 'Money in', body: 'x' },
    ]);

    const message = sentBody()[0];
    expect(message).not.toHaveProperty('priority');
    expect(message).not.toHaveProperty('interruptionLevel');
    expect(message).not.toHaveProperty('channelId');
    expect(message).not.toHaveProperty('expiration');
  });
});
