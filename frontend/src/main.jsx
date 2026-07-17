import React from 'react'
import { createRoot } from 'react-dom/client'
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
// The prerendered markup is an SEO/no-JS snapshot, not a React server render.
// Once JavaScript starts, React intentionally replaces that snapshot.
createRoot(rootEl).render(tree)
