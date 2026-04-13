import { useTranslation } from 'react-i18next'
import {
  IconKey,
  IconLock,
  IconServer,
  IconSettings,
  IconShield,
  IconTemplate,
  IconUsers,
  IconHistory,
  IconDeviceDesktop,
} from '@tabler/icons-react'

import { usePageTitle } from '@/hooks/use-page-title'
import { ResponsiveTabs } from '@/components/ui/responsive-tabs'
import { APIKeyManagement } from '@/components/settings/apikey-management'
import { AuditLog } from '@/components/settings/audit-log'
import { ClusterManagement } from '@/components/settings/cluster-management'
import { OAuthProviderManagement } from '@/components/settings/oauth-provider-management'
import { RBACManagement } from '@/components/settings/rbac-management'
import { TemplateManagement } from '@/components/settings/template-management'
import { UserManagement } from '@/components/settings/user-management'
import { SessionManagement } from '@/components/settings/session-management'


export function SettingsPage() {
  const { t } = useTranslation()

  usePageTitle('Settings')

  return (
    <div className="space-y-2 animate-page-enter">
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <IconSettings className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gradient">{t('settings.title', 'Settings')}</h1>
            <p className="text-muted-foreground text-sm">
              {t('settings.description', 'Manage clusters, roles and permissions')}
            </p>
          </div>
        </div>
      </div>

      <ResponsiveTabs
        tabs={[
          {
            value: 'clusters',
            label: (
              <span className="flex items-center gap-1.5">
                <IconServer className="h-3.5 w-3.5" />
                {t('settings.tabs.clusters', 'Cluster')}
              </span>
            ),
            content: <ClusterManagement />,
          },
          {
            value: 'oauth',
            label: (
              <span className="flex items-center gap-1.5">
                <IconLock className="h-3.5 w-3.5" />
                {t('settings.tabs.oauth', 'OAuth')}
              </span>
            ),
            content: <OAuthProviderManagement />,
          },
          {
            value: 'rbac',
            label: (
              <span className="flex items-center gap-1.5">
                <IconShield className="h-3.5 w-3.5" />
                {t('settings.tabs.rbac', 'RBAC')}
              </span>
            ),
            content: <RBACManagement />,
          },
          {
            value: 'users',
            label: (
              <span className="flex items-center gap-1.5">
                <IconUsers className="h-3.5 w-3.5" />
                {t('settings.tabs.users', 'User')}
              </span>
            ),
            content: <UserManagement />,
          },
          {
            value: 'apikeys',
            label: (
              <span className="flex items-center gap-1.5">
                <IconKey className="h-3.5 w-3.5" />
                {t('settings.tabs.apikeys', 'API Keys')}
              </span>
            ),
            content: <APIKeyManagement />,
          },
          {
            value: 'templates',
            label: (
              <span className="flex items-center gap-1.5">
                <IconTemplate className="h-3.5 w-3.5" />
                {t('settings.tabs.templates', 'Templates')}
              </span>
            ),
            content: <TemplateManagement />,
          },
          {
            value: 'sessions',
            label: (
              <span className="flex items-center gap-1.5">
                <IconDeviceDesktop className="h-3.5 w-3.5" />
                {t('settings.tabs.sessions', 'Sessions')}
              </span>
            ),
            content: <SessionManagement />,
          },
          {
            value: 'audit',
            label: (
              <span className="flex items-center gap-1.5">
                <IconHistory className="h-3.5 w-3.5" />
                {t('settings.tabs.audit', 'Audit')}
              </span>
            ),
            content: <AuditLog />,
          },
        ]}
      />
    </div>
  )
}
