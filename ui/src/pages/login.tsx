import { FormEvent, useState, useEffect } from 'react'
import Logo from '@/assets/icon.svg'
import { useAuth } from '@/contexts/auth-context'
import { useTranslation } from 'react-i18next'
import { Navigate, useSearchParams } from 'react-router-dom'

import { withSubPath } from '@/lib/subpath'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LanguageToggle } from '@/components/language-toggle'

export function LoginPage() {
  const { t } = useTranslation()
  const { user, login, loginWithPassword, providers, isLoading } = useAuth()
  const [searchParams] = useSearchParams()
  const [loginLoading, setLoginLoading] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  // ✅ All hooks declared at the top — before any conditional returns
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const error = searchParams.get('error')

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
    const reason = searchParams.get('reason') || errorCode

    switch (reason) {
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
      default:
        return {
          title: t('login.errors.authenticationError'),
          message: t('login.errors.generalError'),
          details: t('login.errors.contactSupport'),
        }
    }
  }

  if (isLoading) {
    return (
      <div className="login-page-root flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="h-12 w-12 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
            <img src={Logo} className="absolute inset-0 m-auto h-5 w-5 opacity-70" alt="" />
          </div>
          <p className="text-sm text-muted-foreground animate-pulse tracking-wide">Authenticating…</p>
        </div>
      </div>
    )
  }

  const errorInfo = getErrorMessage(error)

  return (
    <div
      className={`login-page-root min-h-screen flex flex-col relative overflow-hidden transition-opacity duration-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* Scoped styles — uses CSS custom properties so they adapt to the active theme */}
      <style>{`
        .login-page-root {
          background: hsl(var(--background));
        }
        /* Ambient blobs */
        .lp-blob {
          position: absolute;
          border-radius: 50%;
          pointer-events: none;
        }
        .lp-blob-1 {
          top: -15%; left: -10%;
          width: 60vw; height: 60vw;
          max-width: 700px; max-height: 700px;
          background: radial-gradient(circle, hsl(var(--primary) / 0.09) 0%, transparent 70%);
          animation: lp-float1 14s ease-in-out infinite;
        }
        .lp-blob-2 {
          bottom: -15%; right: -10%;
          width: 55vw; height: 55vw;
          max-width: 650px; max-height: 650px;
          background: radial-gradient(circle, hsl(var(--primary) / 0.06) 0%, transparent 70%);
          animation: lp-float2 18s ease-in-out infinite;
        }
        .lp-blob-3 {
          top: 40%; right: 25%;
          width: 35vw; height: 35vw;
          max-width: 420px; max-height: 420px;
          background: radial-gradient(circle, hsl(var(--primary) / 0.04) 0%, transparent 70%);
          animation: lp-float3 22s ease-in-out infinite;
        }
        @keyframes lp-float1 {
          0%,100%{ transform: translate(0,0) scale(1); }
          40%    { transform: translate(2%,3%) scale(1.04); }
          70%    { transform: translate(-2%,2%) scale(0.97); }
        }
        @keyframes lp-float2 {
          0%,100%{ transform: translate(0,0) scale(1); }
          35%    { transform: translate(-3%,-2%) scale(1.03); }
          65%    { transform: translate(2%,3%) scale(0.98); }
        }
        @keyframes lp-float3 {
          0%,100%{ transform: translate(0,0); }
          50%    { transform: translate(-2%,4%); }
        }
        @keyframes lp-card-in {
          from { opacity: 0; transform: translateY(18px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0)   scale(1); }
        }
        @keyframes lp-logo-in {
          from { opacity: 0; transform: scale(0.8) rotate(-6deg); }
          to   { opacity: 1; transform: scale(1)   rotate(0deg); }
        }

        /* Card */
        .lp-card {
          background: hsl(var(--card));
          border: 1px solid hsl(var(--border));
          border-radius: 1.25rem;
          padding: 1.75rem;
          box-shadow:
            0 4px 6px -1px hsl(var(--foreground) / 0.04),
            0 20px 40px -8px hsl(var(--foreground) / 0.08),
            inset 0 1px 0 hsl(var(--foreground) / 0.04);
          animation: lp-card-in 0.55s cubic-bezier(0.22,1,0.36,1) 0.1s both;
          transition: box-shadow 0.3s ease;
        }
        .lp-card:hover {
          box-shadow:
            0 4px 6px -1px hsl(var(--foreground) / 0.05),
            0 28px 50px -8px hsl(var(--foreground) / 0.12),
            inset 0 1px 0 hsl(var(--foreground) / 0.05);
        }

        /* Logo */
        .lp-logo-wrap {
          animation: lp-logo-in 0.65s cubic-bezier(0.22,1,0.36,1) 0.15s both;
        }

        /* Input focus ring */
        .lp-input:focus {
          outline: none;
          box-shadow: 0 0 0 2px hsl(var(--primary) / 0.25) !important;
          border-color: hsl(var(--primary) / 0.5) !important;
        }

        /* Primary submit button */
        .lp-btn-primary {
          display: flex; align-items: center; justify-content: center; gap: 0.5rem;
          width: 100%; height: 2.75rem;
          background: hsl(var(--primary));
          color: hsl(var(--primary-foreground));
          border: none; border-radius: 0.75rem;
          font-weight: 600; font-size: 0.875rem; cursor: pointer;
          position: relative; overflow: hidden;
          box-shadow: 0 4px 14px hsl(var(--primary) / 0.35);
          transition: filter 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease;
        }
        .lp-btn-primary::after {
          content: '';
          position: absolute; inset: 0;
          background: linear-gradient(135deg, rgba(255,255,255,0.12) 0%, transparent 60%);
          pointer-events: none;
        }
        .lp-btn-primary:hover:not(:disabled) {
          filter: brightness(1.08);
          transform: translateY(-1px);
          box-shadow: 0 6px 20px hsl(var(--primary) / 0.45);
        }
        .lp-btn-primary:active:not(:disabled) {
          transform: translateY(0);
          box-shadow: 0 2px 8px hsl(var(--primary) / 0.3);
        }
        .lp-btn-primary:disabled { opacity: 0.65; cursor: not-allowed; }

        /* OAuth / secondary button */
        .lp-btn-oauth {
          display: flex; align-items: center; justify-content: center; gap: 0.5rem;
          width: 100%; height: 2.75rem;
          background: hsl(var(--secondary));
          color: hsl(var(--secondary-foreground));
          border: 1px solid hsl(var(--border));
          border-radius: 0.75rem;
          font-weight: 500; font-size: 0.875rem; cursor: pointer;
          transition: background 0.2s ease, border-color 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease;
        }
        .lp-btn-oauth:hover:not(:disabled) {
          background: hsl(var(--accent));
          border-color: hsl(var(--primary) / 0.3);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px hsl(var(--foreground) / 0.08);
        }
        .lp-btn-oauth:active:not(:disabled) { transform: translateY(0); }
        .lp-btn-oauth:disabled { opacity: 0.6; cursor: not-allowed; }
      `}</style>

      {/* Ambient blobs */}
      <div className="lp-blob lp-blob-1" />
      <div className="lp-blob lp-blob-2" />
      <div className="lp-blob lp-blob-3" />

      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 relative z-10">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
            <img src={Logo} className="h-4 w-4 opacity-80" alt="Kites" />
          </div>
          <span className="text-muted-foreground text-sm font-semibold tracking-wide">Kites</span>
        </div>
        <LanguageToggle />
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center px-4 py-8 relative z-10">
        <div className="w-full max-w-[380px]" style={{ animation: 'lp-card-in 0.5s cubic-bezier(0.22,1,0.36,1) both' }}>

          {/* Logo + Title */}
          <div className="text-center mb-8">
            <div className="lp-logo-wrap inline-flex items-center justify-center mb-5">
              <div className="relative w-20 h-20">
                {/* Glow halo */}
                <div
                  className="absolute inset-0 rounded-2xl blur-xl opacity-30"
                  style={{ background: 'hsl(var(--primary) / 0.5)' }}
                />
                <div className="relative w-full h-full rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-lg">
                  <img src={Logo} className="h-10 w-10 opacity-90" alt="Kites" />
                </div>
              </div>
            </div>
            <h1 className="text-3xl font-bold text-foreground mb-1.5 tracking-tight">
              {t('login.signIn')}
            </h1>
            <p className="text-sm text-muted-foreground">{t('login.subtitle')}</p>
          </div>

          {/* Error alert */}
          {errorInfo && (
            <div className="mb-5 rounded-xl border border-destructive/25 bg-destructive/8 p-4 text-sm">
              <p className="font-semibold text-destructive flex items-center gap-2">
                <span className="inline-flex w-4 h-4 rounded-full bg-destructive/15 items-center justify-center text-[10px]">!</span>
                {errorInfo.title}
              </p>
              <p className="text-destructive/80 mt-1.5 text-xs leading-relaxed">{errorInfo.message}</p>
              {errorInfo.details && (
                <p className="text-destructive/50 text-[11px] mt-2">{errorInfo.details}</p>
              )}
              {(searchParams.get('reason') === 'insufficient_permissions' || error === 'insufficient_permissions') && (
                <button
                  onClick={() => { window.location.href = withSubPath('/login') }}
                  className="mt-3 w-full text-xs font-medium text-destructive/70 hover:text-destructive underline underline-offset-2 transition-colors"
                >
                  {t('login.tryAgainDifferentAccount')}
                </button>
              )}
            </div>
          )}

          {/* Auth card */}
          <div className="lp-card">
            {providers.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-2xl bg-muted border border-border flex items-center justify-center mx-auto mb-4">
                  <span className="text-xl">🔐</span>
                </div>
                <p className="text-muted-foreground text-sm font-medium">{t('login.noLoginMethods')}</p>
                <p className="text-muted-foreground/60 text-xs mt-2">{t('login.configureAuth')}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Password form */}
                {providers.includes('password') && (
                  <form onSubmit={handlePasswordLogin} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="username"
                        className="text-muted-foreground text-[11px] uppercase tracking-widest font-semibold"
                      >
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
                        className="lp-input h-11 rounded-xl bg-background transition-all duration-200"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label
                        htmlFor="password"
                        className="text-muted-foreground text-[11px] uppercase tracking-widest font-semibold"
                      >
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
                        className="lp-input h-11 rounded-xl bg-background transition-all duration-200"
                      />
                    </div>

                    {passwordError && (
                      <Alert variant="destructive" className="rounded-xl py-2.5">
                        <AlertDescription className="text-xs">{passwordError}</AlertDescription>
                      </Alert>
                    )}

                    <button
                      type="submit"
                      disabled={loginLoading !== null}
                      className="lp-btn-primary"
                    >
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
                {providers.filter((p) => p !== 'password').length > 0 && providers.includes('password') && (
                  <div className="relative flex items-center gap-3 py-1">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 shrink-0">
                      {t('login.orContinueWith')}
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                )}

                {/* OAuth buttons */}
                {providers.filter((p) => p !== 'password').map((provider) => (
                  <button
                    key={provider}
                    onClick={() => handleLogin(provider)}
                    disabled={loginLoading !== null}
                    className="lp-btn-oauth"
                  >
                    {loginLoading === provider ? (
                      <>
                        <span className="h-4 w-4 rounded-full border-2 border-secondary-foreground/30 border-t-secondary-foreground animate-spin" />
                        {t('login.signingIn')}
                      </>
                    ) : (
                      t('login.signInWith', {
                        provider: provider.charAt(0).toUpperCase() + provider.slice(1),
                      })
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <p className="text-center text-[11px] text-muted-foreground/40 mt-6 tracking-wide">
            Kites · Kubernetes Dashboard · Built by Team Kites
          </p>
        </div>
      </div>
    </div>
  )
}
