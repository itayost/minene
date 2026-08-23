import { defineConfig, devices } from '@playwright/test'

const WIDTHS = [320, 375, 768, 1024, 1440] as const

export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.VIEWER_BASE_URL ?? 'http://127.0.0.1:4173',
  },
  snapshotPathTemplate: '{testDir}/__snapshots__/{arg}-{projectName}{ext}',
  projects: WIDTHS.map((width) => ({
    name: `w${width}`,
    use: { ...devices['Desktop Chrome'], viewport: { width, height: 900 } },
  })),
})
