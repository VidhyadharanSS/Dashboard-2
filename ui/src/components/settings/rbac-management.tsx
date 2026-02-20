import { useMemo, useState } from 'react'
import {
  IconEdit,
  IconPlus,
  IconShieldCheck,
  IconTrash,
  IconCopy,
  IconSearch,
  IconShield,
} from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Role } from '@/types/api'
import {
  assignRole,
  createRole,
  deleteRole,
  unassignRole,
  updateRole,
  useRoleList,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog'

import { Action, ActionTable } from '../action-table'
import { Badge } from '../ui/badge'
import { RBACAssignmentDialog } from './rbac-assignment-dialog'
import { RBACDialog } from './rbac-dialog'

export function RBACManagement() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data: roles = [], isLoading, error } = useRoleList()

  const [showDialog, setShowDialog] = useState(false)
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [deletingRole, setDeletingRole] = useState<Role | null>(null)
  const [showAssignDialog, setShowAssignDialog] = useState(false)
  const [assigningRole, setAssigningRole] = useState<Role | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const filteredRoles = useMemo(() => {
    if (!searchQuery) return roles
    const q = searchQuery.toLowerCase()
    return roles.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.description?.toLowerCase().includes(q) ||
      r.resources.some(res => res.toLowerCase().includes(q))
    )
  }, [roles, searchQuery])

  const columns = useMemo<ColumnDef<Role>[]>(
    () => [
      {
        id: 'name',
        header: t('common.name', 'Name'),
        cell: ({ row: { original: r } }) => (
          <div>
            <div className="flex items-center">
              <span className="font-medium">{r.name}</span>{' '}
              {r.isSystem && <Badge variant="secondary">System</Badge>}
            </div>
            {r.description && (
              <div className="text-sm text-muted-foreground">
                {r.description}
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'clusters',
        header: 'Clusters',
        cell: ({ row: { original: r } }) => (
          <div className="text-sm text-muted-foreground">
            {r.clusters.length > 0 ? (
              r.clusters.join(', ')
            ) : (
              <span className="text-xs text-muted-foreground">-</span>
            )}
          </div>
        ),
      },
      {
        id: 'namespaces',
        header: 'Namespaces',
        cell: ({ row: { original: r } }) => (
          <div className="text-sm text-muted-foreground">
            {r.namespaces.length > 0 ? (
              r.namespaces.join(', ')
            ) : (
              <span className="text-xs text-muted-foreground">-</span>
            )}
          </div>
        ),
      },

      {
        id: 'Resources',
        header: 'Resources',
        cell: ({ row: { original: r } }) => (
          <div className="flex flex-wrap gap-1 max-w-[200px] items-center">
            {r.resources.length > 0 ? (
              r.resources.map(res => (
                <Badge key={res} variant="outline" className="text-[10px] px-1.5 py-0.5 leading-none h-4">{res}</Badge>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">-</span>
            )}
          </div>
        ),
      },
      {
        id: 'verbs',
        header: 'Verbs',
        cell: ({ row: { original: r } }) => (
          <div className="flex flex-wrap gap-1 max-w-[150px] items-center">
            {r.verbs.length > 0 ? (
              r.verbs.map(v => (
                <Badge key={v} variant="secondary" className="text-[10px] px-1.5 py-0.5 leading-none h-4">{v}</Badge>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">-</span>
            )}
          </div>
        ),
      },
      {
        id: 'assignments',
        header: 'Assignments',
        cell: ({ row: { original: r } }) => <AssignmentCell role={r} />,
      },
    ],
    [t]
  )

  const actions = useMemo<Action<Role>[]>(
    () => [
      {
        label: (
          <>
            <IconShieldCheck className="h-4 w-4" />
            {t('common.assign', 'Assign')}
          </>
        ),
        onClick: (r) => {
          setAssigningRole(r)
          setShowAssignDialog(true)
        },
      },
      {
        label: (
          <>
            <IconEdit className="h-4 w-4" />
            {t('common.edit', 'Edit')}
          </>
        ),
        shouldDisable: (role) => !!role.isSystem,
        onClick: (role) => {
          setEditingRole(role)
          setShowDialog(true)
        },
      },
      {
        label: (
          <>
            <IconCopy className="h-4 w-4" />
            {t('common.clone', 'Clone')}
          </>
        ),
        onClick: (role) => {
          const clonedRole: Role = {
            ...role,
            id: 0,
            name: `${role.name}-copy`,
            isSystem: false,
          }
          setEditingRole(clonedRole)
          setShowDialog(true)
        },
      },
      {
        label: (
          <div className="inline-flex items-center gap-2 text-destructive">
            <IconTrash className="h-4 w-4" />
            {t('common.delete', 'Delete')}
          </div>
        ),
        shouldDisable: (role) => !!role.isSystem,
        onClick: (role) => {
          setDeletingRole(role)
        },
      },
    ],
    [t]
  )

  const createMutation = useMutation({
    mutationFn: (data: Partial<Role>) => createRole(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['role-list'] })
      toast.success(t('rbac.messages.created', 'Role created'))
      setShowDialog(false)
    },
    onError: (err: Error) =>
      toast.error(
        err.message || t('rbac.messages.createError', 'Failed to create role')
      ),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Role> }) =>
      updateRole(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['role-list'] })
      toast.success(t('rbac.messages.updated', 'Role updated'))
      setShowDialog(false)
      setEditingRole(null)
    },
    onError: (err: Error) =>
      toast.error(
        err.message || t('rbac.messages.updateError', 'Failed to update role')
      ),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteRole(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['role-list'] })
      toast.success(t('rbac.messages.deleted', 'Role deleted'))
      setDeletingRole(null)
    },
    onError: (err: Error) =>
      toast.error(
        err.message || t('rbac.messages.deleteError', 'Failed to delete role')
      ),
  })

  const handleSubmitRole = (data: Partial<Role>) => {
    if (editingRole) {
      updateMutation.mutate({ id: editingRole.id, data })
    } else {
      createMutation.mutate(data)
    }
  }

  const handleDeleteRole = () => {
    if (!deletingRole) return
    deleteMutation.mutate(deletingRole.id)
  }

  const handleAssign = async (
    roleId: number,
    subjectType: 'user' | 'group',
    subject: string
  ) => {
    try {
      await assignRole(roleId, { subjectType, subject })
      await queryClient.invalidateQueries({ queryKey: ['role-list'] })

      // Update assigningRole with fresh data to show the new assignment immediately
      if (assigningRole?.id === roleId) {
        const updatedRoles = queryClient.getQueryData<Role[]>(['role-list'])
        const updatedRole = updatedRoles?.find((r) => r.id === roleId)
        if (updatedRole) {
          setAssigningRole(updatedRole)
        }
      }

      toast.success(t('rbac.messages.assigned', 'Assigned'))
    } catch (err: unknown) {
      toast.error(
        (err as Error).message ||
        t('rbac.messages.assignError', 'Failed to assign')
      )
    }
  }

  const handleUnassign = async (
    roleId: number,
    subjectType: 'user' | 'group',
    subject: string
  ) => {
    try {
      await unassignRole(roleId, subjectType, subject)
      await queryClient.invalidateQueries({ queryKey: ['role-list'] })

      if (assigningRole?.id === roleId) {
        const updatedRoles = queryClient.getQueryData<Role[]>(['role-list'])
        const updatedRole = updatedRoles?.find((r) => r.id === roleId)
        if (updatedRole) {
          setAssigningRole(updatedRole)
        }
      }

      toast.success(t('rbac.messages.unassigned', 'Unassigned'))
    } catch (err: unknown) {
      toast.error(
        (err as Error).message ||
        t('rbac.messages.unassignError', 'Failed to unassign')
      )
    }
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
          {t('rbac.errors.loadFailed', 'Failed to load roles')}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <IconShield className="h-5 w-5" />
              {t('rbac.title', 'RBAC Management')}
            </CardTitle>
            <div className="flex items-center gap-3">
              <div className="relative">
                <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t('common.search', 'Search...')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-64 h-9"
                />
              </div>
              <Button
                size="sm"
                onClick={() => {
                  setEditingRole(null)
                  setShowDialog(true)
                }}
                className="gap-2 h-9"
              >
                <IconPlus className="h-4 w-4" />
                {t('rbac.createRole', 'Create Role')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ActionTable
            data={filteredRoles}
            columns={columns}
            actions={actions}
          />
          {filteredRoles.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <IconShieldCheck className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{t('rbac.empty.title', 'No roles configured')}</p>
              <p className="text-sm mt-1">
                {t(
                  'rbac.empty.description',
                  'Create roles to grant permissions'
                )}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <RBACDialog
        open={showDialog}
        onOpenChange={(open) => {
          setShowDialog(open)
          if (!open) setEditingRole(null)
        }}
        role={editingRole}
        onSubmit={handleSubmitRole}
      />

      <RBACAssignmentDialog
        open={showAssignDialog}
        onOpenChange={(open) => {
          setShowAssignDialog(open)
          if (!open) setAssigningRole(null)
        }}
        role={assigningRole}
        onAssign={handleAssign}
        onUnassign={handleUnassign}
      />

      <DeleteConfirmationDialog
        open={!!deletingRole}
        onOpenChange={() => setDeletingRole(null)}
        onConfirm={handleDeleteRole}
        resourceName={deletingRole?.name || ''}
        resourceType="role"
      />
    </div>
  )
}

function AssignmentCell({ role: r }: { role: Role }) {
  const users = r.assignments?.filter((a) => a.subjectType === 'user') || []
  const groups = r.assignments?.filter((a) => a.subjectType === 'group') || []
  const maxShow = 2
  const [showAllUsers, setShowAllUsers] = useState(false)
  const [showAllGroups, setShowAllGroups] = useState(false)

  return (
    <div className="flex flex-wrap gap-1 text-xs max-w-[200px]">
      {(showAllUsers ? users : users.slice(0, maxShow)).map((a) => (
        <Badge key={a.id} variant="secondary" className="text-xs">
          user: {a.subject}
        </Badge>
      ))}
      {users.length > maxShow && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowAllUsers(!showAllUsers)
              }}
              className="inline-flex items-center justify-center h-5 px-2 text-xs border rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors"
            >
              {showAllUsers ? '- less' : `+${users.length - maxShow}`}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-3" align="start">
            <div className="space-y-2">
              <div className="font-medium text-sm">All Users ({users.length})</div>
              <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto">
                {users.map((a) => (
                  <Badge key={a.id} variant="secondary" className="text-xs">
                    {a.subject}
                  </Badge>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
      {(showAllGroups ? groups : groups.slice(0, maxShow)).map((a) => (
        <Badge key={a.id} variant="secondary" className="text-xs">
          group: {a.subject}
        </Badge>
      ))}
      {groups.length > maxShow && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowAllGroups(!showAllGroups)
              }}
              className="inline-flex items-center justify-center h-5 px-2 text-xs border rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors"
            >
              {showAllGroups ? '- less' : `+${groups.length - maxShow}`}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-3" align="start">
            <div className="space-y-2">
              <div className="font-medium text-sm">All Groups ({groups.length})</div>
              <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto">
                {groups.map((a) => (
                  <Badge key={a.id} variant="secondary" className="text-xs">
                    {a.subject}
                  </Badge>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
      {users.length === 0 && groups.length === 0 && (
        <span className="text-xs text-muted-foreground">-</span>
      )}
    </div>
  )
}

export default RBACManagement
