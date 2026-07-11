import React from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from './contexts/ThemeContext'
import { SiteProvider } from './contexts/SiteContext'
import { UserProvider } from './contexts/UserContext'
import App from './App'
import './index.css'

const tree = (
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <SiteProvider>
          <UserProvider>
            <App />
          </UserProvider>
        </SiteProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
)

const rootEl = document.getElementById('root')
// Prerender writes SEO HTML into #root. Hydrate when present so first paint
// keeps the static shell; fall back to createRoot for empty SPA shells.
if (rootEl?.hasChildNodes()) {
  hydrateRoot(rootEl, tree)
} else {
  createRoot(rootEl).render(tree)
}
