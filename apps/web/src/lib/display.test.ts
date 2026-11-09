import { ActionType, DealState, isCommitted, PolicyRule } from '@terms/shared';
import { describe, expect, it } from 'vitest';
import {
  ACTION_LABEL,
  DEAL_STATE_DISPLAY,
  formatDate,
  formatDueIn,
  formatPercent,
  POLICY_RULE_LABEL,
} from './display';

describe('display mappings', () => {
  it('names every deal state, action and policy rule', () => {
    for (const state of DealState.options) expect(DEAL_STATE_DISPLAY[state].label).not.toBe('');
    for (const action of ActionType.options) expect(ACTION_LABEL[action]).not.toBe('');
    for (const rule of PolicyRule.options) expect(POLICY_RULE_LABEL[rule]).not.toBe('');
  });

  it('uses the accent for exactly the states that count as committed', () => {
    for (const state of DealState.options) {
      const accent = DEAL_STATE_DISPLAY[state].tone.startsWith('committed');
      expect(accent, state).toBe(isCommitted(state));
    }
  });
});

describe('formatters', () => {
  it('formats a calendar date without a time-zone shift', () => {
    expect(formatDate('2026-11-13')).toBe('Fri, Nov 13');
  });

  it.each([
    [18, 'in 18 days'],
    [1, 'in 1 day'],
    [0, 'due today'],
    [-1, '1 day overdue'],
    [-6, '6 days overdue'],
  ])('formats %i days until due', (days, expected) => {
    expect(formatDueIn(days)).toBe(expected);
  });

  it.each([
    ['1.20', '1.2%'],
    ['1.25', '1.25%'],
    ['1.00', '1%'],
    ['0.80', '0.8%'],
    ['10.00', '10%'],
  ])('trims %s', (value, expected) => {
    expect(formatPercent(value)).toBe(expected);
  });
});
