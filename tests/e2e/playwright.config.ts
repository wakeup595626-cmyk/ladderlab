import { defineConfig, devices } from '@playwright/test'

// Preview servers from other checkouts commonly sit on Vite's default 4173 and
// would quietly serve the wrong build, so E2E runs on its own port. E2E_PORT
// allows parallel runs to take another port.
const port = Number(process.env.E2E_PORT ?? 4319)
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: '.',
  // Vitest collects **/*.spec.ts by default, so Playwright specs use .e2e.ts to
  // stay out of `npm test` without an extra vitest config.
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  outputDir: '../../test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: '../../playwright-report', open: 'never' }],
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Serves dist/; `npm run test:e2e` rebuilds it first through pretest:e2e.
    command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    // Never adopt a server that happens to hold the port: it may be a preview
    // from another checkout running an entirely different build.
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
