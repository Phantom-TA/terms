import { describe, expect, it } from 'vitest';
import { plainMoney } from '../../lib/display';
import {
  displayMoney,
  validateAmount,
  validateDate,
  validateOpening,
  validatePercent,
} from './goalFields';

describe('goal field validation', () => {
  it.each(['6200', '$6,200', '6,200.50', ' 6200 '])('accepts the amount %s', (raw) => {
    expect(validateAmount(raw)).toBeNull();
  });
  it.each(['', 'abc', '0', '$0.00', '-5', '12.345'])('rejects the amount "%s"', (raw) => {
    expect(validateAmount(raw)).not.toBeNull();
  });

  it('accepts only real calendar dates', () => {
    expect(validateDate('2026-11-13')).toBeNull();
    expect(validateDate('2026-02-30')).not.toBeNull();
    expect(validateDate('Friday')).not.toBeNull();
  });

  it.each(['1.2', '1.2%', '0.80', '100'])('accepts the percentage %s', (raw) => {
    expect(validatePercent(raw)).toBeNull();
  });
  it.each(['', 'x', '101', '1.234', '-1'])('rejects the percentage "%s"', (raw) => {
    expect(validatePercent(raw)).not.toBeNull();
  });

  it('keeps the opening discount at or below the maximum', () => {
    expect(validateOpening('0.8', '1.20')).toBeNull();
    expect(validateOpening('1.2', '1.20')).toBeNull();
    expect(validateOpening('1.3', '1.20')).toMatch(/above your 1.20% maximum/);
    expect(validateOpening('nope', '1.20')).not.toBeNull();
  });

  it('formats money for display and for editing', () => {
    expect(displayMoney('6200.00')).toBe('$6,200');
    expect(displayMoney('6200.50')).toBe('$6,200.50');
    expect(plainMoney('6200.00')).toBe('6200');
    expect(plainMoney('6200.50')).toBe('6200.50');
  });
});
