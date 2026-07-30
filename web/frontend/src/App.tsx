import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Fans from './pages/Fans'
import Alerts from './pages/Alerts'
import History from './pages/History'
import Devices from './pages/Devices'

export default function App() {
  return (
    <BrowserRouter>
      <nav style={{ display: 'flex', gap: '1rem', padding: '0.75rem 1.5rem', background: '#1a1a2e', color: '#eee' }}>
        <strong>🌀 Smart Fan Controller</strong>
        {[
          { to: '/',         label: 'Dashboard' },
          { to: '/fans',     label: 'Fans' },
          { to: '/alerts',   label: 'Alerts' },
          { to: '/history',  label: 'History' },
          { to: '/devices',  label: 'Devices' },
        ].map(({ to, label }) => (
          <NavLink key={to} to={to} style={({ isActive }) => ({ color: isActive ? '#00d4ff' : '#aaa', textDecoration: 'none' })}>
            {label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route path="/"        element={<Dashboard />} />
        <Route path="/fans"    element={<Fans />} />
        <Route path="/alerts"  element={<Alerts />} />
        <Route path="/history" element={<History />} />
        <Route path="/devices" element={<Devices />} />
      </Routes>
    </BrowserRouter>
  )
}
