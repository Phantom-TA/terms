import { studioTheme } from 'ag-studio';

/**
 * Studio in the app's colours, from the design tokens, like the grid's theme. Its default accent
 * and step text are too faint on the paper surface for WCAG AA, so the accent is the focus blue
 * (the app's accent is reserved for committed cash) and quiet text is ink-3.
 */
export const termsStudioTheme = studioTheme.withParams({
  accentColor: 'var(--color-focus)',
  backgroundColor: 'var(--color-surface)',
  foregroundColor: 'var(--color-ink)',
  subtleTextColor: 'var(--color-ink-3)',
  borderColor: 'var(--color-rule)',
  browserColorScheme: 'light',
  fontFamily: "'IBM Plex Sans Variable', 'Helvetica Neue', Arial, sans-serif",
});
