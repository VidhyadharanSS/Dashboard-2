import { FormEvent, useState, useEffect } from 'react'
import Logo from '@/assets/icon.svg'
import { useAuth } from '@/contexts/auth-context'
import { useTranslation } from 'react-i18next'
import { Navigate, useSearchParams } from 'react-router-dom'

import { withSubPath } from '@/lib/subpath'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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

  const error = searchParams.get('error')

  if (user && !isLoading) {
    return <Navigate to="/" replace />
  }

  const handleLogin = async (provider: string) => {
    setLoginLoading(provider)
    try {
      await login(provider)
    } catch (error) {
      console.error('Login error:', error)
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
    const user = searchParams.get('user')
    const reason = searchParams.get('reason') || errorCode

    switch (reason) {
      case 'insufficient_permissions':
        return {
          title: t('login.errors.accessDenied'),
          message: user
            ? t('login.errors.insufficientPermissionsUser', { user })
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
          message: user
            ? t('login.errors.jwtGenerationFailedUser', { user })
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

  // Animated background orbs effect
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="h-12 w-12 rounded-full border-2 border-white/10 border-t-white/60 animate-spin" />
            <img src={Logo} className="absolute inset-0 m-auto h-5 w-5 invert opacity-70" alt="" />
          </div>
          <p className="text-sm text-white/40 animate-pulse tracking-wide">Authenticating...</p>
        </div>
      </div>
    )
  }

  const errorInfo = getErrorMessage(error)

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}>
      {/* Animated mesh gradient orbs */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className={`absolute -top-[20%] -left-[10%] w-[70vw] h-[70vw] max-w-[800px] max-h-[800px] rounded-full transition-opacity duration-1000 ${mounted ? 'opacity-100' : 'opacity-0'}`}
          style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)', animation: 'float1 12s ease-in-out infinite' }} />
        <div className={`absolute -bottom-[20%] -right-[10%] w-[60vw] h-[60vw] max-w-[700px] max-h-[700px] rounded-full transition-opacity duration-1000 delay-300 ${mounted ? 'opacity-100' : 'opacity-0'}`}
          style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)', animation: 'float2 15s ease-in-out infinite' }} />
        <div className={`absolute top-[30%] right-[20%] w-[40vw] h-[40vw] max-w-[500px] max-h-[500px] rounded-full transition-opacity duration-1000 delay-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}
          style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)', animation: 'float3 18s ease-in-out infinite' }} />
        {/* Subtle grid overlay */}
        <div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)', backgroundSize: '64px 64px' }} />
      </div>

      {/* Floating animation keyframes */}
      <style>{`
        @keyframes float1 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(3%,2%) scale(1.05)} 66%{transform:translate(-2%,3%) scale(0.97)} }
        @keyframes float2 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(-2%,-3%) scale(1.03)} 66%{transform:translate(3%,2%) scale(0.98)} }
        @keyframes float3 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-2%,4%)} }
        @keyframes loginCardIn { from{opacity:0;transform:translateY(20px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes logoIn { from{opacity:0;transform:scale(0.8) rotate(-5deg)} to{opacity:1;transform:scale(1) rotate(0deg)} }
      `}</style>

      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 relative z-10">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center backdrop-blur-sm">
            <img src={Logo} className="h-4 w-4 invert opacity-90" alt="Kites" />
          </div>
          <span className="text-white/50 text-sm font-medium tracking-wide">Kites</span>
        </div>
        <LanguageToggle />
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center px-4 py-8 relative z-10">
        <div className="w-full max-w-[380px]" style={{ animation: 'loginCardIn 0.6s cubic-bezier(0.22,1,0.36,1) both' }}>

          {/* Logo + Title */}
          <div className="text-center mb-8">
            <div
              className="inline-flex items-center justify-center w-20 h-20 rounded-3xl mb-6 relative"
              style={{ animation: 'logoIn 0.7s cubic-bezier(0.22,1,0.36,1) 0.1s both' }}
            >
              {/* Glow ring */}
              <div className="absolute inset-0 rounded-3xl" style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.3), rgba(139,92,246,0.3))', filter: 'blur(8px)', transform: 'scale(1.1)' }} />
              <div className="relative w-full h-full rounded-3xl bg-white/8 border border-white/15 backdrop-blur-xl flex items-center justify-center shadow-2xl" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))' }}>
                <img src={Logo} className="h-10 w-10 invert" alt="Kites" />
              </div>
            </div>
            <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">{t('login.signIn')}</h1>
            <p className="text-sm text-white/40">{t('login.subtitle')}</p>
          </div>

          {/* Error Alert */}
          {errorInfo && (
            <div className="mb-5 rounded-2xl border border-red-500/20 p-4 text-sm" style={{ background: 'rgba(239,68,68,0.08)', backdropFilter: 'blur(12px)' }}>
              <p className="font-semibold text-red-400 flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-red-500/20 flex items-center justify-center text-red-400 text-[10px]">!</span>
                {errorInfo.title}
              </p>
              <p className="text-red-300/80 mt-1.5 text-xs leading-relaxed">{errorInfo.message}</p>
              {errorInfo.details && (
                <p className="text-red-400/50 text-[11px] mt-2">{errorInfo.details}</p>
              )}
              {(searchParams.get('reason') === 'insufficient_permissions' || error === 'insufficient_permissions') && (
                <button
                  onClick={() => { window.location.href = withSubPath('/login') }}
                  className="mt-3 w-full text-xs font-medium text-red-300/80 hover:text-red-200 underline underline-offset-2 transition-colors"
                >
                  {t('login.tryAgainDifferentAccount')}
                </button>
              )}
            </div>
          )}

          {/* Auth Card */}
          <div className="rounded-2xl p-6 space-y-4" style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(20px) saturate(180%)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 32px 64px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)' }}>
            {providers.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-4">
                  <span className="text-xl">🔐</span>
                </div>
                <p className="text-white/50 text-sm font-medium">{t('login.noLoginMethods')}</p>
                <p className="text-white/25 text-xs mt-2">{t('login.configureAuth')}</p>
              </div>
            ) : (
              <>
                {/* Password Login */}
                {providers.includes('password') && (
                  <form onSubmit={handlePasswordLogin} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="username" className="text-white/50 text-[11px] uppercase tracking-widest font-semibold">
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
                        className="h-11 rounded-xl text-white placeholder:text-white/20 transition-all duration-200"
                        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', outline: 'none' }}
                        onFocus={(e) => { e.target.style.border = '1px solid rgba(255,255,255,0.25)'; e.target.style.background = 'rgba(255,255,255,0.08)' }}
                        onBlur={(e) => { e.target.style.border = '1px solid rgba(255,255,255,0.1)'; e.target.style.background = 'rgba(255,255,255,0.06)' }}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="password" className="text-white/50 text-[11px] uppercase tracking-widest font-semibold">
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
                        className="h-11 rounded-xl text-white placeholder:text-white/25 transition-all duration-200"
                        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', outline: 'none' }}
                        onFocus={(e) => { e.target.style.border = '1px solid rgba(255,255,255,0.25)'; e.target.style.background = 'rgba(255,255,255,0.08)' }}
                        onBlur={(e) => { e.target.style.border = '1px solid rgba(255,255,255,0.1)'; e.target.style.background = 'rgba(255,255,255,0.06)' }}
                      />
                    </div>
                    {passwordError && (
                      <Alert variant="destructive" className="rounded-xl" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                        <AlertDescription className="text-red-300 text-xs">{passwordError}</AlertDescription>
                      </Alert>
                    )}
                    <Button
                      type="submit"
                      disabled={loginLoading !== null}
                      className="w-full h-11 rounded-xl font-semibold transition-all duration-200 relative overflow-hidden group"
                      style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', boxShadow: '0 4px 15px rgba(99,102,241,0.4)' }}
                    >
                      <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'linear-gradient(135deg, #818cf8, #a78bfa)' }} />
                      <span className="relative flex items-center justify-center gap-2">
                        {loginLoading === 'password' ? (
                          <>
                            <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                            <span>{t('login.signingIn')}</span>
                          </>
                        ) : (
                          t('login.signInWithPassword')
                        )}
                      </span>
                    </Button>
                  </form>
                )}

                {/* Divider */}
                {providers.filter((p) => p !== 'password').length > 0 && providers.includes('password') && (
                  <div className="relative flex items-center gap-3">
                    <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
                    <span className="text-[10px] uppercase tracking-widest text-white/25 shrink-0">
                      {t('login.orContinueWith')}
                    </span>
                    <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
                  </div>
                )}

                {/* OAuth Providers */}
                {providers.filter((p) => p !== 'password').map((provider) => (
                  <Button
                    key={provider}
                    onClick={() => handleLogin(provider)}
                    disabled={loginLoading !== null}
                    className="w-full h-11 rounded-xl font-medium transition-all duration-200 group"
                    variant="ghost"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)'; (e.currentTarget as HTMLButtonElement).style.color = 'white' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.7)' }}
                  >
                    {loginLoading === provider ? (
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        <span>{t('login.signingIn')}</span>
                      </div>
                    ) : (
                      <span>{t('login.signInWith', { provider: provider.charAt(0).toUpperCase() + provider.slice(1) })}</span>
                    )}
                  </Button>
                ))}
              </>
            )}
          </div>

          {/* Footer note */}
          <p className="text-center text-[11px] text-white/20 mt-6 tracking-wide">
            Kites · Kubernetes Dashboard
          </p>
        </div>
      </div>
    </div>
  )
}
