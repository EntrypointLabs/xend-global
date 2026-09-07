import { describe, it, expect } from 'vitest';
import { formatMoney } from './money';

describe('formatMoney', () => {
  it('formats whole naira with no kobo', () => {
    expect(formatMoney('NGN', '500000')).toBe('₦5,000');
  });

  it('formats naira with kobo', () => {
    expect(formatMoney('NGN', '123456')).toBe('₦1,234.56');
  });

  it('pads a single-digit kobo remainder', () => {
    expect(formatMoney('NGN', '100005')).toBe('₦1,000.05');
  });

  it('groups thousands', () => {
    expect(formatMoney('NGN', '123456789000')).toBe('₦1,234,567,890');
  });

  it('stays exact beyond Number.MAX_SAFE_INTEGER', () => {
    const minor = '900719925474099100';
    expect(formatMoney('NGN', minor)).toBe('₦9,007,199,254,740,991');
  });

  it('formats zero', () => {
    expect(formatMoney('NGN', '0')).toBe('₦0');
  });

  it('formats a small sub-naira kobo-only amount', () => {
    expect(formatMoney('NGN', '7')).toBe('₦0.07');
  });

  it('formats dollars for a Merchant pricing in the settlement asset', () => {
    expect(formatMoney('USD', '1234')).toBe('$12.34');
    expect(formatMoney('USD', '500000')).toBe('$5,000');
  });

  it('falls back to the code rather than failing to render', () => {
    // A shopper is better served by a readable figure with an unfamiliar
    // prefix than by a popup that throws on the confirm sheet.
    expect(formatMoney('ZAR', '123456')).toBe('ZAR 1,234.56');
  });
});
