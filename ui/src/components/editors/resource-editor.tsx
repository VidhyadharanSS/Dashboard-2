import { Container } from 'kubernetes-types/core/v1'
import { AlertCircle } from 'lucide-react'

import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Alert, AlertDescription } from '../ui/alert'

interface ResourceEditorProps {
  container: Container
  onUpdate: (updates: Partial<Container>) => void
}

export function ResourceEditor({ container, onUpdate }: ResourceEditorProps) {
  const updateResources = (
    type: 'requests' | 'limits',
    resource: 'cpu' | 'memory',
    value: string
  ) => {
    onUpdate({
      resources: {
        ...container.resources,
        [type]: {
          ...container.resources?.[type],
          [resource]: value || undefined,
        },
      },
    })
  }

  // Validation: Check if Request > Limit (Kubernetes will reject this)
  const hasCpuError =
    container.resources?.requests?.cpu &&
    container.resources?.limits?.cpu &&
    container.resources.requests.cpu > container.resources.limits.cpu

  return (
    <div className="space-y-6">
      {hasCpuError && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            CPU request cannot be greater than the CPU limit.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Requests */}
        <div className="space-y-4 p-4 border rounded-lg bg-card/50">
          <div className="flex items-center gap-2">
            <Label className="text-sm font-bold text-blue-500 uppercase tracking-wider">Resource Requests</Label>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cpu-request" className="text-xs font-medium">CPU Request</Label>
              <Input
                id="cpu-request"
                className="h-8 text-sm"
                value={container.resources?.requests?.cpu || ''}
                onChange={(e) => updateResources('requests', 'cpu', e.target.value)}
                placeholder="100m"
              />
              <p className="text-[10px] text-muted-foreground italic">e.g., 100m, 0.5, 1</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="memory-request" className="text-xs font-medium">Memory Request</Label>
              <Input
                id="memory-request"
                className="h-8 text-sm"
                value={container.resources?.requests?.memory || ''}
                onChange={(e) => updateResources('requests', 'memory', e.target.value)}
                placeholder="128Mi"
              />
              <p className="text-[10px] text-muted-foreground italic">e.g., 128Mi, 1Gi</p>
            </div>
          </div>
        </div>

        {/* Limits */}
        <div className="space-y-4 p-4 border rounded-lg bg-card/50">
          <div className="flex items-center gap-2">
            <Label className="text-sm font-bold text-orange-500 uppercase tracking-wider">Resource Limits</Label>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cpu-limit" className="text-xs font-medium">CPU Limit</Label>
              <Input
                id="cpu-limit"
                className="h-8 text-sm"
                value={container.resources?.limits?.cpu || ''}
                onChange={(e) => updateResources('limits', 'cpu', e.target.value)}
                placeholder="500m"
              />
              <p className="text-[10px] text-muted-foreground italic">e.g., 500m, 2</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="memory-limit" className="text-xs font-medium">Memory Limit</Label>
              <Input
                id="memory-limit"
                className="h-8 text-sm"
                value={container.resources?.limits?.memory || ''}
                onChange={(e) => updateResources('limits', 'memory', e.target.value)}
                placeholder="512Mi"
              />
              <p className="text-[10px] text-muted-foreground italic">e.g., 512Mi, 2Gi</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}