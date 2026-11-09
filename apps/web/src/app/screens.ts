import { type BusinessRole } from '@terms/shared';

export interface ScreenDef {
  path: string;
  label: string;
  roles: readonly BusinessRole[];
  load: () => Promise<{ Component: React.ComponentType }>;
}

/**
 * Every screen in the app. The navigation and router are built from this list, so a screen
 * appears only once it exists and there are no dead links. Add a screen here when it is built.
 */
export const screens: readonly ScreenDef[] = [];

export function screensFor(role: BusinessRole): readonly ScreenDef[] {
  return screens.filter((screen) => screen.roles.includes(role));
}

/** Where a business lands after choosing a session; null if it has no screens yet. */
export function homePathFor(role: BusinessRole): string | null {
  return screensFor(role)[0]?.path ?? null;
}
