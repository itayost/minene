import { defineConfig, devices } from '@playwright/test'

/**
 * The references in tests/visual/__snapshots__ were captured from the Vite build,
 * which Task 5 deleted. Nothing can recreate them, so overwriting one is
 * unrecoverable, and the flag matches its value form too (--update-snapshots=all).
 */
function updatesSnapshots(arg: string): boolean {
  return arg === '-u' || arg === '--update-snapshots' || arg.startsWith('--update-snapshots=')
}

if (process.argv.some(updatesSnapshots)) {
  throw new Error(
    'Refusing to update the visual references. They were captured from the pre-conversion Vite '
    + 'build, which no longer exists, so an overwrite cannot be undone and the conversion loses '
    + 'the only evidence that the design is unchanged. Use pnpm visual:verify to compare against '
    + 'them. To regenerate deliberately, remove this guard from playwright.config.ts first.',
  )
}

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
