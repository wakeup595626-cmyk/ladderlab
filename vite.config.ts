import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const reactVendorPattern =
  /[/\\]node_modules[/\\](?:react|react-dom|scheduler)(?:[/\\]|$)/

function chunkForModule(id: string): string | undefined {
  const normalizedId = id.replaceAll('\\', '/')

  if (reactVendorPattern.test(normalizedId)) return 'vendor'
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
    include: ['src/**/*.test.ts'],
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
