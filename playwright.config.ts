import { defineConfig, devices } from '@playwright/test'

/**
 * The references in tests/visual/__snapshots__ were captured from the Vite build,
 * which Task 5 deleted. Nothing can recreate them, so an overwrite has to be
 * recovered from git rather than re-derived, and the flag matches its value form
 * too (--update-snapshots=all).
 */
function updatesSnapshots(arg: string): boolean {
  return arg === '-u' || arg === '--update-snapshots' || arg.startsWith('--update-snapshots=')
}

if (process.argv.some(updatesSnapshots)) {
  throw new Error(
    'Refusing to update the visual references. They were captured from the pre-conversion Vite '
    + 'build, which no longer exists, so they cannot be regenerated: an overwrite can only be '
    + 'recovered with git restore tests/visual/__snapshots__. Use pnpm visual:verify to compare '
    + 'against them. To regenerate deliberately, remove this guard from playwright.config.ts first.',
  )
}

const WIDTHS = [320, 375, 768, 1024, 1440] as const

const PORT = 4173
const LOCAL_BASE_URL = `http://127.0.0.1:${PORT}`

/**
 * The suite is a comparison, so the server under it has to be this checkout's
 * current output. Playwright builds and starts it here rather than trusting one
 * a reader happened to leave running: a stale server would be compared against
 * the frozen references and pass. VIEWER_BASE_URL still points the run at an
 * already-deployed URL, and then there is nothing here to start.
 */
const webServer = process.env.VIEWER_BASE_URL ? undefined : {
  command: `pnpm build && pnpm start --port ${PORT}`,
  url: LOCAL_BASE_URL,
  reuseExistingServer: false,
  timeout: 240_000,
}

export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  webServer,
  use: {
    baseURL: process.env.VIEWER_BASE_URL ?? LOCAL_BASE_URL,
  },
  snapshotPathTemplate: '{testDir}/__snapshots__/{arg}-{projectName}{ext}',
  projects: WIDTHS.map((width) => ({
    name: `w${width}`,
    use: { ...devices['Desktop Chrome'], viewport: { width, height: 900 } },
  })),
})
