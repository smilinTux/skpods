import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@skpods/ui/styles.css'
import './guardian.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
