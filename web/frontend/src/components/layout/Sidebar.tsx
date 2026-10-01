// components/layout/Sidebar.tsx — 左侧导航（桌面全宽 / 窄屏图标化）+ 语言/主题/链路状态
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard, Fan, BellRing, ChartLine, Cpu, Languages, Moon, Sun,
} from 'lucide-react'
import { useWs } from '../../providers/ws'
import { useTheme } from '../../providers/theme'
import { LANGS } from '../../i18n'
import { cn } from '../../lib/utils'
import { Tooltip } from '../ui/tooltip'

const NAV = [
  { to: '/', icon: LayoutDashboard, key: 'nav.dashboard' },
  { to: '/fans', icon: Fan, key: 'nav.fans' },
  { to: '/alerts', icon: BellRing, key: 'nav.alerts' },
  { to: '/history', icon: ChartLine, key: 'nav.history' },
  { to: '/devices', icon: Cpu, key: 'nav.devices' },
] as const

export function Sidebar() {
  const { t, i18n } = useTranslation()
  const { connected } = useWs()
  const { theme, toggle } = useTheme()

  const nextLang = LANGS.find(l => l.code !== i18n.language)?.code ?? 'en-US'
  const nextLangLabel = LANGS.find(l => l.code === nextLang)?.label ?? 'EN'

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-14 flex-col border-r border-line bg-surface backdrop-blur-xl lg:w-52">
      {/* Brand */}
      <div className="flex h-14 items-center gap-2.5 border-b border-line px-3 lg:px-4">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary text-on-primary shadow-[0_0_16px_-2px_var(--glow)]">
          <Fan size={17} />
        </span>
        <span className="hidden truncate text-sm font-bold tracking-wide lg:block">
          {t('app.title')}
        </span>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2 lg:p-3">
        {NAV.map(({ to, icon: Icon, key }) => (
          <Tooltip key={to} content={<span className="lg:hidden">{t(key)}</span>}>
            <NavLink
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-sm font-medium transition-all',
                  'lg:px-3',
                  isActive
                    ? 'bg-primary-soft text-primary'
                    : 'text-muted hover:bg-surface-2 hover:text-fg',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={18} className={cn('shrink-0', isActive && 'drop-shadow-[0_0_6px_var(--glow)]')} />
                  <span className="hidden lg:block">{t(key)}</span>
                  {isActive && (
                    <span className="ml-auto hidden h-1.5 w-1.5 rounded-full bg-primary lg:block" />
                  )}
                </>
              )}
            </NavLink>
          </Tooltip>
        ))}
      </nav>

      {/* Bottom controls */}
      <div className="flex flex-col gap-2 border-t border-line p-2 lg:p-3">
        <button
          onClick={() => void i18n.changeLanguage(nextLang)}
          title={nextLangLabel}
          className="flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-muted transition-colors hover:bg-surface-2 hover:text-fg lg:px-3"
        >
          <Languages size={17} className="shrink-0" />
          <span className="hidden text-sm lg:block">{nextLangLabel}</span>
        </button>
        <button
          onClick={toggle}
          title={theme === 'dark' ? 'Light' : 'Dark'}
          className="flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-muted transition-colors hover:bg-surface-2 hover:text-fg lg:px-3"
        >
          {theme === 'dark' ? <Sun size={17} className="shrink-0" /> : <Moon size={17} className="shrink-0" />}
          <span className="hidden text-sm lg:block">{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
        <div
          className={cn(
            'flex items-center gap-3 rounded-xl px-2.5 py-2 text-xs lg:px-3',
            connected ? 'text-ok' : 'text-danger',
          )}
        >
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              connected ? 'bg-ok pulse-dot' : 'bg-danger',
            )}
          />
          <span className="hidden lg:block">{connected ? t('common.connected') : t('common.disconnected')}</span>
        </div>
      </div>
    </aside>
  )
}
