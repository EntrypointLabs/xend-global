// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { isFramed } from './frame';

function setParent(value: unknown) {
  Object.defineProperty(window, 'parent', {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => setParent(window));

describe('isFramed', () => {
  it('is false when the surface is its own top-level window', () => {
    setParent(window);
    expect(isFramed()).toBe(false);
  });

  it('is true when a different window is the parent', () => {
    setParent({ postMessage: () => {} });
    expect(isFramed()).toBe(true);
  });
});
