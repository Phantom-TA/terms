import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppShell } from './AppShell';
import { AppLoading, HomeRedirect, NotFound, RequireRole, RouteError } from './pages';
import { screens } from './screens';
import { SessionGate } from './SessionGate';

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    HydrateFallback: AppLoading,
    children: [
      {
        element: <SessionGate />,
        children: [
          { index: true, element: <HomeRedirect /> },
          ...screens.map((screen) => ({
            element: <RequireRole roles={screen.roles} />,
            children: [{ path: screen.path, lazy: screen.load }],
          })),
        ],
      },
      // Internal only. `import.meta.env.DEV` is false in builds, so Vite drops this route.
      ...(import.meta.env.DEV
        ? [
            {
              path: 'style-guide',
              lazy: () => import('../screens/style-guide/StyleGuide'),
            },
          ]
        : []),
      { path: '*', element: <NotFound /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
