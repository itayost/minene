import { expect, test } from '@playwright/test'

const mode = process.env.VIEWER_MODE === 'url' ? 'url' : 'click'

// The multi-group subject and its first group. Chosen because this is the only
// path that exercises the chooser screen.
const SUBJECT_LABEL = 'תוצאות'
const GROUP_LABEL = 'סקירה כללית'
const TOOL_LABEL = 'משכנע'

// next/link prefetches the route behind every link in view. A prefetch only
// warms the client-side route cache and never reaches the painted frame, so
// dropping it leaves the screenshot identical, and it keeps networkidle
// reachable while some of those routes are still being built.
test.beforeEach(async ({ page }) => {
  await page.route(/_rsc=/, (route) => route.abort())
})

async function settle(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle')
  // Page images fade in on load; without this the screenshots race the decode.
  await page.evaluate(() => Promise.all(
    Array.from(document.images)
      .filter((image) => !image.complete)
      .map((image) => new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true })
        image.addEventListener('error', resolve, { once: true })
      })),
  ))
}

test('home', async ({ page }) => {
  await page.goto(mode === 'click' ? '/' : '/minene')
  await settle(page)
  await expect(page).toHaveScreenshot('home.png')
})

test('subject chooser', async ({ page }) => {
  if (mode === 'click') {
    await page.goto('/')
    await page.getByRole('button', { name: SUBJECT_LABEL }).click()
  } else {
    await page.goto('/minene/results')
  }
  await settle(page)
  await expect(page).toHaveScreenshot('subject-menu.png')
})

test('page viewer', async ({ page }) => {
  if (mode === 'click') {
    await page.goto('/')
    await page.getByRole('button', { name: SUBJECT_LABEL }).click()
    await page.getByRole('button', { name: GROUP_LABEL }).click()
  } else {
    await page.goto('/minene/results/overview')
  }
  await settle(page)
  await expect(page).toHaveScreenshot('page-viewer.png')
})

test('tool screen', async ({ page }) => {
  if (mode === 'click') {
    await page.goto('/')
    await page.getByRole('button', { name: TOOL_LABEL }).click()
  } else {
    await page.goto('/minene/tools/persuade')
  }
  await settle(page)
  await expect(page).toHaveScreenshot('tool.png')
})
