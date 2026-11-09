/**
 * Chart colours. AG Charts takes colour strings, not CSS variables, so these mirror
 * src/styles/tokens.css. palette.test.ts fails if they drift apart.
 */
export const CHART_COLORS = {
  /** Cash committed: the accent. */
  committed: '#0b6b57',
  /** Cash the plan would commit if every offer is accepted. */
  planned: '#255290',
  /** The runway with no plan. */
  before: '#68635a',
  /** Reminders: best effort, never counted. */
  bestEffort: '#86827a',
  /** The payroll line and the zero line. */
  danger: '#a12d25',
  rule: '#e0dbd0',
  ink: '#1c1b18',
} as const;
