import { useRouteError, useNavigate } from 'react-router-dom'
import { AlertTriangle, RefreshCw, Home, Bug, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useState } from 'react'

/**
 * Route-level error fallback for react-router.
 * Shown when a route element throws during rendering.
 * This replaces the default "Unexpected Application Error!" page.
 */
export function RouteErrorFallback() {
  const error = useRouteError()
  const navigate = useNavigate()
  const [showDetails, setShowDetails] = useState(false)

  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'An unexpected error occurred while loading this page.'

  const errorStack = error instanceof Error ? error.stack : null

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <Card className="max-w-lg w-full border-destructive/20 shadow-lg">
        <CardContent className="pt-6 space-y-4">
          {/* Icon & Title */}
          <div className="flex flex-col items-center text-center gap-3">
            <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center animate-pulse">
              <AlertTriangle className="h-7 w-7 text-destructive" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Something went wrong</h2>
              <p className="text-sm text-muted-foreground mt-1">
                This page encountered an error and couldn't render properly.
              </p>
            </div>
          </div>

          {/* Error message */}
          <div className="bg-destructive/5 border border-destructive/15 rounded-lg px-3 py-2.5">
            <p className="text-xs font-mono text-destructive break-all leading-relaxed">
              {errorMessage}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-center gap-2">
            <Button
              onClick={() => {
                // Try navigating to the same page to re-render
                navigate(0)
              }}
              variant="default"
              size="sm"
              className="gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </Button>
            <Button
              onClick={() => navigate('/')}
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              <Home className="h-3.5 w-3.5" />
              Go Home
            </Button>
          </div>

          {/* Expandable stack trace */}
          {errorStack && (
            <div>
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full justify-center"
              >
                <Bug className="h-3 w-3" />
                Technical Details
                {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {showDetails && (
                <div className="mt-2 bg-muted/30 rounded-lg p-3 max-h-[200px] overflow-auto">
                  <pre className="text-[9px] font-mono text-muted-foreground whitespace-pre-wrap break-all leading-relaxed">
                    {errorStack}
                  </pre>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

