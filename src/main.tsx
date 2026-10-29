import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import './motion.css'
import ErrorBoundary from './components/ErrorBoundary.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      // GitHub Pages 会给 sw.js 也会带上 10 分钟缓存，updateViaCache: 'none'
      // 保证每次打开都重新校验脚本本身，旧缓存不会一直留在学生电脑上。
      .register(new URL('sw.js', document.baseURI), { updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch(() => undefined)
  })
}
