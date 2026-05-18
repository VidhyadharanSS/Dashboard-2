import { createBrowserRouter } from 'react-router-dom'

import App from './App'
import { AdminRoute } from './components/admin-route'
import { InitCheckRoute } from './components/init-check-route'
import { ProtectedRoute } from './components/protected-route'
import { RouteErrorFallback } from './components/route-error-fallback'
import { getSubPath } from './lib/subpath'
import { CRListPage } from './pages/cr-list-page'
import { InitializationPage } from './pages/initialization'
import { LoginPage } from './pages/login'
import { Overview } from './pages/overview'
import { PrometheusPage } from './pages/prometheus-page'
import { ResourceDetail } from './pages/resource-detail'
import { ResourceList } from './pages/resource-list'
import { SettingsPage } from './pages/settings'
import { ClusterEventsPage } from './pages/cluster-events-page'
import { TutorialPage } from './pages/tutorial-page'
import { ExpressionSearchPage } from './pages/expression-search-page'

const subPath = getSubPath()

export const router = createBrowserRouter(
  [
    {
      path: '/setup',
      element: <InitializationPage />,
      errorElement: <RouteErrorFallback />,
    },
    {
      path: '/login',
      element: (
        <InitCheckRoute>
          <LoginPage />
        </InitCheckRoute>
      ),
      errorElement: <RouteErrorFallback />,
    },
    {
      path: '/',
      element: (
        <InitCheckRoute>
          <ProtectedRoute>
            <App />
          </ProtectedRoute>
        </InitCheckRoute>
      ),
      errorElement: <RouteErrorFallback />,
      children: [
        {
          index: true,
          element: <Overview />,
          errorElement: <RouteErrorFallback />,
        },
        {
          path: 'dashboard',
          element: <Overview />,
          errorElement: <RouteErrorFallback />,
        },
        {
          path: 'settings',
          element: (
            <AdminRoute>
              <SettingsPage />
            </AdminRoute>
          ),
          errorElement: <RouteErrorFallback />,
        },
        {
          path: 'events',
          element: <ClusterEventsPage />,
          errorElement: <RouteErrorFallback />,
        },
        {
          path: 'tutorials',
          element: <TutorialPage />,
          errorElement: <RouteErrorFallback />,
        },
        {
          path: 'expression-search',
          element: <ExpressionSearchPage />,
          errorElement: <RouteErrorFallback />,
        },
        {
          path: 'prometheus',
          element: <PrometheusPage />,
          errorElement: <RouteErrorFallback />,
        },
        {
          path: 'crds/:crd',
          element: <CRListPage />,
          errorElement: <RouteErrorFallback />,
        },
        {
          path: 'crds/:resource/:namespace/:name',
          element: <ResourceDetail />,
          errorElement: <RouteErrorFallback />,
        },
        {
          path: 'crds/:resource/:name',
          element: <ResourceDetail />,
          errorElement: <RouteErrorFallback />,
        },
        {
          path: ':resource/:name',
          element: <ResourceDetail />,
          errorElement: <RouteErrorFallback />,
        },
        {
          path: ':resource',
          element: <ResourceList />,
          errorElement: <RouteErrorFallback />,
        },
        {
          path: ':resource/:namespace/:name',
          element: <ResourceDetail />,
          errorElement: <RouteErrorFallback />,
        },
      ],
    },
  ],
  {
    basename: subPath,
  }
)
