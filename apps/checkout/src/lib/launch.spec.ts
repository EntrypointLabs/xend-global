import { describe, expect, it } from 'vitest';
import { parseLaunch } from './launch';

describe('parseLaunch', () => {
  it('reads the opener origin the SDK appended', () => {
    const launch = parseLaunch(
      '?nonce=n1&mode=popup&intent=pi_1&opener=https%3A%2F%2Fshop.example.com',
    );
    expect(launch.opener).toBe('https://shop.example.com');
    expect(launch.reference).toBe('pi_1');
  });

  it('keeps a loopback http opener for local integration', () => {
    expect(
      parseLaunch('?nonce=n1&opener=http%3A%2F%2Flocalhost%3A3000').opener,
    ).toBe('http://localhost:3000');
  });

  it.each([
    ['a path', 'https://shop.example.com/checkout'],
    ['plain http', 'http://shop.example.com'],
    ['the opaque origin', 'null'],
    ['garbage', 'not a url'],
  ])('drops an opener carrying %s without failing the launch', (_n, raw) => {
    const launch = parseLaunch(`?nonce=n1&opener=${encodeURIComponent(raw)}`);
    expect(launch.opener).toBeNull();
    expect(launch.nonce).toBe('n1');
  });

  it('still refuses a launch without a nonce', () => {
    expect(() => parseLaunch('?opener=https%3A%2F%2Fshop.example.com')).toThrow(
      /nonce/,
    );
  });
});
