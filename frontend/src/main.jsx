import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from './contexts/ThemeContext'
import { SiteProvider } from './contexts/SiteContext'
import { UserProvider } from './contexts/UserContext'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
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
  </React.StrictMode>,
)
