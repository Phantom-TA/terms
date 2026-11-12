import clsx from 'clsx';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { pendingApprovals, useApprovals, useApprovalsLive } from '../screens/approvals/queries';
import { Badge } from '../ui/Badge';
import { LiveIndicator } from './LiveIndicator';
import { SandboxBand } from './SandboxBand';
import { screensFor } from './screens';
import { useSession } from './session';
import { SessionSwitcher } from './SessionSwitcher';

function navClass({ isActive }: { isActive: boolean }) {
  return clsx(
    'inline-block border-b-2 py-3 text-base whitespace-nowrap',
    isActive
      ? 'border-ink font-medium text-ink'
      : 'border-transparent text-ink-2 hover:border-rule-strong hover:text-ink',
  );
}

/** How many approvals wait for this business, shown beside the Approvals link. */
function ApprovalsCount() {
  const approvals = useApprovals();
  const count = approvals.data ? pendingApprovals(approvals.data).length : 0;
  if (count === 0) return null;
  return (
    <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-warn px-1.5 text-xs font-medium text-on-ink">
      {count}
      <span className="sr-only"> waiting</span>
    </span>
  );
}

/** Mounted only with a session, because the approvals belong to one. */
function SessionWatchers() {
  useApprovalsLive();
  return null;
}

export function AppShell() {
  const session = useSession();
  const role = session.data?.business.role ?? null;
  const links = role ? screensFor(role) : [];

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-1.5"
      >
        Skip to content
      </a>
      <header className="border-b border-rule bg-surface">
        <SandboxBand />
        <div className="flex flex-wrap items-center gap-x-8 px-4 lg:px-6">
          <Link to="/" className="py-2 font-display text-lg leading-none text-ink">
            Terms
          </Link>
          {links.length > 0 ? (
            <nav
              aria-label="Main"
              className="order-last w-full overflow-x-auto lg:order-none lg:w-auto"
            >
              <ul className="flex gap-6">
                {links.map((screen) => (
                  <li key={screen.path}>
                    <NavLink to={screen.path} className={navClass}>
                      {screen.label}
                      {screen.path === '/approvals' ? <ApprovalsCount /> : null}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          <div className="ml-auto flex items-center gap-4 py-2">
            <LiveIndicator />
            {role ? <Badge>{role === 'SUPPLIER' ? 'Owner' : 'Client'}</Badge> : null}
            <SessionSwitcher />
          </div>
        </div>
      </header>
      {role ? <SessionWatchers /> : null}
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        <Outlet />
      </main>
    </div>
  );
}
