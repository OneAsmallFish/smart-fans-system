import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import './i18n'
import { WsProvider } from './providers/ws'
import { ThemeProvider } from './providers/theme'
import { TooltipProvider } from './components/ui/tooltip'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <WsProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </WsProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
