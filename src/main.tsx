import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import './motion.css'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { monitorServiceWorkerUpdates } from './lib/swUpdate.ts'

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
      .then((registration) => {
        // 更新提示统一交给 UpdateBanner（lib/swUpdate.ts）：它能分辨「已安装待接管」
        // 与「已经接管」，也不会在控制器还没移交时把提示提前收掉。
        monitorServiceWorkerUpdates({
          registration,
          container: navigator.serviceWorker,
        })

        const checkForUpdate = (): void => {
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
