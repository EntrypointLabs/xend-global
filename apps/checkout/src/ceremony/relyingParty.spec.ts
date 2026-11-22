import { describe, expect, it, vi } from 'vitest';
import { pinPasskeyRelyingParty } from './relyingParty';

function fakeGlobal() {
  const fetch = vi.fn<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >(() => Promise.resolve(new Response('{}')));
  return { target: { fetch } as unknown as typeof globalThis, fetch };
}

describe('pinPasskeyRelyingParty', () => {
  it('names prydd.co on the passkey sign-in request', async () => {
    const { target, fetch } = fakeGlobal();
    pinPasskeyRelyingParty(target);
    await target.fetch(
      'https://auth.privy.io/api/v1/passkeys/authenticate/init',
      { method: 'POST', body: JSON.stringify({ token: 't' }) },
    );
    const init = fetch.mock.calls[0]![1]!;
    expect(JSON.parse(init.body as string)).toEqual({
      token: 't',
      relying_party: 'https://prydd.co',
    });
  });

  it('leaves every other request untouched', async () => {
    const { target, fetch } = fakeGlobal();
    pinPasskeyRelyingParty(target);
    const body = JSON.stringify({ relying_party: 'x' });
    await target.fetch('https://auth.privy.io/api/v1/passkeys/authenticate', {
      method: 'POST',
      body,
    });
    expect(fetch.mock.calls[0]![1]!.body).toBe(body);
  });

  it('restores the original fetch', () => {
    const { target, fetch } = fakeGlobal();
    const restore = pinPasskeyRelyingParty(target);
    restore();
    expect(target.fetch).toBe(fetch);
  });
});
