import { createBrowserRouter } from 'react-router-dom'

import App from './App'
import { AdminRoute } from './components/admin-route'
import { InitCheckRoute } from './components/init-check-route'
import { ProtectedRoute } from './components/protected-route'
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
    },
    {
      path: '/login',
      element: (
        <InitCheckRoute>
          <LoginPage />
        </InitCheckRoute>
      ),
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
      children: [
        {
          index: true,
          element: <Overview />,
        },
        {
          path: 'dashboard',
          element: <Overview />,
        },
        {
          path: 'settings',
          element: (
            <AdminRoute>
              <SettingsPage />
            </AdminRoute>
          ),
        },
        {
          path: 'events',
          element: <ClusterEventsPage />,
        },
        {
          path: 'tutorials',
          element: <TutorialPage />,
        },
        {
          path: 'expression-search',
          element: <ExpressionSearchPage />,
        },
        {
          path: 'prometheus',
          element: <PrometheusPage />,
        },
        {
          path: 'crds/:crd',
          element: <CRListPage />,
        },
        {
          path: 'crds/:resource/:namespace/:name',
          element: <ResourceDetail />,
        },
        {
          path: 'crds/:resource/:name',
          element: <ResourceDetail />,
        },
        {
          path: ':resource/:name',
          element: <ResourceDetail />,
        },
        {
          path: ':resource',
          element: <ResourceList />,
        },
        {
          path: ':resource/:namespace/:name',
          element: <ResourceDetail />,
        },
      ],
    },
  ],
  {
    basename: subPath,
  }
)
