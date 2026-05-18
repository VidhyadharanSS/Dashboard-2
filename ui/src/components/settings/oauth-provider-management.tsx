import { useCallback, useMemo, useState } from 'react'
import {
  IconEdit,
  IconKey,
  IconLock,
  IconLockOpen,
  IconPlus,
  IconShieldLock,
  IconTrash,
} from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { OAuthProvider } from '@/types/api'
import {
  createOAuthProvider,
  deleteOAuthProvider,
  OAuthProviderCreateRequest,
  OAuthProviderUpdateRequest,
  updateAuthSettings,
  updateOAuthProvider,
  useAuthSettings,
  useOAuthProviderList,
} from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog'

import { Action, ActionTable } from '../action-table'
import { OAuthProviderDialog } from './oauth-provider-dialog'

export function OAuthProviderManagement() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  // Auth settings (password login toggle)
  const { data: authSettings } = useAuthSettings()

  // Use real API to fetch OAuth providers
  const { data: providers = [], isLoading, error } = useOAuthProviderList()

  // Toggle password login mutation
  const togglePasswordMutation = useMutation({
    mutationFn: (disabled: boolean) =>
      updateAuthSettings({ passwordLoginDisabled: disabled }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['auth-settings'] })
      // Also refresh the providers list since it may now include/exclude "password"
      queryClient.invalidateQueries({ queryKey: ['providers'] })
      toast.success(data.message || 'Authentication settings updated')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update authentication settings')
    },
  })

  const [showProviderDialog, setShowProviderDialog] = useState(false)
  const [editingProvider, setEditingProvider] = useState<OAuthProvider | null>(
    null
  )
  const [deletingProvider, setDeletingProvider] =
    useState<OAuthProvider | null>(null)
  const getStatusBadge = useCallback(
    (provider: OAuthProvider) => {
      if (!provider.enabled) {
        return (
          <Badge variant="secondary">{t('common.disabled', 'Disabled')}</Badge>
        )
      }
      return <Badge variant="default">{t('common.enabled', 'Enabled')}</Badge>
    },
    [t]
  )

  const columns = useMemo<ColumnDef<OAuthProvider>[]>(
    () => [
      {
        id: 'name',
        header: t('common.name', 'Name'),
        cell: ({ row: { original: provider } }) => (
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{provider.name}</span>
            </div>
            {provider.scopes && (
              <div className="text-sm text-muted-foreground">
                Scopes: {provider.scopes}
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'clientId',
        header: t('oauthManagement.table.clientId', 'Client ID'),
        cell: ({ row: { original: provider } }) => (
          <code className="text-sm bg-muted px-2 py-1 rounded">
            {provider.clientId}
          </code>
        ),
      },
      {
        id: 'issuer',
        header: t('oauthManagement.table.issuer', 'Issuer'),
        cell: ({ row: { original: provider } }) => (
          <div className="text-sm text-muted-foreground">
            {provider.issuer || '-'}
          </div>
        ),
      },
      {
        id: 'status',
        header: t('common.status', 'Status'),
        cell: ({ row: { original: provider } }) => (
          <div className="flex items-center gap-3">
            {getStatusBadge(provider)}
          </div>
        ),
      },
    ],
    [getStatusBadge, t]
  )

  const actions = useMemo<Action<OAuthProvider>[]>(
    () => [
      {
        label: (
          <>
            <IconEdit className="h-4 w-4" />
            {t('common.edit', 'Edit')}
          </>
        ),
        onClick: (provider) => {
          setEditingProvider(provider)
          setShowProviderDialog(true)
        },
      },
      {
        label: (
          <div className="inline-flex items-center gap-2 text-destructive">
            <IconTrash className="h-4 w-4" />
            {t('common.delete', 'Delete')}
          </div>
        ),
        onClick: (provider) => {
          setDeletingProvider(provider)
        },
      },
    ],
    [t]
  )

  // Create provider mutation
  const createMutation = useMutation({
    mutationFn: createOAuthProvider,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oauth-provider-list'] })
      toast.success(
        t(
          'oauthManagement.messages.created',
          'OAuth provider created successfully'
        )
      )
      setShowProviderDialog(false)
    },
    onError: (error: Error) => {
      toast.error(
        error.message ||
          t(
            'oauthManagement.messages.createError',
            'Failed to create OAuth provider'
          )
      )
    },
  })

  // Update provider mutation
  const updateMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number
      data: OAuthProviderUpdateRequest
    }) => updateOAuthProvider(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oauth-provider-list'] })
      toast.success(
        t(
          'oauthManagement.messages.updated',
          'OAuth provider updated successfully'
        )
      )
      setShowProviderDialog(false)
      setEditingProvider(null)
    },
    onError: (error: Error) => {
      toast.error(
        error.message ||
          t(
            'oauthManagement.messages.updateError',
            'Failed to update OAuth provider'
          )
      )
    },
  })

  // Delete provider mutation
  const deleteMutation = useMutation({
    mutationFn: deleteOAuthProvider,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oauth-provider-list'] })
      toast.success(
        t(
          'oauthManagement.messages.deleted',
          'OAuth provider deleted successfully'
        )
      )
      setDeletingProvider(null)
    },
    onError: (error: Error) => {
      toast.error(
        error.message ||
          t(
            'oauthManagement.messages.deleteError',
            'Failed to delete OAuth provider'
          )
      )
    },
  })

  const handleSubmitProvider = (providerData: OAuthProviderCreateRequest) => {
    if (editingProvider) {
      // Update existing provider
      const updateData: OAuthProviderUpdateRequest = {
        ...providerData,
        // If clientSecret is empty in edit mode, don't send it
        ...(providerData.clientSecret
          ? { clientSecret: providerData.clientSecret }
          : {}),
      }
      updateMutation.mutate({
        id: editingProvider.id,
        data: updateData,
      })
    } else {
      // Create new provider
      createMutation.mutate(providerData)
    }
  }

  const handleDeleteProvider = () => {
    if (!deletingProvider) return
    deleteMutation.mutate(deletingProvider.id)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground">
          {t('common.loading', 'Loading...')}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-destructive">
          {t(
            'oauthManagement.errors.loadFailed',
            'Failed to load OAuth providers'
          )}
        </div>
      </div>
    )
  }

  const passwordDisabled = authSettings?.passwordLoginDisabled ?? false
  const envLocked = authSettings?.passwordLoginEnvLocked ?? false
  const hasOAuthProviders = providers.length > 0 && providers.some((p) => p.enabled)

  return (
    <div className="space-y-6">
      {/* Password Login Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconShieldLock className="h-5 w-5" />
            {t('oauthManagement.authSettings', 'Authentication Settings')}
          </CardTitle>
          <CardDescription>
            {t(
              'oauthManagement.authSettingsDescription',
              'Control which authentication methods are available on the login page.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Password login toggle */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5 flex-1">
                <div className="flex items-center gap-2">
                  {passwordDisabled ? (
                    <IconLock className="h-4 w-4 text-destructive" />
                  ) : (
                    <IconLockOpen className="h-4 w-4 text-green-500" />
                  )}
                  <Label htmlFor="password-login-toggle" className="text-sm font-medium">
                    {t('oauthManagement.passwordLogin', 'Password Login')}
                  </Label>
                  {envLocked && (
                    <Badge variant="outline" className="text-xs">
                      {t('oauthManagement.envLocked', 'Locked by env')}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {passwordDisabled
                    ? t(
                        'oauthManagement.passwordLoginDisabledDesc',
                        'Password login is disabled. Users must authenticate via an OAuth provider.'
                      )
                    : t(
                        'oauthManagement.passwordLoginEnabledDesc',
                        'Users can sign in with username and password. Disable this if all users authenticate via OAuth.'
                      )}
                </p>
              </div>
              <Switch
                id="password-login-toggle"
                checked={!passwordDisabled}
                disabled={envLocked || togglePasswordMutation.isPending}
                onCheckedChange={(checked) => {
                  togglePasswordMutation.mutate(!checked)
                }}
              />
            </div>

            {/* Warning if disabling password without OAuth providers */}
            {passwordDisabled && !hasOAuthProviders && (
              <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                <strong>⚠️ {t('common.warning', 'Warning')}:</strong>{' '}
                {t(
                  'oauthManagement.noOAuthWarning',
                  'Password login is disabled but no OAuth providers are enabled. Users will not be able to log in. Please configure at least one OAuth provider below.'
                )}
              </div>
            )}

            {/* Info banner when env-locked */}
            {envLocked && (
              <div className="rounded-lg border border-blue-500/50 bg-blue-500/10 p-3 text-sm text-blue-700 dark:text-blue-400">
                <strong>ℹ️ {t('common.info', 'Info')}:</strong>{' '}
                {t(
                  'oauthManagement.envLockedInfo',
                  'Password login is controlled by the DISABLE_PASSWORD_LOGIN environment variable. To change this setting, update the environment variable and restart the application.'
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* OAuth Provider Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <IconKey className="h-5 w-5" />
                {t('oauthManagement.title', 'OAuth Provider Management')}
              </CardTitle>
            </div>
            <Button
              onClick={() => {
                setEditingProvider(null)
                setShowProviderDialog(true)
              }}
              className="gap-2"
            >
              <IconPlus className="h-4 w-4" />
              {t('oauthManagement.actions.add', 'Add Provider')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ActionTable actions={actions} data={providers} columns={columns} />

          {providers.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <IconKey className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>
                {t(
                  'oauthManagement.empty.title',
                  'No OAuth providers configured'
                )}
              </p>
              <p className="text-sm mt-1">
                {t(
                  'oauthManagement.empty.description',
                  'Add your first OAuth provider'
                )}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Provider Dialog (Add/Edit) */}
      <OAuthProviderDialog
        open={showProviderDialog}
        onOpenChange={(open) => {
          setShowProviderDialog(open)
          if (!open) {
            setEditingProvider(null)
          }
        }}
        provider={editingProvider}
        onSubmit={handleSubmitProvider}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        open={!!deletingProvider}
        onOpenChange={() => setDeletingProvider(null)}
        onConfirm={handleDeleteProvider}
        resourceName={deletingProvider?.name || ''}
        resourceType="OAuth provider"
        additionalNote={t(
          'oauthManagement.deleteConfirmation',
          'This action will remove the OAuth provider configuration. Users will no longer be able to login using this provider.'
        )}
      />
    </div>
  )
}

