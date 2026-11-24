import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@skpods/ui/styles.css'
import './app.css'
import { App } from './App'
import { installPodProxy } from './lib/podproxy'

installPodProxy()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
