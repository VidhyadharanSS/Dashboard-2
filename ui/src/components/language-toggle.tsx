import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export function LanguageToggle() {
  const { i18n } = useTranslation()

  useEffect(() => {
    if (i18n.language !== 'en') {
      i18n.changeLanguage('en')
    }
  }, [i18n])

  return null
}
