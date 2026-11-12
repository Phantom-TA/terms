import { type BusinessRole, webPaths } from '@terms/shared';

export interface ScreenDef {
  path: string;
  label: string;
  roles: readonly BusinessRole[];
  load: () => Promise<{ Component: React.ComponentType }>;
  /** Reached by a link, not listed in the navigation. */
  hidden?: boolean;
}

/**
 * Every screen in the app. The navigation and router are built from this list, so a screen
 * appears only once it exists and there are no dead links. Add a screen here when it is built.
 */
export const screens: readonly ScreenDef[] = [
  // First for a client, so it is the client's home.
  {
    path: '/payables',
    label: 'Payables Desk',
    roles: ['CLIENT'],
    load: () => import('../screens/payables/PayablesDesk'),
  },
  {
    path: '/workbench',
    label: 'Workbench',
    roles: ['SUPPLIER'],
    load: () => import('../screens/workbench/Workbench'),
  },
  {
    path: '/negotiation',
    label: 'Negotiation Room',
    roles: ['SUPPLIER'],
    load: () => import('../screens/negotiation/NegotiationRoom'),
  },
  {
    path: '/studio',
    label: 'Cash Studio',
    roles: ['SUPPLIER'],
    load: () => import('../screens/studio/CashStudio'),
  },
  {
    path: '/approvals',
    label: 'Approvals',
    roles: ['SUPPLIER', 'CLIENT'],
    load: () => import('../screens/approvals/ApprovalsInbox'),
  },
  {
    path: '/audit',
    label: 'Audit trail',
    roles: ['SUPPLIER', 'CLIENT'],
    load: () => import('../screens/audit/AuditTrail'),
  },
  {
    path: '/connect',
    label: 'Connect & import',
    roles: ['SUPPLIER'],
    load: () => import('../screens/connect/ConnectImport'),
  },
  {
    path: '/settings',
    label: 'Settings',
    roles: ['SUPPLIER', 'CLIENT'],
    load: () => import('../screens/settings/Settings'),
  },
  // Where PayPal sends a person back after saving a payment method.
  {
    path: webPaths.vaultReturn(),
    label: 'Saving your PayPal method',
    roles: ['CLIENT'],
    load: () => import('../screens/payables/VaultReturn'),
    hidden: true,
  },
  {
    path: webPaths.vaultCancel(),
    label: 'Nothing was saved',
    roles: ['CLIENT'],
    load: () => import('../screens/payables/VaultCancel'),
    hidden: true,
  },
];

/** The screens a business can open from the navigation. */
export function screensFor(role: BusinessRole): readonly ScreenDef[] {
  return screens.filter((screen) => screen.roles.includes(role) && screen.hidden !== true);
}

/** Where a business lands after choosing a session; null if it has no screens yet. */
export function homePathFor(role: BusinessRole): string | null {
  return screensFor(role)[0]?.path ?? null;
}
