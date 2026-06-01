import { FormEvent, useState, useEffect, useRef } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { useTranslation } from 'react-i18next'
import { Navigate, useSearchParams } from 'react-router-dom'

import { withSubPath } from '@/lib/subpath'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LanguageToggle } from '@/components/language-toggle'

// Reasons that indicate a recoverable, transient session/cookie problem
// (e.g. user landed on the callback with a missing or mismatched state cookie
// because they navigated back, opened a stale tab, or their browser dropped
// the cookie). For these we transparently re-trigger the OAuth flow ONCE
// before falling back to showing an error - this eliminates the "first
// login attempt fails, second one works" UX issue.
const RECOVERABLE_REASONS = new Set([
  'no_provider_in_cookie',
  'state_mismatch',
])

const AUTO_RETRY_FLAG = 'kite_oauth_auto_retried'


function OAuthIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  )
}

export function LoginPage() {
  const { t } = useTranslation()
  const { user, login, loginWithPassword, providers, isLoading } = useAuth()
  const [searchParams] = useSearchParams()
  const [loginLoading, setLoginLoading] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  // ✅ All hooks declared at the top - before any conditional returns
  const [mounted, setMounted] = useState(false)
  const [autoRetrying, setAutoRetrying] = useState(false)
  const autoRetryAttempted = useRef(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const error = searchParams.get('error')
  const reason = searchParams.get('reason')
  const providerHint = searchParams.get('provider')

  // --- Automatic recovery for transient OAuth session errors ---------------
  useEffect(() => {
    if (!error) return
    if (autoRetryAttempted.current) return
    if (isLoading) return

    const recoverable =
      RECOVERABLE_REASONS.has(reason || '') ||
      error === 'session_expired'

    if (!recoverable) return

    const alreadyRetried =
      typeof window !== 'undefined' &&
      window.sessionStorage.getItem(AUTO_RETRY_FLAG) === '1'

    if (alreadyRetried) {
      window.sessionStorage.removeItem(AUTO_RETRY_FLAG)
      return
    }

    const oauthProviders = providers.filter((p) => p !== 'password')
    let lastAttempted: string | null = null
    try {
      lastAttempted = window.sessionStorage.getItem('kite_oauth_last_provider')
    } catch {
      /* ignore */
    }
    const target =
      (providerHint && oauthProviders.includes(providerHint) && providerHint) ||
      (lastAttempted && oauthProviders.includes(lastAttempted) && lastAttempted) ||
      (oauthProviders.length === 1 ? oauthProviders[0] : null)

    if (!target) return

    autoRetryAttempted.current = true
    setAutoRetrying(true)
    window.sessionStorage.setItem(AUTO_RETRY_FLAG, '1')

    login(target).catch((err) => {
      console.error('Automatic OAuth retry failed:', err)
      window.sessionStorage.removeItem(AUTO_RETRY_FLAG)
      setAutoRetrying(false)
      autoRetryAttempted.current = false
    })
  }, [error, reason, providerHint, providers, isLoading, login])

  // Clear the auto-retry flag once the user is authenticated
  useEffect(() => {
    if (user && typeof window !== 'undefined') {
      window.sessionStorage.removeItem(AUTO_RETRY_FLAG)
      window.sessionStorage.removeItem('kite_oauth_last_provider')
    }
  }, [user])

  // ✅ Early return only AFTER all hooks
  if (user && !isLoading) {
    return <Navigate to="/" replace />
  }

  const handleLogin = async (provider: string) => {
    setLoginLoading(provider)
    try {
      await login(provider)
    } catch (err) {
      console.error('Login error:', err)
      setLoginLoading(null)
    }
  }

  const handlePasswordLogin = async (e: FormEvent) => {
    e.preventDefault()
    setLoginLoading('password')
    setPasswordError(null)
    try {
      await loginWithPassword(username, password)
    } catch (err) {
      if (err instanceof Error) {
        setPasswordError(err.message || t('login.errors.invalidCredentials'))
      } else {
        setPasswordError(t('login.errors.unknownError'))
      }
    } finally {
      setLoginLoading(null)
    }
  }

  const getErrorMessage = (errorCode: string | null) => {
    if (!errorCode) return null
    const provider = searchParams.get('provider') || 'OAuth provider'
    const userParam = searchParams.get('user')
    const reasonCode = searchParams.get('reason') || errorCode

    switch (reasonCode) {
      case 'insufficient_permissions':
        return {
          title: t('login.errors.accessDenied'),
          message: userParam
            ? t('login.errors.insufficientPermissionsUser', { user: userParam })
            : t('login.errors.insufficientPermissions'),
          details: t('login.errors.insufficientPermissionsDetails'),
        }
      case 'token_exchange_failed':
        return {
          title: t('login.errors.authenticationFailed'),
          message: t('login.errors.tokenExchangeFailed', { provider }),
          details: t('login.errors.tokenExchangeDetails'),
        }
      case 'user_info_failed':
        return {
          title: t('login.errors.profileAccessFailed'),
          message: t('login.errors.userInfoFailed', { provider }),
          details: t('login.errors.userInfoDetails'),
        }
      case 'user_upsert_failed':
        return {
          title: t('login.errors.sessionCreationFailed'),
          message: t('login.errors.userUpsertFailed', {
            defaultValue:
              'Could not create or update your user record from {{provider}}.',
            provider,
          }),
          details: t('login.errors.contactSupport'),
        }
      case 'jwt_generation_failed':
        return {
          title: t('login.errors.sessionCreationFailed'),
          message: userParam
            ? t('login.errors.jwtGenerationFailedUser', { user: userParam })
            : t('login.errors.jwtGenerationFailed'),
          details: t('login.errors.jwtGenerationDetails'),
        }
      case 'callback_failed':
        return {
          title: t('login.errors.oauthCallbackFailed'),
          message: t('login.errors.callbackFailed'),
          details: t('login.errors.contactSupport'),
        }
      case 'callback_error':
        return {
          title: t('login.errors.authenticationError'),
          message: t('login.errors.callbackError'),
          details: t('login.errors.contactSupport'),
        }
      case 'user_disabled':
        return {
          title: t('login.errors.userDisabled', 'User Disabled'),
          message: t('login.errors.userDisabledMessage'),
        }
      case 'no_provider_in_cookie':
      case 'state_mismatch': {
        const isReason = errorCode === 'session_expired' || errorCode === 'invalid_state' || errorCode === 'missing_provider'
        return {
          title: t('login.errors.sessionExpired', {
            defaultValue: 'Session Expired',
          }),
          message: t('login.errors.sessionExpiredMessage', {
            defaultValue:
              'Your sign-in session expired or could not be verified. Please try signing in again.',
          }),
          details: isReason
            ? t('login.errors.sessionExpiredHint', {
              defaultValue:
                'If this keeps happening, ensure cookies are enabled and try clearing your browser cache.',
            })
            : t('login.errors.contactSupport'),
        }
      }
      case 'provider_error':
        return {
          title: t('login.errors.authenticationFailed'),
          message: t('login.errors.providerError', {
            defaultValue:
              'The identity provider rejected the sign-in request. You may have cancelled or denied access.',
          }),
          details: t('login.errors.contactSupport'),
        }
      default:
        return {
          title: t('login.errors.authenticationError'),
          message: t('login.errors.generalError'),
          details: t('login.errors.contactSupport'),
        }
    }
  }

  if (isLoading || autoRetrying) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
          <p className="text-sm text-muted-foreground">
            {autoRetrying
              ? t('login.retrying', { defaultValue: 'Re-establishing session…' })
              : 'Authenticating…'}
          </p>
        </div>
      </div>
    )
  }

  const errorInfo = getErrorMessage(error)
  const oauthProviders = providers.filter((p) => p !== 'password')
  const hasPassword = providers.includes('password')

  return (
    <div
      className={`min-h-screen flex flex-col relative overflow-hidden bg-background text-foreground transition-opacity duration-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}
    >
      <style>{`
        @keyframes lp-card-in {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .lp-card {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: 1rem;
          padding: 1.75rem;
          box-shadow: 0 1px 3px oklch(0 0 0 / 0.06), 0 8px 24px oklch(0 0 0 / 0.06);
          animation: lp-card-in 0.4s ease both;
        }
        .lp-input:focus {
          outline: none;
          box-shadow: 0 0 0 2px oklch(from var(--primary) l c h / 0.2) !important;
          border-color: oklch(from var(--primary) l c h / 0.5) !important;
        }
        .lp-btn-primary {
          display: flex; align-items: center; justify-content: center; gap: 0.5rem;
          width: 100%; height: 2.625rem;
          background: var(--primary); color: var(--primary-foreground);
          border: none; border-radius: 0.625rem;
          font-weight: 600; font-size: 0.875rem; cursor: pointer;
          transition: filter 0.15s ease, transform 0.1s ease;
        }
        .lp-btn-primary:hover:not(:disabled) { filter: brightness(1.07); transform: translateY(-1px); }
        .lp-btn-primary:active:not(:disabled) { transform: translateY(0); }
        .lp-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
        .lp-btn-oauth {
          display: flex; align-items: center; justify-content: center; gap: 0.5rem;
          width: 100%; height: 2.75rem;
          background: var(--primary); color: var(--primary-foreground);
          border: none; border-radius: 0.625rem;
          font-weight: 600; font-size: 0.9rem; cursor: pointer;
          transition: filter 0.15s ease, transform 0.1s ease;
        }
        .lp-btn-oauth:hover:not(:disabled) { filter: brightness(1.07); transform: translateY(-1px); }
        .lp-btn-oauth:active:not(:disabled) { transform: translateY(0); }
        .lp-btn-oauth:disabled { opacity: 0.6; cursor: not-allowed; }
        .lp-btn-oauth-secondary {
          display: flex; align-items: center; justify-content: center; gap: 0.5rem;
          width: 100%; height: 2.625rem;
          background: transparent; color: var(--foreground);
          border: 1px solid var(--border); border-radius: 0.625rem;
          font-weight: 500; font-size: 0.875rem; cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .lp-btn-oauth-secondary:hover:not(:disabled) { background: var(--accent); border-color: var(--primary); }
        .lp-btn-oauth-secondary:disabled { opacity: 0.6; cursor: not-allowed; }
      `}</style>

      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 relative z-10">
        <span className="text-base font-bold tracking-widest text-foreground uppercase">KITES</span>
        <LanguageToggle />
      </div>

      {/* Main content - centered single form */}
      <div className="flex-1 flex items-center justify-center relative z-10 px-4 py-8">
        <div className="w-full max-w-[360px]">

          {/* Title */}
          <div className="text-center mb-7">
            <h1 className="text-2xl font-bold text-foreground mb-1">{t('login.signIn')}</h1>
            <p className="text-sm text-muted-foreground">{t('login.subtitle')}</p>
          </div>

          {/* Error */}
          {errorInfo && (
            <div className="mb-5 rounded-lg border border-destructive/30 bg-destructive/8 p-3.5 text-sm">
              <p className="font-semibold text-destructive">{errorInfo.title}</p>
              <p className="text-destructive/80 mt-1 text-xs leading-relaxed">{errorInfo.message}</p>
              {errorInfo.details && (
                <p className="text-destructive/60 text-[11px] mt-1.5">{errorInfo.details}</p>
              )}
              {(searchParams.get('reason') === 'insufficient_permissions' || error === 'insufficient_permissions') && (
                <button
                  onClick={() => { window.location.href = withSubPath('/login') }}
                  className="mt-2.5 w-full text-xs font-medium text-destructive/70 hover:text-destructive underline underline-offset-2 transition-colors"
                >
                  {t('login.tryAgainDifferentAccount')}
                </button>
              )}
            </div>
          )}

          {/* Auth card */}
          <div className="lp-card">
            {providers.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-muted-foreground text-sm font-medium">{t('login.noLoginMethods')}</p>
                <p className="text-muted-foreground/70 text-xs mt-1.5">{t('login.configureAuth')}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* OAuth-only */}
                {!hasPassword && oauthProviders.length > 0 && (
                  <div className="space-y-3">
                    {oauthProviders.map((provider) => (
                      <button
                        key={provider}
                        onClick={() => handleLogin(provider)}
                        disabled={loginLoading !== null}
                        className="lp-btn-oauth"
                      >
                        {loginLoading === provider ? (
                          <>
                            <span className="h-4 w-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
                            {t('login.signingIn')}
                          </>
                        ) : (
                          <>
                            <OAuthIcon className="w-4.5 h-4.5" />
                            {t('login.signInWith', {
                              provider: provider.charAt(0).toUpperCase() + provider.slice(1),
                            })}
                          </>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* Password form */}
                {hasPassword && (
                  <form onSubmit={handlePasswordLogin} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="username" className="text-muted-foreground text-[11px] uppercase tracking-widest font-semibold">
                        {t('login.usernameOrEmail', 'Username or Email')}
                      </Label>
                      <Input
                        id="username"
                        type="text"
                        placeholder={t('login.enterUsernameOrEmail', 'your@email.com')}
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                        autoComplete="username"
                        className="lp-input h-10 rounded-lg bg-background"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="password" className="text-muted-foreground text-[11px] uppercase tracking-widest font-semibold">
                        {t('login.password')}
                      </Label>
                      <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="current-password"
                        className="lp-input h-10 rounded-lg bg-background"
                      />
                    </div>
                    {passwordError && (
                      <Alert variant="destructive" className="rounded-lg py-2">
                        <AlertDescription className="text-xs">{passwordError}</AlertDescription>
                      </Alert>
                    )}
                    <button type="submit" disabled={loginLoading !== null} className="lp-btn-primary">
                      {loginLoading === 'password' ? (
                        <>
                          <span className="h-4 w-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
                          {t('login.signingIn')}
                        </>
                      ) : (
                        t('login.signInWithPassword')
                      )}
                    </button>
                  </form>
                )}

                {/* Divider */}
                {oauthProviders.length > 0 && hasPassword && (
                  <div className="relative flex items-center gap-3 py-1">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground shrink-0">{t('login.orContinueWith')}</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                )}

                {/* OAuth secondary (when password also present) */}
                {hasPassword && oauthProviders.map((provider) => (
                  <button
                    key={provider}
                    onClick={() => handleLogin(provider)}
                    disabled={loginLoading !== null}
                    className="lp-btn-oauth-secondary"
                  >
                    {loginLoading === provider ? (
                      <>
                        <span className="h-4 w-4 rounded-full border-2 border-foreground/30 border-t-foreground animate-spin" />
                        {t('login.signingIn')}
                      </>
                    ) : (
                      <>
                        <OAuthIcon className="w-4 h-4 text-muted-foreground" />
                        {t('login.signInWith', {
                          provider: provider.charAt(0).toUpperCase() + provider.slice(1),
                        })}
                      </>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <p className="text-center text-[11px] text-muted-foreground mt-5">
            Kites Dashboard
          </p>
        </div>
      </div>
    </div>
  )
}
