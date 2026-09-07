// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const STORAGE_KEY = 'xend.checkout.session';

function setParent(value: unknown) {
  Object.defineProperty(window, 'parent', {
    value,
    configurable: true,
    writable: true,
  });
}

function stubFetch(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Reloaded per test so the module reads the stubbed API base. */
async function loadApi() {
  vi.stubEnv('VITE_API_BASE', 'https://api.test');
  vi.resetModules();
  return import('./api');
}

function sentHeaders(fetchMock: ReturnType<typeof stubFetch>) {
  return (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<
    string,
    string
  >;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setParent(window);
});

describe('the Session carrier', () => {
  it('sends the stored token on the header when the surface is framed', async () => {
    setParent({});
    window.localStorage.setItem(STORAGE_KEY, 'stored-token');
    const fetchMock = stubFetch({ status: 'succeeded' });
    const { authorize } = await loadApi();

    await authorize({ reference: 'pi_1' });

    expect(sentHeaders(fetchMock)['X-Xend-Checkout-Session']).toBe(
      'stored-token',
    );
  });

  it('sends an empty header when framed with nothing stored yet', async () => {
    setParent({});
    const fetchMock = stubFetch({ status: 'succeeded' });
    const { authorize } = await loadApi();

    await authorize({ reference: 'pi_1' });

    expect(sentHeaders(fetchMock)['X-Xend-Checkout-Session']).toBe('');
  });

  it('sends no header at all from a popup, which has the cookie', async () => {
    setParent(window);
    const fetchMock = stubFetch({ status: 'succeeded' });
    const { authorize } = await loadApi();

    await authorize({ reference: 'pi_1' });

    expect(sentHeaders(fetchMock)).not.toHaveProperty(
      'X-Xend-Checkout-Session',
    );
    expect((fetchMock.mock.calls[0]![1] as RequestInit).credentials).toBe(
      'include',
    );
  });

  it('persists a rotated token the framed response hands back', async () => {
    setParent({});
    stubFetch({ status: 'succeeded', sessionToken: 'rotated' });
    const { authorize } = await loadApi();

    await authorize({ reference: 'pi_1' });

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('rotated');
  });

  it('leaves storage alone when the response carries no token', async () => {
    setParent({});
    window.localStorage.setItem(STORAGE_KEY, 'stored-token');
    stubFetch({ status: 'succeeded' });
    const { authorize } = await loadApi();

    await authorize({ reference: 'pi_1' });

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('stored-token');
  });

  it('survives a browser that refuses storage to a third-party frame', async () => {
    setParent({});
    const blocked = () => {
      throw new Error('storage blocked');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    const fetchMock = stubFetch({ status: 'succeeded', sessionToken: 'rot' });
    const { authorize } = await loadApi();

    await expect(authorize({ reference: 'pi_1' })).resolves.toMatchObject({
      status: 'succeeded',
    });
    expect(sentHeaders(fetchMock)['X-Xend-Checkout-Session']).toBe('');
    vi.restoreAllMocks();
  });
});
