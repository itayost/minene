import { defineConfig, devices } from '@playwright/test'
import { STORAGE_STATE } from './tests/visual/global-setup'

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

/**
 * Every route needs a session now, so the suite has to sign in before it can
 * compare anything. Without credentials it skips rather than failing twenty
 * times against screenshots of the login screen: a missing prerequisite is not
 * a regression, and failing confusingly on one is the trap the webServer block
 * already closed once.
 */
const hasCredentials = Boolean(process.env.VIEWER_TEST_EMAIL && process.env.VIEWER_TEST_PASSWORD)

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
const webServer = (process.env.VIEWER_BASE_URL || !hasCredentials) ? undefined : {
  command: `pnpm build && pnpm start --port ${PORT}`,
  // Probes /login, not the root. Every content route now requires a session, so
  // an unauthenticated request to / answers 500 or redirects, and Playwright
  // would wait for a readiness signal that can never arrive. /login is reachable
  // by definition -- it is where an unauthenticated caller is sent.
  url: `${LOCAL_BASE_URL}/login`,
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
  globalSetup: hasCredentials ? './tests/visual/global-setup' : undefined,
  use: {
    baseURL: process.env.VIEWER_BASE_URL ?? LOCAL_BASE_URL,
  },
  snapshotPathTemplate: '{testDir}/__snapshots__/{arg}-{projectName}{ext}',
  projects: WIDTHS.map((width) => ({
    name: `w${width}`,
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width, height: 900 },
      ...(hasCredentials ? { storageState: STORAGE_STATE } : {}),
    },
  })),
})
