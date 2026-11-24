import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@skpods/ui/styles.css'
import './app.css'
import { Facility } from './pages/Facility'
import { installPodProxy } from './lib/podproxy'

installPodProxy()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Facility />
  </StrictMode>,
)
