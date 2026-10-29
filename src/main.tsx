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
    // 记「哪个 worker 已经提醒过」而不是一个布尔值：下一次更新装好之后
    // 还能再提醒一次，同一个 worker 不会反复弹。
    let announcedWorker: ServiceWorker | null = null
    const announceUpdate = (worker: ServiceWorker | null) => {
      if (!navigator.serviceWorker.controller) return
      if (worker && announcedWorker === worker) return
      announcedWorker = worker
      window.dispatchEvent(new CustomEvent('ladderlab:update-ready'))
    }

    void navigator.serviceWorker
      // GitHub Pages 会给 sw.js 也会带上 10 分钟缓存，updateViaCache: 'none'
      // 保证每次打开都重新校验脚本本身，旧缓存不会一直留在学生电脑上。
      .register(new URL('sw.js', document.baseURI), { updateViaCache: 'none' })
      .then((registration) => {
        const watchWorker = (worker: ServiceWorker | null) => {
          if (!worker) return
          if (worker.state === 'installed') announceUpdate(worker)
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed') announceUpdate(worker)
          })
        }

        registration.addEventListener('updatefound', () => watchWorker(registration.installing))
        watchWorker(registration.waiting)

        const checkForUpdate = () => {
          void registration.update().catch(() => undefined)
        }
        checkForUpdate()
        window.setInterval(checkForUpdate, 30 * 60 * 1000)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate()
        })
      })
      .catch(() => undefined)
  })
}
