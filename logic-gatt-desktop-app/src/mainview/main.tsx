import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { SettingsProvider } from './hooks/useSettings'
import { installWebviewLogCapture } from './lib/logCapture'
import './App.css'

// Ship webview errors/warnings to the Bun-side session log (the webview can't write
// files itself). Installed before render so a crash during mount is still captured.
installWebviewLogCapture()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>
)
