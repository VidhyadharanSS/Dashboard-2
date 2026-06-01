import { useEffect, useState, useCallback } from 'react'
import { IconEdit, IconShieldCheck, IconX, IconWand } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { Cluster, Role } from '@/types/api'
import { useClusterList } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { Separator } from '../ui/separator'

interface RBACDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  role?: Role | null
  onSubmit: (data: Partial<Role>) => void
}

/* ─── Role presets for quick setup ─── */
const ROLE_PRESETS = [
  {
    name: 'Read-Only',
    description: 'View all resources without modification',
    resources: ['*'],
    verbs: ['get', 'list', 'watch'],
  },
  {
    name: 'Developer',
    description: 'Manage workloads and view logs',
    resources: ['pods', 'deployments', 'statefulsets', 'daemonsets', 'services', 'configmaps', 'secrets', 'jobs', 'cronjobs', 'ingresses', 'events'],
    verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete', 'log', 'exec'],
  },
  {
    name: 'Operator',
    description: 'Full access to workloads and RBAC',
    resources: ['*'],
    verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
  },
]

export function RBACDialog({
  open,
  onOpenChange,
  role,
  onSubmit,
}: RBACDialogProps) {
  const { t } = useTranslation()
  const isEdit = !!role

  const [form, setForm] = useState<Partial<Role>>({
    name: '',
    description: '',
    clusters: [],
    namespaces: [],
    resources: [],
    verbs: [],
  })

  useEffect(() => {
    if (role) {
      setForm(role)
    }
  }, [role, open])

  const handleChange = (field: keyof Role, value: string) =>
    setForm((prev) => ({ ...(prev || {}), [field]: value }))

  const setArrayField = (
    field: 'clusters' | 'namespaces' | 'resources' | 'verbs',
    items: string[]
  ) => {
    setForm((prev) => ({ ...(prev || {}), [field]: items }))
  }

  const applyPreset = useCallback((preset: typeof ROLE_PRESETS[0]) => {
    setForm((prev) => ({
      ...prev,
      resources: preset.resources,
      verbs: preset.verbs,
      description: prev?.description || preset.description,
    }))
  }, [])

  function ListEditor({
    label,
    items,
    onChange,
    placeholder,
    suggestions,
  }: {
    label: string
    items: string[]
    onChange: (items: string[]) => void
    placeholder?: string
    suggestions?: string[]
  }) {
    const [input, setInput] = useState('')
    const [focused, setFocused] = useState(false)

    const add = () => {
      const v = input.trim()
      if (!v) return
      const next = Array.from(new Set([...items, v]))
      onChange(next)
      setInput('')
    }

    const remove = (val: string) => {
      onChange(items.filter((i) => i !== val))
    }

    const isWildcard = items.includes('*')

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{label}</Label>
          <span className="text-[10px] text-muted-foreground font-mono">
            {items.length} item{items.length !== 1 ? 's' : ''}
            {isWildcard && ' (wildcard)'}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 min-h-[28px]">
          {items.map((it) => {
            const isSpecial = it === '*'
            return (
              <Badge
                key={it}
                variant={isSpecial ? 'default' : 'secondary'}
                className={`gap-1 pr-1 text-xs ${isSpecial ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25' : ''}`}
              >
                <span className="select-none font-mono">{it}</span>
                <button
                  type="button"
                  aria-label={`remove ${it}`}
                  onClick={() => remove(it)}
                  className="inline-flex items-center justify-center h-4 w-4 rounded-full hover:bg-background/50 transition-colors"
                >
                  <IconX className="h-2.5 w-2.5" />
                </button>
              </Badge>
            )
          })}
          {items.length === 0 && (
            <span className="text-[10px] text-muted-foreground italic py-1">No items - type below to add</span>
          )}
        </div>
        <div className="relative">
          <div className="flex gap-2">
            <Input
              value={input}
              placeholder={placeholder}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                // Delay hiding suggestions to allow suggestion click to register
                setTimeout(() => setFocused(false), 150)
              }}
              required={items.length === 0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  add()
                }
              }}
              className="h-8 text-xs"
            />
          </div>

          {/* Dropdown suggestions (if provided) */}
          {focused && suggestions && suggestions.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-popover border rounded-md shadow-lg max-h-60 overflow-auto">
              {suggestions
                .filter((s) =>
                  s.toLowerCase().includes(input.trim().toLowerCase())
                )
                .filter((s) => !items.includes(s))
                .slice(0, 50)
                .map((s) => (
                  <div
                    key={s}
                    className="px-3 py-1.5 cursor-pointer hover:bg-accent text-xs flex items-center gap-2"
                    onMouseDown={(e) => {
                      // prevent input blur before click
                      e.preventDefault()
                      const next = Array.from(new Set([...items, s]))
                      onChange(next)
                      setInput('')
                    }}
                  >
                    <span className={`font-mono ${s === '*' ? 'text-amber-600 dark:text-amber-400 font-bold' : ''}`}>{s}</span>
                    {s === '*' && <span className="text-[10px] text-muted-foreground">(all)</span>}
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Fetch cluster list for suggestions when editing clusters
  const { data: clusterList = [] } = useClusterList()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(form)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-4xl max-h-[90vh] overflow-y-auto sm:!max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? (
              <IconEdit className="h-5 w-5" />
            ) : (
              <IconShieldCheck className="h-5 w-5" />
            )}
            {isEdit
              ? t('rbac.dialog.edit.title', 'Edit Role')
              : t('rbac.dialog.add.title', 'Add Role')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="role-name">
              {t('rbac.form.name.label', 'Role Name')} *
            </Label>
            <Input
              id="role-name"
              value={form.name || ''}
              onChange={(e) => handleChange('name', e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role-desc">
              {t('rbac.form.description.label', 'Description')}
            </Label>
            <Textarea
              id="role-desc"
              value={form.description || ''}
              onChange={(e) => handleChange('description', e.target.value)}
              rows={2}
            />
          </div>

          {/* Quick presets - only show for new roles */}
          {!isEdit && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <IconWand className="h-3.5 w-3.5 text-primary" />
                <Label className="text-xs font-medium">Quick Presets</Label>
              </div>
              <div className="flex flex-wrap gap-2">
                <TooltipProvider>
                  {ROLE_PRESETS.map((preset) => (
                    <Tooltip key={preset.name}>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1.5"
                          onClick={() => applyPreset(preset)}
                        >
                          {preset.name}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs max-w-[220px]">
                        <p className="font-medium">{preset.description}</p>
                        <p className="text-muted-foreground mt-1">
                          Resources: {preset.resources.slice(0, 3).join(', ')}{preset.resources.length > 3 ? '…' : ''}<br/>
                          Verbs: {preset.verbs.join(', ')}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </TooltipProvider>
              </div>
            </div>
          )}

          <Separator />
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-medium">
                {t('rbac.form.permissions.label', 'Permissions')}
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <ListEditor
                label={t('rbac.form.clusters.label', 'Clusters')}
                items={form.clusters || ['*']}
                onChange={(items) => setArrayField('clusters', items)}
                placeholder="* or cluster-name"
                suggestions={
                  Array.isArray(clusterList)
                    ? (clusterList as Cluster[]).map((c) => c.name)
                    : []
                }
              />

              <ListEditor
                label={t('rbac.form.namespaces.label', 'Namespaces')}
                items={form.namespaces || ['*']}
                onChange={(items) => setArrayField('namespaces', items)}
                placeholder="* or namespace"
              />

              <ListEditor
                label={t('rbac.form.resources.label', 'Resources')}
                items={form.resources || ['*']}
                onChange={(items) => setArrayField('resources', items)}
                placeholder="* or pods,deployments"
                suggestions={[
                  '*',
                  'pods', 'deployments', 'statefulsets', 'daemonsets', 'replicasets',
                  'services', 'configmaps', 'secrets', 'ingresses',
                  'jobs', 'cronjobs', 'nodes', 'namespaces',
                  'persistentvolumes', 'persistentvolumeclaims',
                  'events', 'serviceaccounts',
                  'roles', 'rolebindings', 'clusterroles', 'clusterrolebindings',
                  'storageclasses', 'horizontalpodautoscalers',
                  'gateways', 'httproutes', 'crds', 'prometheus',
                ]}
              />

              <ListEditor
                label={t('rbac.form.verbs.label', 'Verbs')}
                items={form.verbs || ['*']}
                onChange={(items) => setArrayField('verbs', items)}
                placeholder="* or get,list,create"
                suggestions={[
                  '*',
                  'get', 'list', 'watch',
                  'create', 'update', 'patch', 'apply',
                  'delete',
                  'log', 'exec',
                ]}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="submit">
              {isEdit ? t('common.save', 'Save') : t('common.create', 'Create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default RBACDialog

