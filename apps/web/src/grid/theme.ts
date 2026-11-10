import { themeQuartz } from 'ag-grid-community';

/**
 * The Workbench's ledger look: paper surface, hairline rows, no column rules. Colours point at the
 * design tokens so the grid and the app can't drift apart. Selection and focus use the focus blue,
 * because the accent is reserved for committed cash.
 */
export const termsGridTheme = themeQuartz.withParams({
  accentColor: 'var(--color-focus)',
  backgroundColor: 'var(--color-surface)',
  foregroundColor: 'var(--color-ink)',
  textColor: 'var(--color-ink)',
  subtleTextColor: 'var(--color-ink-3)',
  borderColor: 'var(--color-rule)',
  browserColorScheme: 'light',
  fontFamily: "'IBM Plex Sans Variable', 'Helvetica Neue', Arial, sans-serif",
  fontSize: 13,
  headerFontSize: 12,
  headerFontWeight: 500,
  headerBackgroundColor: 'var(--color-sunken)',
  headerTextColor: 'var(--color-ink-2)',
  headerHeight: 34,
  rowHeight: 42,
  cellHorizontalPadding: 12,
  columnBorder: false,
  headerColumnBorder: false,
  rowBorder: { color: 'var(--color-rule)', width: 1, style: 'solid' },
  wrapperBorder: { color: 'var(--color-rule)', width: 1, style: 'solid' },
  wrapperBorderRadius: 8,
  rowHoverColor: 'var(--color-paper)',
  selectedRowBackgroundColor: 'var(--color-info-soft)',
  oddRowBackgroundColor: 'var(--color-surface)',
  iconSize: 14,
  // A cell a live update changed flashes this, then fades.
  valueChangeValueHighlightBackgroundColor: 'var(--color-committed-soft)',
});
