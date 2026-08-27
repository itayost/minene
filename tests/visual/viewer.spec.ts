import { expect, test } from '@playwright/test'

const mode = process.env.VIEWER_MODE === 'url' ? 'url' : 'click'

// Every route needs a session now, so without credentials this suite would fail
// twenty times with an unhelpful screenshot of the login screen. Skipping with a
// reason is the honest outcome: a missing prerequisite is not a regression.
test.skip(
  !process.env.VIEWER_TEST_EMAIL || !process.env.VIEWER_TEST_PASSWORD,
  'Set VIEWER_TEST_EMAIL and VIEWER_TEST_PASSWORD to run the visual comparison.',
)

// The multi-group subject and its first group. Chosen because this is the only
// path that exercises the chooser screen.
const SUBJECT_LABEL = 'תוצאות'
const GROUP_LABEL = 'סקירה כללית'

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

/*
 * The `home` comparison is retired. /minene is the Brain cockpit now, so the
 * screen those references captured does not exist to be compared against.
 *
 * This is retirement, not regeneration. The guards in playwright.config.ts and
 * the visual:reference script exist to stop a reference being silently
 * overwritten with post-conversion output; deleting one whose screen has been
 * deliberately replaced is a different act, and the remaining fifteen stay a
 * live gate over the three screens that still exist.
 */

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

/*
 * The tool-screen comparison is retired along with its five references.
 *
 * It captured /minene/tools/persuade rendering the generic ToolScreen, and that
 * screen was deliberately replaced by the persuasion tab. This is retirement,
 * not regeneration: the guards exist to stop a reference being silently
 * overwritten with post-change output, and deleting one whose screen no longer
 * exists is a different act -- the same call c0cee5f made for the home
 * reference.
 *
 * The remaining ten, over subject-menu and page-viewer, stay a live gate.
 */
