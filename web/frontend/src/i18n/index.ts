// i18n/index.ts — react-i18next 初始化（zh-CN 默认，localStorage 持久化）
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhCN from './zh-CN'
import enUS from './en-US'

export const LANGS = [
  { code: 'zh-CN', label: '中文' },
  { code: 'en-US', label: 'English' },
] as const

export type LangCode = (typeof LANGS)[number]['code']

function initialLang(): LangCode {
  try {
    const saved = localStorage.getItem('sf.lang')
    if (saved === 'zh-CN' || saved === 'en-US') return saved
  } catch { /* private mode */ }
  return 'zh-CN'
}

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS },
  },
  lng: initialLang(),
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
})

// 语言切换时同步 <html lang> 与标题
i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng
  try { localStorage.setItem('sf.lang', lng) } catch { /* ignore */ }
})

export default i18n
