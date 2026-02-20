import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Avatar from '@radix-ui/react-avatar'
import {
  IconEdit,
  IconLock,
  IconLockOpen,
  IconPlus,
  IconSearch,
  IconShieldCheck,
  IconTrash,
  IconUpload,
  IconUser,
} from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ColumnDef,
  getCoreRowModel,
  PaginationState,
  RowSelectionState,
  SortingState,
  useReactTable,
} from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { UserItem } from '@/types/api'
import {
  batchCreateUsers,
  batchDeleteUsers,
  createPasswordUser,
  deleteUser,
  resetUserPassword,
  setUserEnabled,
  updateUser,
  useRoleList,
  useUserList,
} from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog'
import { ResourceTableView } from '@/components/resource-table-view'
import { Checkbox } from '@/components/ui/checkbox'

import { Action } from '../action-table'
import { Badge } from '../ui/badge'
import UserRoleAssignment from './user-role-assignment'

export function UserManagement() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const [sorting, setSorting] = useState<SortingState>([])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const { data: roles = [] } = useRoleList()

  const sortParams = useMemo(() => {
    if (sorting.length === 0) {
      return { sortBy: '', sortOrder: '' }
    }
    const [primary] = sorting
    return {
      sortBy: primary.id,
      sortOrder: primary.desc ? 'desc' : 'asc',
    }
  }, [sorting])

  const { data, isLoading, error } = useUserList(
    pagination.pageIndex + 1,
    pagination.pageSize,
    searchQuery,
    sortParams.sortBy,
    sortParams.sortOrder,
    roleFilter
  )

  const getStatusBadge = useCallback(
    (user: UserItem) => {
      if (!user.enabled) {
        return (
          <Badge variant="secondary">{t('common.disabled', 'Disabled')}</Badge>
        )
      }
      return <Badge variant="default">{t('common.enabled', 'Enabled')}</Badge>
    },
    [t]
  )

  const handleToggleEnable = useCallback(
    async (u: UserItem) => {
      await setUserEnabled(u.id, !u.enabled)
      queryClient.invalidateQueries({ queryKey: ['user-list'] })
      toast.success(t('userManagement.messages.updated', 'User updated'))
    },
    [queryClient, t]
  )

  const [editingUser, setEditingUser] = useState<UserItem | null>(null)
  const [deletingUser, setDeletingUser] = useState<UserItem | null>(null)
  const [assigning, setAssigning] = useState<UserItem | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showResetDialog, setShowResetDialog] = useState<UserItem | null>(null)
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false)
  const [resetPasswordValue, setResetPasswordValue] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Updated newUser state to include email
  const [newUser, setNewUser] = useState({
    username: '',
    email: '',
    name: '',
    password: '',
  })

  const handleResetPassword = (u: UserItem) => {
    setShowResetDialog(u)
  }

  // FIXED: Explicit types (item: UserItem) added to solve TS7006
  const actions = useMemo<Action<UserItem>[]>(() => {
    return [
      {
        label: (
          <>
            <IconEdit className="h-4 w-4" />
            {t('common.edit', 'Edit')}
          </>
        ),
        onClick: (item: UserItem) => setEditingUser(item),
      },
      {
        label: '-',
        dynamicLabel: (item: UserItem) =>
          item.enabled ? (
            <>
              <IconLock className="h-4 w-4" />
              {t('common.disable', 'Disable')}
            </>
          ) : (
            <>
              <IconLockOpen className="h-4 w-4" />
              {t('common.enable', 'Enable')}
            </>
          ),
        onClick: (item: UserItem) => handleToggleEnable(item),
      },
      {
        label: (
          <div className="inline-flex items-center gap-2 text-destructive">
            <IconTrash className="h-4 w-4" />
            {t('common.delete', 'Delete')}
          </div>
        ),
        onClick: (item: UserItem) => setDeletingUser(item),
      },
      {
        label: (
          <>
            <IconLock className="h-4 w-4" />
            {t('common.resetPassword', 'Reset Password')}
          </>
        ),
        shouldDisable: (item: UserItem) => item.provider !== 'password',
        onClick: (item: UserItem) => handleResetPassword(item),
      },
      {
        label: (
          <>
            <IconShieldCheck className="h-4 w-4" />
            {t('common.assign', 'Assign')}
          </>
        ),
        onClick: (item: UserItem) => {
          setAssigning(item)
        },
      },
    ]
  }, [handleToggleEnable, t])

  const columns = useMemo<ColumnDef<UserItem>[]>(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        id: 'id',
        header: 'ID',
        enableSorting: true,
        accessorFn: (row) => row.id,
        cell: ({ getValue }) => (
          <div className="text-sm text-muted-foreground">
            {String(getValue())}
          </div>
        ),
      },
      {
        id: 'username',
        header: t('username', 'Username'),
        enableSorting: false,
        accessorFn: (row) => row.username,
        cell: ({ row }) => (
          <div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setEditingUser(row.original)}
                aria-label={t('userManagement.actions.editUser', 'Edit user')}
                className="p-0 bg-transparent border-0 inline-flex items-center"
              >
                <Avatar.Root className="inline-block">
                  {row.original.avatar_url ? (
                    <Avatar.Image
                      src={row.original.avatar_url}
                      alt={row.original.username}
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    <Avatar.Fallback className="h-8 w-8 rounded-full bg-muted-foreground text-white flex items-center justify-center">
                      {row.original.username
                        .split(' ')
                        .map((part) => part[0])
                        .join('')
                        .toUpperCase()
                        .slice(0, 2)}
                    </Avatar.Fallback>
                  )}
                </Avatar.Root>
              </button>
              <div className="flex flex-col min-w-0">
                <span className="font-medium truncate">
                  {row.original.username}
                </span>
                {/* Updated to display email under username */}
                <span className="text-xs text-muted-foreground truncate">
                  {row.original.email || row.original.name || ''}
                </span>
              </div>
            </div>
          </div>
        ),
      },
      {
        id: 'status',
        header: t('userManagement.table.status', 'Status'),
        enableSorting: false,
        cell: ({ row: { original: user } }) => (
          <div className="flex items-center gap-3">{getStatusBadge(user)}</div>
        ),
      },
      {
        id: 'provider',
        header: t('userManagement.table.provider', 'Provider'),
        accessorFn: (row) => row.provider || '-',
        enableSorting: false,
        cell: ({ getValue }) => (
          <div className="code">{String(getValue() || '-')}</div>
        ),
      },
      {
        id: 'createdAt',
        header: t('userManagement.table.createdAt', 'Created At'),
        enableSorting: true,
        accessorFn: (row) => row.createdAt,
        cell: ({ getValue }) => (
          <div className="text-sm text-muted-foreground">
            {formatDate(getValue() as string) || '-'}
          </div>
        ),
      },
      {
        id: 'lastLoginAt',
        header: t('userManagement.table.lastLoginAt', 'Last Login'),
        enableSorting: true,
        accessorFn: (row) => row.lastLoginAt ?? '',
        cell: ({
          row: {
            original: { lastLoginAt },
          },
        }) => (
          <div className="text-sm text-muted-foreground">
            {lastLoginAt ? formatDate(lastLoginAt) : '-'}
          </div>
        ),
      },
      {
        id: 'roles',
        header: t('userManagement.table.roles', 'Roles'),
        accessorFn: (row) => row.roles?.map((r) => r.name).join(', '),
        enableSorting: false,
        cell: ({ row: { original: user } }) => (
          <div className="flex flex-wrap gap-1 max-w-[200px]">
            {user.roles && user.roles.length > 0 ? (
              user.roles.map((r) => (
                <Badge key={r.name} variant="outline" className="text-[10px] px-1.5 py-0.5 leading-none h-4">
                  {r.name}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">-</span>
            )}
          </div>
        ),
      },
    ],
    [getStatusBadge, t]
  )

  const tableColumns = useMemo<ColumnDef<UserItem>[]>(() => {
    const actionColumn: ColumnDef<UserItem> = {
      id: 'actions',
      header: t('common.actions', 'Actions'),
      cell: ({ row }) => (
        <div className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                •••
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {actions.map((action, index) => (
                <DropdownMenuItem
                  key={index}
                  disabled={action.shouldDisable?.(row.original)}
                  onClick={() => action.onClick(row.original)}
                  className="gap-2"
                >
                  {action.dynamicLabel
                    ? action.dynamicLabel(row.original)
                    : action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    }
    return [...columns, actionColumn]
  }, [actions, columns, t])

  const table = useReactTable({
    data: data?.users ?? [],
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    onRowSelectionChange: setRowSelection,
    state: {
      pagination,
      sorting,
      rowSelection,
    },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    manualPagination: true,
    manualSorting: true,
    pageCount: Math.ceil((data?.total ?? 0) / pagination.pageSize) || 0,
    getRowId: (row) => row.id.toString(),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-list'] })
      toast.success(t('userManagement.messages.deleted', 'User deleted'))
      setDeletingUser(null)
    },
    onError: (err: Error) => {
      toast.error(
        err.message ||
        t('userManagement.messages.deleteError', 'Failed to delete user')
      )
    },
  })

  const createMutation = useMutation({
    mutationFn: (data: { username: string; email?: string; name?: string; password: string }) =>
      createPasswordUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-list'] })
      toast.success(t('userManagement.messages.created', 'User created'))
      setShowAddDialog(false)
      setNewUser({ username: '', email: '', name: '', password: '' })
    },
    onError: (err: Error) => {
      toast.error(
        err.message ||
        t('userManagement.messages.createError', 'Failed to create user')
      )
    },
  })

  const resetPasswordMutation = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) =>
      resetUserPassword(id, password),
    onSuccess: () => {
      toast.success(
        t('userManagement.messages.resetPassword', 'Password reset')
      )
      setShowResetDialog(null)
    },
    onError: (err: Error) => {
      toast.error(
        err.message ||
        t(
          'userManagement.messages.resetPasswordError',
          'Failed to reset password'
        )
      )
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<UserItem> }) =>
      updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-list'] })
      toast.success(t('userManagement.messages.updated', 'User updated'))
      setEditingUser(null)
    },
    onError: (err: Error) => {
      toast.error(
        err.message ||
        t('userManagement.messages.updateError', 'Failed to update user')
      )
    },
  })

  const batchCreateMutation = useMutation({
    mutationFn: (users: { username: string; email?: string; name?: string; password?: string }[]) =>
      batchCreateUsers({ users }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['user-list'] })
      if (data.errors && data.errors.length > 0) {
        toast.warning(t('userManagement.messages.batchPartialError', {
          created: data.created.length,
          errors: data.errors.length
        }))
        console.error('Batch creation errors:', data.errors)
      } else {
        toast.success(t('userManagement.messages.batchCreated', 'Users imported successfully'))
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to import users')
    },
  })

  const batchDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => batchDeleteUsers({ ids }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['user-list'] })
      setRowSelection({})
      if (data.errors && data.errors.length > 0) {
        toast.warning(t('userManagement.messages.batchDeletePartialError', {
          deleted: data.deleted.length,
          errors: data.errors.length
        }))
      } else {
        toast.success(t('userManagement.messages.batchDeleted', 'Selected users deleted'))
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete users')
    },
  })

  const handleBatchDelete = () => {
    const selectedIds = Object.keys(rowSelection).map(id => parseInt(id))
    if (selectedIds.length === 0) return
    batchDeleteMutation.mutate(selectedIds, {
      onSuccess: () => {
        setShowBatchDeleteConfirm(false)
      }
    })
  }

  const handleDelete = () => {
    if (!deletingUser) return
    deleteMutation.mutate(deletingUser.id)
  }

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault()
    createMutation.mutate(newUser)
  }

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string)
        let users

        // Support both formats: plain array or object with 'users' key
        if (Array.isArray(parsed)) {
          users = parsed
        } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.users)) {
          users = parsed.users
        } else {
          toast.error('Invalid JSON format: expected an array of users or an object with "users" array')
          return
        }

        batchCreateMutation.mutate(users)
      } catch {
        toast.error('Failed to parse JSON file')
      }
    }
    reader.readAsText(file)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingUser) return
    updateMutation.mutate({
      id: editingUser.id,
      data: {
        name: editingUser.name,
        email: editingUser.email, // Added email to update
        avatar_url: editingUser.avatar_url
      },
    })
  }

  useEffect(() => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }, [searchQuery, roleFilter, sorting])

  const emptyState = (() => {
    if (isLoading && !data) {
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
            {t('userManagement.errors.loadFailed', 'Failed to load users')}
          </div>
        </div>
      )
    }
    if (data && data.users.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          <IconUser className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>{t('userManagement.empty.title', 'No users')}</p>
          <p className="text-sm mt-1">
            {t('userManagement.empty.description', 'No users found')}
          </p>
        </div>
      )
    }
    return null
  })()

  const totalRowCount = data?.total ?? 0
  const filteredRowCount = data?.users.length ?? 0

  return (
    <div>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <IconUser className="h-5 w-5" />
                {t('userManagement.title', 'User Management')}
              </CardTitle>
            </div>
            <div className="flex items-center gap-3">
              <Select
                value={roleFilter || 'all'}
                onValueChange={(value) =>
                  setRoleFilter(value === 'all' ? '' : value)
                }
              >
                <SelectTrigger className="w-48 h-9 text-xs">
                  <SelectValue
                    placeholder={t('userManagement.filters.role', 'All roles')}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t('userManagement.filters.allRoles', 'All roles')}
                  </SelectItem>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.name}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative">
                <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t(
                    'userManagement.search.placeholder',
                    'Search users...'
                  )}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-64 h-9 text-xs"
                />
              </div>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImportJson}
                accept=".json"
                className="hidden"
              />

              {Object.keys(rowSelection).length > 0 ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowBatchDeleteConfirm(true)}
                  className="gap-2"
                >
                  <IconTrash className="h-4 w-4" />
                  {t('userManagement.actions.deleteSelected', {
                    count: Object.keys(rowSelection).length,
                    defaultValue: `Delete Selected (${Object.keys(rowSelection).length})`,
                  })}
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    className="gap-2 h-9 text-xs"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <IconUpload className="h-4 w-4" />
                    {t('userManagement.actions.batchCreate', 'Batch Create')}
                  </Button>
                  <Button className="gap-2 h-9 text-xs" onClick={() => setShowBatchDeleteConfirm(true)}>
                    <IconTrash className="h-4 w-4" />
                    {t('userManagement.actions.batchDelete', 'Batch Delete')}
                  </Button>
                  <Button
                    className="gap-2 h-9 text-xs"
                    onClick={() => {
                      setEditingUser(null)
                      setShowAddDialog(true)
                    }}
                  >
                    <IconPlus className="h-4 w-4" />
                    {t('userManagement.actions.createUser', 'Create User')}
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ResourceTableView
            table={table}
            columnCount={tableColumns.length}
            isLoading={isLoading}
            data={data?.users}
            allPageSize={totalRowCount}
            emptyState={emptyState}
            hasActiveFilters={Boolean(searchQuery) || Boolean(roleFilter)}
            filteredRowCount={filteredRowCount}
            totalRowCount={totalRowCount}
            searchQuery={searchQuery}
            pagination={pagination}
            setPagination={setPagination}
            maxBodyHeightClassName="max-h-[600px]"
          />
        </CardContent>
      </Card>

      <Dialog
        open={showBatchDeleteConfirm}
        onOpenChange={setShowBatchDeleteConfirm}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('userManagement.deleteBatch.title', 'Delete Users')}
            </DialogTitle>
            <DialogDescription>
              {t('userManagement.deleteBatch.description', {
                count: Object.keys(rowSelection).length,
                defaultValue: `Are you sure you want to delete ${Object.keys(rowSelection).length} selected users? This action cannot be undone.`,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowBatchDeleteConfirm(false)}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button variant="destructive" onClick={handleBatchDelete}>
              {t('common.delete', 'Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editingUser} onOpenChange={() => setEditingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('userManagement.dialog.editTitle', 'Edit User')}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm">
                {t('username', 'Username')}
              </label>
              <Input value={editingUser?.username || ''} disabled />
            </div>
            {/* Added Email Field to Edit Dialog */}
            <div>
              <label className="block text-sm">
                {t('common.email', 'Email')}
              </label>
              <Input
                type="email"
                value={editingUser?.email || ''}
                onChange={(e) =>
                  setEditingUser({
                    ...(editingUser as UserItem),
                    email: e.target.value,
                  })
                }
              />
            </div>
            <div>
              <label className="block text-sm">
                {t('userManagement.table.avatar', 'Avatar URL')}
              </label>
              <Input
                value={editingUser?.avatar_url || ''}
                onChange={(e) =>
                  setEditingUser({
                    ...(editingUser as UserItem),
                    avatar_url: e.target.value,
                  })
                }
              />
            </div>
            <div>
              <label className="block text-sm">
                {t('userManagement.table.name', 'Name')}
              </label>
              <Input
                value={editingUser?.name || ''}
                onChange={(e) =>
                  setEditingUser({
                    ...(editingUser as UserItem),
                    name: e.target.value,
                  })
                }
              />
            </div>
            <DialogFooter>
              <Button type="submit">{t('common.save', 'Save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Role assignment dialog */}
      {/* FIXED: (o: boolean) type added to fix TS7006 */}
      <UserRoleAssignment
        open={!!assigning}
        onOpenChange={(o: boolean) => {
          if (!o) setAssigning(null)
        }}
        subject={
          assigning ? { type: 'user', name: assigning.username } : undefined
        }
      />

      {/* Add Password User Dialog */}
      <Dialog open={showAddDialog} onOpenChange={() => setShowAddDialog(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('userManagement.dialog.addTitle', 'Add Password User')}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateUser} className="space-y-4">
            <div>
              <label className="block text-sm">
                {t('username', 'Username')}
              </label>
              <Input
                value={newUser.username}
                onChange={(e) =>
                  setNewUser({ ...newUser, username: e.target.value })
                }
                required
              />
            </div>
            {/* Added Email Field to Add Dialog */}
            <div>
              <label className="block text-sm">
                {t('common.email', 'Email')}
              </label>
              <Input
                type="email"
                placeholder="user@example.com"
                value={newUser.email}
                onChange={(e) =>
                  setNewUser({ ...newUser, email: e.target.value })
                }
              />
            </div>
            <div>
              <label className="block text-sm">
                {t('userManagement.table.name', 'Name')}
              </label>
              <Input
                value={newUser.name}
                onChange={(e) =>
                  setNewUser({ ...newUser, name: e.target.value })
                }
              />
            </div>
            <div>
              <label className="block text-sm">
                {t('common.password', 'Password')}
              </label>
              <Input
                type="password"
                value={newUser.password}
                onChange={(e) =>
                  setNewUser({ ...newUser, password: e.target.value })
                }
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit">{t('common.create', 'Create')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog
        open={!!showResetDialog}
        onOpenChange={() => setShowResetDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('userManagement.dialog.resetPassword', 'Reset Password')}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (showResetDialog)
                resetPasswordMutation.mutate({
                  id: showResetDialog.id,
                  password: resetPasswordValue,
                })
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm">
                {t('common.password', 'Password')}
              </label>
              <Input
                name="password"
                type="password"
                value={resetPasswordValue}
                onChange={(e) => setResetPasswordValue(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit">{t('common.save', 'Save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <DeleteConfirmationDialog
        open={!!deletingUser}
        onOpenChange={() => setDeletingUser(null)}
        onConfirm={handleDelete}
        resourceName={deletingUser?.username || ''}
        resourceType="user"
      />
    </div >
  )
}

export default UserManagement