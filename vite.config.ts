import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const reactVendorPattern =
  /[/\\]node_modules[/\\](?:react|react-dom|scheduler)(?:[/\\]|$)/

function chunkForModule(id: string): string | undefined {
  const normalizedId = id.replaceAll('\\', '/')

  if (reactVendorPattern.test(normalizedId)) return 'vendor'
  // 顺序功能图只在导出时按需加载：归纳器、渲染器和导出器单独成块，
  // 不跟着首屏的 engine / lib 一起下发。
  if (
    normalizedId.includes('/src/engine/sfc.') ||
    normalizedId.includes('/src/engine/sfcRender.') ||
    normalizedId.includes('/src/lib/sfcExport.')
  ) {
    return 'sfc'
  }
  if (normalizedId.includes('/src/engine/')) return 'engine'
  const reactConsumerLibModule =
    normalizedId.includes('/src/lib/useConfirmDialog.') ||
    normalizedId.includes('/src/lib/useDragController.') ||
    normalizedId.includes('/src/lib/useMediaQuery.') ||
    normalizedId.includes('/src/lib/useModalFocus.')
  if (normalizedId.includes('/src/lib/') && !reactConsumerLibModule) return 'lib'
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    // scripts/ 下的 CLI ↔ 网页互通契约测试同样必须进 CI，
    // 否则分享链接改了一侧、另一侧悄悄失配也没人发现。
    include: ['src/**/*.test.ts', 'scripts/**/*.contract.test.mjs'],
  },
  build: {
    rolldownOptions: {
      output: {
        // Keep the chunk category in the file name; the content hash still
        // makes each file safe to cache aggressively.
        chunkFileNames: 'assets/[name]-[hash].js',
        manualChunks: chunkForModule,
      },
    },
  },
})
