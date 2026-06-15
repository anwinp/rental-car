import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found. Ensure <div id="root"> exists in index.html.')
}

// QueryProvider + AuthProvider are composed inside App.tsx
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
