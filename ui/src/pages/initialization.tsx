import { useState, useEffect } from 'react'
import Logo from '@/assets/icon.svg'
import {
  IconCheck,
  IconLoader,
  IconServer,
  IconShieldLock,
  IconUser,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { Navigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { createSuperUser, importClusters, useInitCheck } from '@/lib/api'
import { useAuth } from '@/contexts/auth-context'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Footer } from '@/components/footer'
import { LanguageToggle } from '@/components/language-toggle'

interface InitStepProps {
  step: number
  currentStep: number
  title: string
  description: string
  icon: React.ElementType
  completed: boolean
  children: React.ReactNode
}

function InitStep({
  step,
  currentStep,
  title,
  description,
  icon: Icon,
  completed,
  children,
}: InitStepProps) {
  const isActive = step === currentStep
  const isPending = step > currentStep

  return (
    <div className={`space-y-4 ${isPending ? 'opacity-50' : ''}`}>
      <div className="flex items-center space-x-3">
        <div
          className={`flex aspect-square h-10 w-10 items-center justify-center rounded-full border-2 flex-shrink-0 ${
            completed
              ? 'border-green-600 bg-green-600 text-white dark:border-green-500 dark:bg-green-500'
              : isActive
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-muted text-muted-foreground'
          }`}
        >
          {completed ? (
            <IconCheck className="h-5 w-5" />
          ) : (
            <Icon className="h-5 w-5" />
          )}
        </div>
        <div>
          <h3
            className={`text-lg font-medium ${
              completed
                ? 'text-green-600 dark:text-green-400'
                : isActive
                  ? 'text-foreground'
                  : 'text-muted-foreground'
            }`}
          >
            {title}
          </h3>
          <p
            className={`text-xs ${
              completed
                ? 'text-green-600 dark:text-green-400'
                : isActive
                  ? 'text-muted-foreground'
                  : 'text-muted-foreground/70'
            }`}
          >
            {description}
          </p>
        </div>
      </div>
      {isActive && <div className="ml-13">{children}</div>}
    </div>
  )
}

export function InitializationPage() {
  const { t } = useTranslation()
  const { data: initCheck, isLoading, refetch } = useInitCheck()
  const { login, providers, user } = useAuth()
  const [searchParams] = useSearchParams()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Read OAuth callback errors from URL (when callback redirects to /setup?error=...)
  const urlError = searchParams.get('error')
  const urlReason = searchParams.get('reason')

  // User form state
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')

  // Cluster form state
  const [kubeconfig, setKubeconfig] = useState('')
  const [isFileMode, setIsFileMode] = useState(false)
  const [isInCluster, setIsInCluster] = useState(false)

  // OAuth login state
  const [oauthLoading, setOauthLoading] = useState<string | null>(null)

  const isOAuthBootstrap = initCheck?.oauthBootstrap ?? false

  // After successful OAuth login during bootstrap, refetch init status
  useEffect(() => {
    if (isOAuthBootstrap && user) {
      refetch()
    }
  }, [user, isOAuthBootstrap, refetch])

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        setKubeconfig(content)
      }
      reader.readAsText(file)
    }
  }

  // If loading, show spinner
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    )
  }

  // If already initialized, redirect to home
  if (initCheck?.initialized) {
    return <Navigate to="/" replace />
  }

  const step = initCheck?.step || 0
  const actualCurrentStep = Math.max(1, step + 1)

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError(t('initialization.step1.passwordMismatch'))
      return
    }

    setIsSubmitting(true)
    try {
      await createSuperUser({
        username,
        password,
        name: name || undefined,
      })
      toast.success(t('initialization.step1.createSuccess'))
      await refetch()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('initialization.step1.createError')
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOAuthLogin = async (provider: string) => {
    setOauthLoading(provider)
    setError(null)
    try {
      await login(provider)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to initiate OAuth login'
      )
      setOauthLoading(null)
    }
  }

  const handleImportClusters = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!isInCluster && !kubeconfig.trim()) {
      setError(t('initialization.step2.configRequired'))
      return
    }

    setIsSubmitting(true)
    try {
      await importClusters({ config: kubeconfig, inCluster: isInCluster })
      toast.success(t('initialization.step2.importSuccess'))
      await refetch()
      // Will redirect to home page when initialized becomes true
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('initialization.step2.importError')
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  // Get OAuth providers (exclude "password")
  const oauthProviders = providers.filter((p) => p !== 'password')

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <div className="absolute top-6 right-6 z-10">
        <LanguageToggle />
      </div>

      <div className="flex-1 flex items-center justify-center py-8 px-4">
        <div className="w-full max-w-2xl">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center space-x-2 mb-4">
              <img src={Logo} className="h-10 w-10" />{' '}
              <h1 className="text-2xl font-bold text-foreground">Kite</h1>
            </div>
          </div>

          <Card className="shadow-lg border">
            <CardHeader className="text-center pb-6">
              <CardTitle className="text-xl">
                {t('initialization.title')}
              </CardTitle>
              <CardDescription>
                {isOAuthBootstrap
                  ? 'Sign in with your organization\'s OAuth provider to set up Kite.'
                  : t('initialization.description')}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {(error || urlError) && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {error || `Authentication failed: ${urlReason || urlError}. Please try again.`}
                  </AlertDescription>
                </Alert>
              )}

              {/* Step 1: Create Admin - Password mode or OAuth bootstrap mode */}
              <InitStep
                step={1}
                currentStep={actualCurrentStep}
                title={
                  isOAuthBootstrap
                    ? 'Sign in as Admin'
                    : t('initialization.step1.title')
                }
                description={
                  isOAuthBootstrap
                    ? 'Authenticate with your OAuth provider to create the admin account.'
                    : t('initialization.step1.description')
                }
                icon={isOAuthBootstrap ? IconShieldLock : IconUser}
                completed={step >= 1}
              >
                {isOAuthBootstrap ? (
                  /* OAuth Bootstrap: Show OAuth sign-in buttons instead of password form */
                  <div className="space-y-4">
                    <div className="rounded-lg border border-blue-500/50 bg-blue-500/10 p-4 text-sm text-blue-700 dark:text-blue-400">
                      <div className="flex items-center gap-2 mb-1">
                        <IconShieldLock className="h-4 w-4" />
                        <strong>Secure OAuth Setup</strong>
                      </div>
                      <p>
                        Your admin account will be created automatically when you sign in.
                        No passwords are stored or transmitted.
                      </p>
                    </div>

                    {oauthProviders.length > 0 ? (
                      <div className="space-y-2">
                        {oauthProviders.map((provider) => (
                          <Button
                            key={provider}
                            onClick={() => handleOAuthLogin(provider)}
                            disabled={oauthLoading !== null}
                            className="w-full"
                            variant="default"
                          >
                            {oauthLoading === provider ? (
                              <div className="flex items-center space-x-2">
                                <IconLoader className="h-4 w-4 animate-spin" />
                                <span>Redirecting to {provider}…</span>
                              </div>
                            ) : (
                              <>
                                <IconShieldLock className="h-4 w-4 mr-2" />
                                Sign in with{' '}
                                {provider.charAt(0).toUpperCase() +
                                  provider.slice(1)}
                              </>
                            )}
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-4 text-muted-foreground">
                        <p className="text-sm">
                          Loading OAuth providers…
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Traditional: Password-based admin creation */
                  <form onSubmit={handleCreateUser} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="username">
                        {t('initialization.step1.usernameRequired')}
                      </Label>
                      <Input
                        id="username"
                        type="text"
                        placeholder={t(
                          'initialization.step1.usernamePlaceholder'
                        )}
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="name">
                        {t('initialization.step1.displayName')}
                      </Label>
                      <Input
                        id="name"
                        type="text"
                        placeholder={t(
                          'initialization.step1.displayNamePlaceholder'
                        )}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password">
                        {t('initialization.step1.passwordRequired')}
                      </Label>
                      <Input
                        id="password"
                        type="password"
                        placeholder={t(
                          'initialization.step1.passwordPlaceholder'
                        )}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword">
                        {t('initialization.step1.confirmPasswordRequired')}
                      </Label>
                      <Input
                        id="confirmPassword"
                        type="password"
                        placeholder={t(
                          'initialization.step1.confirmPasswordPlaceholder'
                        )}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                      />
                    </div>
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full"
                    >
                      {isSubmitting ? (
                        <div className="flex items-center space-x-2">
                          <IconLoader className="h-4 w-4 animate-spin" />
                          <span>{t('initialization.step1.creating')}</span>
                        </div>
                      ) : (
                        t('initialization.step1.createButton')
                      )}
                    </Button>
                  </form>
                )}
              </InitStep>

              {/* Step 2: Import Cluster */}
              <InitStep
                step={2}
                currentStep={actualCurrentStep}
                title={t('initialization.step2.title')}
                description={t('initialization.step2.description')}
                icon={IconServer}
                completed={step >= 2}
              >
                <form onSubmit={handleImportClusters} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="kubeconfig">
                      {t('initialization.step2.kubeconfigRequired')}
                    </Label>

                    <div className="flex items-center space-x-4 mb-3">
                      <button
                        type="button"
                        onClick={() => {
                          setIsInCluster(false)
                          setIsFileMode(false)
                        }}
                        className={`px-3 py-1 text-sm rounded-md transition-colors ${
                          !isFileMode && !isInCluster
                            ? 'bg-primary/15 text-primary border border-primary/30'
                            : 'bg-muted text-muted-foreground border border-border hover:bg-accent'
                        }`}
                      >
                        {t('initialization.step2.pasteMode', {
                          defaultValue: 'Paste Content',
                        })}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsInCluster(false)
                          setIsFileMode(true)
                        }}
                        className={`px-3 py-1 text-sm rounded-md transition-colors ${
                          isFileMode && !isInCluster
                            ? 'bg-primary/15 text-primary border border-primary/30'
                            : 'bg-muted text-muted-foreground border border-border hover:bg-accent'
                        }`}
                      >
                        {t('initialization.step2.fileMode', {
                          defaultValue: 'Upload File',
                        })}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsInCluster(true)
                          setIsFileMode(false)
                        }}
                        className={`px-3 py-1 text-sm rounded-md transition-colors ${
                          isInCluster
                            ? 'bg-primary/15 text-primary border border-primary/30'
                            : 'bg-muted text-muted-foreground border border-border hover:bg-accent'
                        }`}
                      >
                        {t('initialization.step2.inClusterMode', {
                          defaultValue: 'In-Cluster',
                        })}
                      </button>
                    </div>

                    {isInCluster ? (
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                          {t('initialization.step2.inClusterHint', {
                            defaultValue:
                              'Import clusters from inside the running Kite instance. No kubeconfig required.',
                          })}
                        </p>
                      </div>
                    ) : isFileMode ? (
                      <div className="space-y-2">
                        <input
                          type="file"
                          onChange={handleFileSelect}
                          className="w-full text-sm text-muted-foreground
                            file:mr-4 file:py-2 file:px-4
                            file:rounded-md file:border-0
                            file:text-sm file:font-medium
                            file:bg-primary/10 file:text-primary
                            hover:file:bg-primary/20
                            file:cursor-pointer cursor-pointer"
                        />
                        <p className="text-xs text-muted-foreground">
                          {t('initialization.step2.fileHint', {
                            defaultValue:
                              'Select your kubeconfig file (usually located at ~/.kube/config)',
                          })}
                        </p>
                      </div>
                    ) : (
                      <Textarea
                        id="kubeconfig"
                        placeholder={t(
                          'initialization.step2.kubeconfigPlaceholder'
                        )}
                        value={kubeconfig}
                        onChange={(e) => setKubeconfig(e.target.value)}
                        rows={8}
                        className="text-sm"
                      />
                    )}

                    <p className="text-xs text-muted-foreground">
                      {t('initialization.step2.kubeconfigHint')}
                    </p>
                  </div>
                  <Button
                    type="submit"
                    disabled={
                      isSubmitting || (!isInCluster && !kubeconfig.trim())
                    }
                    className="w-full"
                  >
                    {isSubmitting ? (
                      <div className="flex items-center space-x-2">
                        <IconLoader className="h-4 w-4 animate-spin" />
                        <span>{t('initialization.step2.importing')}</span>
                      </div>
                    ) : (
                      t('initialization.step2.importButton')
                    )}
                  </Button>
                </form>
              </InitStep>

              {/* Completion message */}
              {step >= 2 && (
                <div className="text-center py-6">
                  <div className="flex items-center justify-center mb-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/15">
                      <IconCheck className="h-6 w-6 text-green-600 dark:text-green-400" />
                    </div>
                  </div>
                  <h3 className="text-lg font-medium text-green-600 dark:text-green-400">
                    {t('initialization.completion.title')}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t('initialization.completion.message')}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Footer */}
      <Footer />
    </div>
  )
}

