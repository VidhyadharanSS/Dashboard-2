import { useTranslation } from 'react-i18next'

export function Footer() {
  const { t } = useTranslation()
  return (
    <footer className="border-t border-border">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row justify-between items-center space-y-2 md:space-y-0">
          <p className="text-sm text-muted-foreground">
            {t('login.footer', { year: new Date().getFullYear() })}
          </p>
          <div className="flex space-x-6 text-sm text-muted-foreground">
            <a
              href="https://kite.zzde.com"
              target="_blank"
              className="hover:text-foreground transition-colors"
            >
              {t('login.documentation')}
            </a>
            <a
              href="https://github.com/zxh326/kite"
              target="_blank"
              className="hover:text-foreground transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}

