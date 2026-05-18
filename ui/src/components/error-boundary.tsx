import React from 'react'
import { AlertTriangle, RefreshCw, Home, Bug, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface ErrorBoundaryProps {
  children: React.ReactNode
  /** Optional fallback UI to render. If not provided, uses the default error card. */
  fallback?: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: React.ErrorInfo | null
  showDetails: boolean
}

/**
 * Global error boundary that catches rendering errors in its subtree
 * and shows a user-friendly fallback UI instead of crashing the whole page.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null, showDetails: false }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo })
    // Log to console for debugging
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, showDetails: false })
  }

  handleGoHome = () => {
    window.location.href = '/'
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      const { error, errorInfo, showDetails } = this.state

      return (
        <div className="flex items-center justify-center min-h-[400px] p-6">
          <Card className="max-w-lg w-full border-destructive/20 shadow-lg">
            <CardContent className="pt-6 space-y-4">
              {/* Icon & Title */}
              <div className="flex flex-col items-center text-center gap-3">
                <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center">
                  <AlertTriangle className="h-7 w-7 text-destructive" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">Something went wrong</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    An unexpected error occurred while rendering this page.
                  </p>
                </div>
              </div>

              {/* Error message */}
              {error && (
                <div className="bg-destructive/5 border border-destructive/15 rounded-lg px-3 py-2.5">
                  <p className="text-xs font-mono text-destructive break-all">
                    {error.message || 'Unknown error'}
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-center gap-2">
                <Button onClick={this.handleReset} variant="default" size="sm" className="gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Try Again
                </Button>
                <Button onClick={this.handleGoHome} variant="outline" size="sm" className="gap-1.5">
                  <Home className="h-3.5 w-3.5" />
                  Go Home
                </Button>
              </div>

              {/* Expandable stack trace for developers */}
              {(error?.stack || errorInfo?.componentStack) && (
                <div>
                  <button
                    onClick={() => this.setState({ showDetails: !showDetails })}
                    className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full justify-center"
                  >
                    <Bug className="h-3 w-3" />
                    Technical Details
                    {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                  {showDetails && (
                    <div className="mt-2 bg-muted/30 rounded-lg p-3 max-h-[200px] overflow-auto">
                      <pre className="text-[9px] font-mono text-muted-foreground whitespace-pre-wrap break-all leading-relaxed">
                        {error?.stack || ''}
                        {errorInfo?.componentStack ? `\n\nComponent Stack:${errorInfo.componentStack}` : ''}
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

    return this.props.children
  }
}

