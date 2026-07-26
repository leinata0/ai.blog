import { defineConfig } from '@playwright/test'

const viewports = [
  ['mobile-390', 390, 844],
  ['tablet-768', 768, 1024],
  ['laptop-1024', 1024, 800],
  ['desktop-1440', 1440, 900],
]

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: 4,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'output/playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      maxDiffPixelRatio: 0.01,
    },
  },
  projects: viewports.map(([name, width, height]) => ({
    name,
    use: { viewport: { width, height }, colorScheme: 'dark' },
  })),
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
