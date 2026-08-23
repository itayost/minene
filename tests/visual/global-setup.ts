import { chromium, type FullConfig } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export const STORAGE_STATE = 'tests/visual/.auth/state.json'

/**
 * Signs in once and saves the cookies every visual test reuses. Without this the
 * suite would compare the login screen against four content references and fail
 * twenty times for one reason.
 */
export default async function globalSetup(config: FullConfig) {
  const email = process.env.VIEWER_TEST_EMAIL
  const password = process.env.VIEWER_TEST_PASSWORD
  const baseURL = config.projects[0]?.use.baseURL

  if (!email || !password || !baseURL) {
    throw new Error(
      'The visual suite needs VIEWER_TEST_EMAIL and VIEWER_TEST_PASSWORD to sign in. '
      + 'See the "Visual references" section of README.md.',
    )
  }

  await mkdir(dirname(STORAGE_STATE), { recursive: true })

  const browser = await chromium.launch()
  const page = await browser.newPage({ baseURL })
  await page.goto('/login')
  await page.getByLabel('אימייל').fill(email)
  await page.getByLabel('סיסמה').fill(password)
  await page.getByRole('button', { name: 'כניסה' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
  await page.context().storageState({ path: STORAGE_STATE })
  await browser.close()
}
