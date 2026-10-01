import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Sidebar } from './components/layout/Sidebar'
import { useTheme } from './providers/theme'
import Dashboard from './pages/Dashboard'
import Fans from './pages/Fans'
import Alerts from './pages/Alerts'
import History from './pages/History'
import Devices from './pages/Devices'

function ThemedToaster() {
  const { theme } = useTheme()
  return (
    <Toaster
      position="top-center"
      theme={theme}
      toastOptions={{
        style: {
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          color: 'var(--fg)',
          backdropFilter: 'blur(14px)',
        },
      }}
    />
  )
}

export default function App() {
  const { t } = useTranslation()

  return (
    <BrowserRouter>
      <Sidebar />
      <main className="relative z-10 ml-14 min-h-screen px-4 py-6 lg:ml-52 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/fans" element={<Fans />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/history" element={<History />} />
            <Route path="/devices" element={<Devices />} />
          </Routes>
        </div>
        {/* 页脚署名 */}
        <footer className="mx-auto mt-10 max-w-6xl pb-4 text-center text-[11px] text-faint">
          {t('app.title')} · {t('app.subtitle')}
        </footer>
      </main>
      <ThemedToaster />
    </BrowserRouter>
  )
}
