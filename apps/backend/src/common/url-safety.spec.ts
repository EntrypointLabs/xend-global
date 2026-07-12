import { promises as dns } from 'node:dns';
import {
  assertPublicHttpsUrl,
  isPrivateAddress,
  UnsafeUrlError,
} from './url-safety';

describe('isPrivateAddress', () => {
  it('classifies the documented IPv4 private ranges', () => {
    expect(isPrivateAddress('10.1.2.3')).toBe(true);
    expect(isPrivateAddress('172.16.0.1')).toBe(true);
    expect(isPrivateAddress('172.31.255.254')).toBe(true);
    expect(isPrivateAddress('192.168.1.1')).toBe(true);
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('169.254.10.10')).toBe(true);
    expect(isPrivateAddress('0.0.0.0')).toBe(true);
  });

  it('accepts public IPv4 addresses', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('1.1.1.1')).toBe(false);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
    expect(isPrivateAddress('172.15.0.1')).toBe(false);
  });

  it('classifies the documented IPv6 private ranges', () => {
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('::')).toBe(true);
    expect(isPrivateAddress('fc00::1')).toBe(true);
    expect(isPrivateAddress('fd12:3456::1')).toBe(true);
    expect(isPrivateAddress('fe80::1')).toBe(true);
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
  });

  it('accepts a public IPv6 address', () => {
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
  });
});

describe('assertPublicHttpsUrl', () => {
  afterEach(() => jest.restoreAllMocks());

  function mockLookup(address: string, family = 4) {
    const spy = jest.spyOn(dns, 'lookup') as unknown as jest.Mock;
    spy.mockResolvedValue([{ address, family }]);
  }

  it('rejects a non-HTTPS url', async () => {
    await expect(
      assertPublicHttpsUrl('http://example.com/hook'),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('rejects a malformed url', async () => {
    await expect(assertPublicHttpsUrl('not a url')).rejects.toMatchObject({
      code: 'UNSAFE_URL',
    });
  });

  it('rejects a host resolving to loopback', async () => {
    mockLookup('127.0.0.1');
    await expect(
      assertPublicHttpsUrl('https://sneaky.internal/hook'),
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' });
  });

  it('rejects a host resolving to a 10.x address', async () => {
    mockLookup('10.0.0.5');
    await expect(
      assertPublicHttpsUrl('https://sneaky.internal/hook'),
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' });
  });

  it('rejects a host resolving to link-local', async () => {
    mockLookup('169.254.169.254');
    await expect(
      assertPublicHttpsUrl('https://metadata.internal/hook'),
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' });
  });

  it('rejects a host resolving to IPv6 loopback', async () => {
    mockLookup('::1', 6);
    await expect(
      assertPublicHttpsUrl('https://sneaky.internal/hook'),
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' });
  });

  it('passes a public host', async () => {
    mockLookup('93.184.216.34');
    await expect(
      assertPublicHttpsUrl('https://example.com/hook'),
    ).resolves.toBeUndefined();
  });

  it('bypasses the IP check when allowPrivate is set', async () => {
    const spy = jest.spyOn(dns, 'lookup');
    await expect(
      assertPublicHttpsUrl('https://127.0.0.1:4000/hook', {
        allowPrivate: true,
      }),
    ).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});
