import 'vitest';

declare module 'vitest' {
  interface Matchers {
    toHaveNoViolations(): void;
  }
}
