// providers/theme.tsx — 暗色默认 / 亮色可切（token 见 styles/globals.css）
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Theme = 'dark' | 'light'

interface ThemeState {
  theme: Theme
  toggle: () => void
}

const ThemeContext = createContext<ThemeState>({ theme: 'dark', toggle: () => {} })

function initial(): Theme {
  try {
    const saved = localStorage.getItem('sf.theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* private mode */ }
  return 'dark'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initial)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('sf.theme', theme) } catch { /* ignore */ }
  }, [theme])

  const toggle = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}
