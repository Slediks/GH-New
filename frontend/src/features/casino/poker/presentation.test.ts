import { describe, expect, it } from 'vitest';
import { amountText, parseAmount, presetTotal, raiseRange } from './presentation';
describe('poker sizing uses server limits and integer hundredths', () => {
  it('accepts exact hundredths and rejects incomplete or unsafe inputs', () => {
    expect(parseAmount('12,34')).toBe(1234);
    expect(parseAmount('0.01')).toBe(1);
    for (const text of ['', '-', 'NaN', '1.234', '-5', '1e4', '999999999999999999'])
      expect(parseAmount(text)).toBeNull();
    expect(amountText(40005)).toBe('400.05');
  });
  it('supports a short all-in as the only raise size', () => {
    expect(raiseRange({ raise_min: 2000, raise_max: 1500 })).toEqual({ min: 1500, max: 1500 });
  });
  it('counts the call before pot-relative raises and clamps presets', () => {
    expect(presetTotal(1500, 1000, 1000, 1, 2, 2000, 40000)).toBe(2250);
    expect(presetTotal(1500, 1000, 1000, 3, 4, 2000, 40000)).toBe(2875);
    expect(presetTotal(0, 0, 0, 1, 2, 1000, 40000)).toBe(1000);
    expect(presetTotal(100000, 1000, 1000, 1, 1, 2000, 40000)).toBe(40000);
  });
});
