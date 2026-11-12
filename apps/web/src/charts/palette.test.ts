/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHART_COLORS } from './palette';

// Vitest skips CSS imports, so read the token file directly.
const tokens = readFileSync(join(import.meta.dirname, '../styles/tokens.css'), 'utf8');

const TOKEN_FOR: Record<keyof typeof CHART_COLORS, string> = {
  committed: '--color-committed',
  planned: '--color-info',
  before: '--color-ink-3',
  bestEffort: '',
  danger: '--color-danger',
  rule: '--color-rule',
  ink: '--color-ink',
};

describe('chart palette', () => {
  it.each(Object.entries(TOKEN_FOR).filter(([, token]) => token !== ''))(
    'matches the %s design token',
    (name, token) => {
      const match = new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens);
      expect(match?.[1]?.toLowerCase()).toBe(CHART_COLORS[name as keyof typeof CHART_COLORS]);
    },
  );
});
