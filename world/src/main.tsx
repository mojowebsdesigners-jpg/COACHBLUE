import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// before anything builds a scene: static objects stop recomputing matrices
import './lib/matrixCache'
import App from './App.tsx'

// the static content in index.html is for crawlers and no-JS visitors; the app
// serves the same copy through EXIT 3D once it takes over
document.getElementById('static-content')?.remove()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
