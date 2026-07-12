import { describe, it, expect } from 'vitest';
import { formatNairaFromMinor } from './naira';

describe('formatNairaFromMinor', () => {
  it('formats whole naira with no kobo', () => {
    expect(formatNairaFromMinor('500000')).toBe('₦5,000');
  });

  it('formats naira with kobo', () => {
    expect(formatNairaFromMinor('123456')).toBe('₦1,234.56');
  });

  it('pads a single-digit kobo remainder', () => {
    expect(formatNairaFromMinor('100005')).toBe('₦1,000.05');
  });

  it('groups thousands', () => {
    expect(formatNairaFromMinor('123456789000')).toBe('₦1,234,567,890');
  });

  it('stays exact beyond Number.MAX_SAFE_INTEGER', () => {
    const minor = '900719925474099100';
    expect(formatNairaFromMinor(minor)).toBe('₦9,007,199,254,740,991');
  });

  it('formats zero', () => {
    expect(formatNairaFromMinor('0')).toBe('₦0');
  });

  it('formats a small sub-naira kobo-only amount', () => {
    expect(formatNairaFromMinor('7')).toBe('₦0.07');
  });
});
