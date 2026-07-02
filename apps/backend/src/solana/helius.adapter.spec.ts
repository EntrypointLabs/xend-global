import { ConfigService } from '@nestjs/config';
import { HeliusAdapter } from './helius.adapter';

/**
 * Focused unit test for the webhook address-list mutation seam.
 *
 * The list is a shared read-modify-write against the Helius webhook
 * config API (GET current -> append -> PUT full). Two concurrent
 * first-time signups must NOT clobber each other (lost update): the
 * adapter serializes mutations through a per-process queue so the
 * second mutation observes the first mutation's PUT.
 */
describe('HeliusAdapter webhook address-list serialization', () => {
  function makeAdapter(): HeliusAdapter {
    const config = {
      getOrThrow: (key: string) =>
        key === 'HELIUS_RPC_URL'
          ? 'https://devnet.helius-rpc.com/?api-key=test'
          : 'test-api-key',
      get: (key: string) => (key === 'HELIUS_WEBHOOK_ID' ? 'wh-1' : undefined),
    } as unknown as ConfigService;
    const adapter = new HeliusAdapter(config);
    adapter.onModuleInit();
    return adapter;
  }

  it('does not lose an address when two registrations run concurrently', async () => {
    // Server-side canonical state. GET reflects it; PUT overwrites it.
    let serverAddresses: string[] = [];

    const fetchMock = jest.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'GET') {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                webhookID: 'wh-1',
                wallet: 'w',
                webhookURL: 'https://x/webhook',
                transactionTypes: ['Any'],
                accountAddresses: [...serverAddresses],
                webhookType: 'enhanced',
                authHeader: 'secret',
              }),
          } as unknown as Response);
        }
        // PUT: overwrite the canonical list with the submitted one.
        const body = JSON.parse(init!.body as string) as {
          accountAddresses: string[];
        };
        serverAddresses = body.accountAddresses;
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(''),
        } as unknown as Response);
      },
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = makeAdapter();

    await Promise.all([
      adapter.registerWebhookAddress('addrA'),
      adapter.registerWebhookAddress('addrB'),
    ]);

    expect(serverAddresses).toContain('addrA');
    expect(serverAddresses).toContain('addrB');
    expect(serverAddresses).toHaveLength(2);
  });

  it('keeps the queue alive after a rejected mutation', async () => {
    let serverAddresses: string[] = [];
    let getCount = 0;

    const fetchMock = jest.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'GET') {
          getCount++;
          // Fail the very first GET so the first mutation rejects.
          if (getCount === 1) {
            return Promise.resolve({
              ok: false,
              status: 500,
              text: () => Promise.resolve('boom'),
            } as unknown as Response);
          }
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                webhookID: 'wh-1',
                wallet: 'w',
                webhookURL: 'https://x/webhook',
                transactionTypes: ['Any'],
                accountAddresses: [...serverAddresses],
                webhookType: 'enhanced',
                authHeader: 'secret',
              }),
          } as unknown as Response);
        }
        const body = JSON.parse(init!.body as string) as {
          accountAddresses: string[];
        };
        serverAddresses = body.accountAddresses;
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(''),
        } as unknown as Response);
      },
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = makeAdapter();

    const first = adapter.registerWebhookAddress('addrA');
    const second = adapter.registerWebhookAddress('addrB');

    await expect(first).rejects.toBeDefined();
    await expect(second).resolves.toBeUndefined();
    expect(serverAddresses).toEqual(['addrB']);
  });
});
