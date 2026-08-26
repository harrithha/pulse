import React from 'react'
import ReactDOM from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import { prefetchIpPlace } from './lib/location'
import { prefetchWorldEdition } from './lib/news'
import App from './App'
import './index.css'

prefetchWorldEdition()
prefetchIpPlace()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Analytics />
  </React.StrictMode>,
)
