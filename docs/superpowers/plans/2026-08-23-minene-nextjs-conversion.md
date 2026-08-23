# Minene Next.js Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the multi-brand content viewer from a client-rendered Vite single-page application to a Next.js App Router application with a real URL for every screen, changing no visible behaviour.

**Architecture:** Server components own routing only: brand resolution, URL-to-screen resolution, redirects, 404s, metadata, and static params. Every interactive component stays a client component and stays prop-driven, receiving `href` strings computed by route components rather than calling `useRouter` itself. Vite and Next deliberately coexist until the final task, so the Next output can be compared against a live Vite build at every step.

**Tech Stack:** Next.js 16.3.1 (App Router), React 19.2.8, TypeScript 7, Vitest 4 with jsdom, Testing Library, Playwright for visual verification, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-23-minene-nextjs-conversion-design.md`

## Global Constraints

- Branch: `feat/nextjs-conversion`. Already created, spec already committed as `b20cbc4`.
- Node `>=20.19.0`. Do not lower this floor.
- TypeScript `strict` and `noUncheckedIndexedAccess` remain enabled. Array and record index access yields `T | undefined` and must be narrowed, never asserted with `!`.
- Baseline is 103 passing tests across 9 files. `pnpm test:run` must be green at the end of every task. Tests may be rewritten only where a task explicitly says so.
- No visual change. The viewer must look identical at 320, 375, 768, 1024, and 1440.
- No emojis in code, comments, or documentation.
- Hebrew right-to-left support is a product constraint, not a localisation layer. Do not alter `dir`, `lang`, or any Hebrew copy.
- Commit after every task using the repository's format: `<type>: <description>` where type is one of feat, fix, refactor, docs, test, chore, perf, ci. No attribution trailer.
- Vite must keep building and running until Task 5, which is the cutover. `next/link` enters the
  shared components in Task 5 and cannot render outside Next, so the Vite build necessarily dies
  at that moment. Every task from 5 onward is verified against the Task 1 reference screenshots.
  This is why Task 1 cannot be skipped or deferred.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `playwright.config.ts` | Playwright projects, one per viewport width |
| `tests/visual/viewer.spec.ts` | Visual reference capture and comparison, both modes |
| `src/core/hrefs.ts` | Pure URL builders. The single source of every internal link |
| `app/layout.tsx` | Root html shell, font, global stylesheet |
| `app/page.tsx` | Redirect to the registry default brand |
| `app/not-found.tsx` | Generic 404 for paths with no brand |
| `app/[brandId]/layout.tsx` | Brand resolution, metadata, viewport, persistent shell |
| `app/[brandId]/brand-shell-client.tsx` | Client wrapper deriving the current screen from the URL |
| `app/[brandId]/page.tsx` | Home, subject grid |
| `app/[brandId]/[subjectId]/page.tsx` | Subject chooser, or redirect for single-group subjects |
| `app/[brandId]/[subjectId]/[groupId]/page.tsx` | Server half of the page viewer |
| `app/[brandId]/[subjectId]/[groupId]/viewer-client.tsx` | Paging, progress restore, share sheet |
| `app/[brandId]/tools/[toolId]/page.tsx` | Tool screen |
| `src/hooks/use-progress.ts` | Client-side localStorage access for reading progress |
| `vitest.config.ts` | Vitest configuration, split out of `vite.config.ts` |
| `tests/hrefs.test.ts` | Tests for the URL builders |
| `tests/resolve-screen.test.ts` | Tests for URL-to-screen resolution |

**Modified:**

| File | Change |
|---|---|
| `src/core/navigation.ts` | Gains `resolveScreen`, `clampPageIndex`, `parentHref`. Loses the action reducer in Task 9 |
| `src/core/brand-registry.ts` | Exports `DEFAULT_BRAND_ID`. Loses `resolveBrandId` in Task 9 |
| `src/core/validate-brand.ts` | Rejects `tools` as a subject identifier |
| `src/components/HomeScreen.tsx` | Anchors instead of buttons |
| `src/components/SubjectMenu.tsx` | Anchors instead of buttons |
| `src/components/BrandShell.tsx` | Anchors for back, home, and tools. Drops the `document.title` mutation |
| `src/styles.css` | `#root` selector replaced, page background moved in from `index.html` |
| `package.json`, `tsconfig.json`, `.gitignore` | Tooling |

**Deleted in Task 5, the cutover:** `index.html`, `src/main.tsx`, `src/App.tsx`, `vite.config.ts`,
`vercel.json`, `dist/`, `tests/App.test.tsx`.

**Deleted in Task 9:** the navigation action reducer, `resolveBrandId`, and the reducer's tests.

---

### Task 1: Capture visual reference screenshots

This task must come first. Once `index.html` is deleted there is nothing left to compare against, and the entire claim of this conversion is that nothing looks different.

Under Vite there are no URLs, so the reference run reaches each screen by clicking. Under Next the same screens are reachable directly. One spec file handles both through the `VIEWER_MODE` environment variable, so both runs produce identically named snapshots that Playwright can compare.

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/visual/viewer.spec.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces: committed reference PNGs under `tests/visual/__snapshots__/`, and the scripts `pnpm visual:reference` and `pnpm visual:verify`

- [ ] **Step 1: Install Playwright**

```bash
pnpm add -D @playwright/test@^1.56.0
pnpm exec playwright install chromium
```

- [ ] **Step 2: Write the Playwright config**

Create `playwright.config.ts`:

```ts
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
```

- [ ] **Step 3: Write the visual spec**

Create `tests/visual/viewer.spec.ts`. `VIEWER_MODE=click` drives the Vite single-page application, `VIEWER_MODE=url` drives the Next routes. Snapshot names are identical in both modes.

```ts
import { expect, test } from '@playwright/test'

const mode = process.env.VIEWER_MODE === 'url' ? 'url' : 'click'

// The multi-group subject and its first group. Chosen because this is the only
// path that exercises the chooser screen.
const SUBJECT_LABEL = 'תוצאות'
const GROUP_LABEL = 'סקירה כללית'
const TOOL_LABEL = 'משכנע'

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
  await page.goto('/minene')
  await settle(page)
  await expect(page).toHaveScreenshot('home.png')
})

test('subject chooser', async ({ page }) => {
  if (mode === 'click') {
    await page.goto('/minene')
    await page.getByRole('button', { name: SUBJECT_LABEL }).click()
  } else {
    await page.goto('/minene/results')
  }
  await settle(page)
  await expect(page).toHaveScreenshot('subject-menu.png')
})

test('page viewer', async ({ page }) => {
  if (mode === 'click') {
    await page.goto('/minene')
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
    await page.goto('/minene')
    await page.getByRole('button', { name: TOOL_LABEL }).click()
  } else {
    await page.goto('/minene/tools/persuade')
  }
  await settle(page)
  await expect(page).toHaveScreenshot('tool.png')
})
```

- [ ] **Step 4: Add the scripts**

In `package.json` `scripts`, add:

```json
"visual:reference": "VIEWER_MODE=click playwright test --update-snapshots",
"visual:verify": "VIEWER_MODE=url playwright test"
```

In `.gitignore`, add:

```
test-results/
playwright-report/
```

- [ ] **Step 5: Build and serve the current Vite application**

```bash
pnpm build
pnpm preview --host 127.0.0.1 --port 4173
```

Leave this running in a second terminal.

- [ ] **Step 6: Capture the references**

```bash
pnpm visual:reference
```

Expected: 20 snapshots written to `tests/visual/__snapshots__/`, four screens across five widths.

- [ ] **Step 7: Confirm the references are stable**

Run it a second time without `--update-snapshots`:

```bash
VIEWER_MODE=click pnpm exec playwright test
```

Expected: PASS, 20 tests. A failure here means the capture is non-deterministic, most likely an image still decoding. Fix `settle` before continuing, because a flaky reference makes the whole verification worthless.

- [ ] **Step 8: Commit**

```bash
git add playwright.config.ts tests/visual package.json pnpm-lock.yaml .gitignore
git commit -m "test: capture visual references before the Next.js conversion"
```

---

### Task 2: Reserve `tools` as a subject identifier

Next resolves the static `tools` segment before the dynamic `[subjectId]` segment, so a brand declaring a subject with the identifier `tools` would become permanently unreachable at that route. No current brand uses it. This rule must land before the route tree exists.

**Files:**
- Modify: `src/core/validate-brand.ts`
- Test: `tests/validate-brand.test.ts`

**Interfaces:**
- Consumes: `validateBrand(brand: BrandManifest): ValidationIssue[]` from `src/core/validate-brand.ts`
- Produces: `RESERVED_SUBJECT_IDS: ReadonlySet<string>` exported from `src/core/validate-brand.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/validate-brand.test.ts`, inside the existing `describe('validateBrand', ...)` block:

```ts
it('rejects a subject using the reserved tools identifier', () => {
  const brand: BrandManifest = {
    ...demoBrand,
    subjects: [{ ...demoBrand.subjects[0]!, id: 'tools' }],
  }

  const issues = validateBrand(brand)

  expect(issues).toContainEqual({
    path: 'subjects[0].id',
    message: 'must not be a reserved identifier',
  })
})

it('accepts a tool using the identifier tools', () => {
  const brand: BrandManifest = {
    ...demoBrand,
    tools: [{ ...demoBrand.tools[0]!, id: 'tools' }],
  }

  const issues = validateBrand(brand)

  expect(issues).not.toContainEqual(
    expect.objectContaining({ path: 'tools[0].id' }),
  )
})
```

The second test matters: only the subject namespace collides with the route segment. A tool called `tools` resolves to `/minene/tools/tools`, which is unambiguous and must stay legal.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/validate-brand.test.ts`
Expected: FAIL, the first new test reports that the issue array does not contain the reserved-identifier entry.

- [ ] **Step 3: Implement the rule**

In `src/core/validate-brand.ts`, add near the top beside `urlSafeId`:

```ts
// `tools` is a static route segment under /[brandId]/. Next resolves it before
// the dynamic [subjectId] segment, so a subject with this id would be
// permanently unreachable. Tools themselves are unaffected: /minene/tools/tools
// is unambiguous.
export const RESERVED_SUBJECT_IDS: ReadonlySet<string> = new Set(['tools'])
```

Inside `validateBrand`, in the `brand.subjects.forEach` callback, directly after the existing `validateId(subject.id, ...)` call:

```ts
if (RESERVED_SUBJECT_IDS.has(subject.id)) {
  addIssue(`${subjectPath}.id`, 'must not be a reserved identifier')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/validate-brand.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Run the whole suite and the brand validator**

Run: `pnpm test:run && pnpm validate:brands`
Expected: 105 tests pass, and `Validated 1 brand manifest.`

- [ ] **Step 6: Commit**

```bash
git add src/core/validate-brand.ts tests/validate-brand.test.ts
git commit -m "feat: reject the reserved tools subject identifier"
```

---

### Task 3: Pure routing core

Everything in this task is pure TypeScript with no framework involvement, so it is fully testable before Next exists. The action reducer is left in place and untouched; it is removed in Task 9.

**Files:**
- Create: `src/core/hrefs.ts`
- Create: `tests/hrefs.test.ts`
- Create: `tests/resolve-screen.test.ts`
- Modify: `src/core/navigation.ts`
- Modify: `src/core/brand-registry.ts`

**Interfaces:**
- Consumes: `Screen` and the private `findSubject`/`findGroup` helpers in `src/core/navigation.ts`; `BrandManifest` from `src/core/brand-types.ts`
- Produces:
  - `brandHref(brandId: string): string`
  - `subjectHref(brandId: string, subjectId: string): string`
  - `groupHref(brandId: string, subjectId: string, groupId: string, pageIndex?: number): string`
  - `toolHref(brandId: string, toolId: string): string`
  - `TOOLS_SEGMENT: 'tools'`
  - `clampPageIndex(pageParam: string | null, pageCount: number): number`
  - `resolveScreen(brand: BrandManifest, segments: readonly string[], pageParam: string | null): Screen | null`
  - `parentHref(brand: BrandManifest, screen: Screen): string`
  - `DEFAULT_BRAND_ID: string` from `src/core/brand-registry.ts`

- [ ] **Step 1: Write the failing tests for the URL builders**

Create `tests/hrefs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { brandHref, groupHref, subjectHref, toolHref } from '../src/core/hrefs'

describe('hrefs', () => {
  it('builds a brand href', () => {
    expect(brandHref('minene')).toBe('/minene')
  })

  it('builds a subject href', () => {
    expect(subjectHref('minene', 'results')).toBe('/minene/results')
  })

  it('builds a group href without a page parameter for the first page', () => {
    expect(groupHref('minene', 'results', 'overview')).toBe('/minene/results/overview')
    expect(groupHref('minene', 'results', 'overview', 0)).toBe('/minene/results/overview')
  })

  it('builds a one-based page parameter for later pages', () => {
    expect(groupHref('minene', 'results', 'overview', 2)).toBe('/minene/results/overview?page=3')
  })

  it('builds a tool href', () => {
    expect(toolHref('minene', 'persuade')).toBe('/minene/tools/persuade')
  })
})
```

The first page deliberately omits `?page=`, so the canonical URL for a group stays clean.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/hrefs.test.ts`
Expected: FAIL, cannot resolve `../src/core/hrefs`.

- [ ] **Step 3: Implement the URL builders**

Create `src/core/hrefs.ts`:

```ts
/** The static route segment that separates tools from subjects under a brand. */
export const TOOLS_SEGMENT = 'tools'

export function brandHref(brandId: string): string {
  return `/${brandId}`
}

export function subjectHref(brandId: string, subjectId: string): string {
  return `/${brandId}/${subjectId}`
}

/**
 * The page parameter is one-based in the URL and omitted for the first page, so
 * a group's canonical address is its bare path.
 */
export function groupHref(
  brandId: string,
  subjectId: string,
  groupId: string,
  pageIndex?: number,
): string {
  const base = `/${brandId}/${subjectId}/${groupId}`
  if (pageIndex === undefined || pageIndex <= 0) return base
  return `${base}?page=${pageIndex + 1}`
}

export function toolHref(brandId: string, toolId: string): string {
  return `/${brandId}/${TOOLS_SEGMENT}/${toolId}`
}
```

- [ ] **Step 4: Run to verify the builders pass**

Run: `pnpm exec vitest run tests/hrefs.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing tests for screen resolution**

Create `tests/resolve-screen.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { clampPageIndex, parentHref, resolveScreen } from '../src/core/navigation'
import { demoBrand } from './fixtures/demo-brand'

describe('resolveScreen', () => {
  it('resolves the brand root to the home screen', () => {
    expect(resolveScreen(demoBrand, [], null)).toEqual({ kind: 'home' })
  })

  it('resolves a known subject to its chooser', () => {
    expect(resolveScreen(demoBrand, ['multiple'], null))
      .toEqual({ kind: 'menu', subjectId: 'multiple' })
  })

  it('resolves a known group to the viewer at the first page', () => {
    expect(resolveScreen(demoBrand, ['multiple', 'group-one'], null))
      .toEqual({ kind: 'viewer', subjectId: 'multiple', groupId: 'group-one', pageIndex: 0 })
  })

  it('resolves a known tool', () => {
    const toolId = demoBrand.tools[0]!.id
    expect(resolveScreen(demoBrand, ['tools', toolId], null))
      .toEqual({ kind: 'tool', toolId })
  })

  it('rejects an unknown subject', () => {
    expect(resolveScreen(demoBrand, ['nope'], null)).toBeNull()
  })

  it('rejects an unknown group', () => {
    expect(resolveScreen(demoBrand, ['multiple', 'nope'], null)).toBeNull()
  })

  it('rejects an unknown tool', () => {
    expect(resolveScreen(demoBrand, ['tools', 'nope'], null)).toBeNull()
  })

  it('rejects the bare tools segment', () => {
    expect(resolveScreen(demoBrand, ['tools'], null)).toBeNull()
  })

  it('rejects a path deeper than a group', () => {
    expect(resolveScreen(demoBrand, ['multiple', 'group-one', 'extra'], null)).toBeNull()
  })
})

describe('clampPageIndex', () => {
  it('defaults to the first page when absent', () => {
    expect(clampPageIndex(null, 3)).toBe(0)
  })

  it('converts a one-based parameter to a zero-based index', () => {
    expect(clampPageIndex('2', 3)).toBe(1)
  })

  it('clamps a parameter beyond the last page', () => {
    expect(clampPageIndex('99', 3)).toBe(2)
  })

  it('clamps a parameter below the first page', () => {
    expect(clampPageIndex('0', 3)).toBe(0)
    expect(clampPageIndex('-5', 3)).toBe(0)
  })

  it('falls back to the first page for a non-numeric parameter', () => {
    expect(clampPageIndex('abc', 3)).toBe(0)
    expect(clampPageIndex('1.5', 3)).toBe(0)
    expect(clampPageIndex('', 3)).toBe(0)
  })
})

describe('parentHref', () => {
  it('returns the brand root from the chooser', () => {
    expect(parentHref(demoBrand, { kind: 'menu', subjectId: 'multiple' })).toBe('/demo')
  })

  it('returns the chooser from a viewer whose subject has several groups', () => {
    const screen = { kind: 'viewer', subjectId: 'multiple', groupId: 'group-one', pageIndex: 0 } as const
    expect(parentHref(demoBrand, screen)).toBe('/demo/multiple')
  })

  it('returns the brand root from a viewer whose subject has one group', () => {
    const screen = { kind: 'viewer', subjectId: 'single', groupId: 'only-group', pageIndex: 0 } as const
    expect(parentHref(demoBrand, screen)).toBe('/demo')
  })

  it('returns the brand root from a tool', () => {
    expect(parentHref(demoBrand, { kind: 'tool', toolId: demoBrand.tools[0]!.id })).toBe('/demo')
  })
})
```

`parentHref` reproduces exactly the old `back` action: the viewer returns to the chooser only when the subject has more than one group, otherwise to the home screen.

- [ ] **Step 6: Run to verify failure**

Run: `pnpm exec vitest run tests/resolve-screen.test.ts`
Expected: FAIL, `resolveScreen is not a function`.

- [ ] **Step 7: Implement resolution**

In `src/core/navigation.ts`, add these imports at the top:

```ts
import { brandHref, subjectHref, TOOLS_SEGMENT } from './hrefs'
```

and append to the file:

```ts
/**
 * A `?page=` value is a position inside a group that does exist, not a resource
 * of its own, so a bad one is corrected rather than refused.
 */
export function clampPageIndex(pageParam: string | null, pageCount: number): number {
  if (pageParam === null || pageParam.trim() === '') return 0

  const parsed = Number(pageParam)
  if (!Number.isInteger(parsed)) return 0

  return Math.max(0, Math.min(pageCount - 1, parsed - 1))
}

/**
 * Turn the path segments beneath a brand into a screen, or null when the URL
 * names something that does not exist. Null is a 404, never a silent redirect
 * to the home screen: answering a missing resource with 200 would be a lie.
 */
export function resolveScreen(
  brand: BrandManifest,
  segments: readonly string[],
  pageParam: string | null,
): Screen | null {
  if (segments.length === 0) return createInitialScreen()
  if (segments.length > 2) return null

  const first = segments[0]
  const second = segments[1]
  if (first === undefined) return null

  if (first === TOOLS_SEGMENT) {
    if (second === undefined) return null
    return brand.tools.some((tool) => tool.id === second)
      ? { kind: 'tool', toolId: second }
      : null
  }

  const subject = findSubject(brand, first)
  if (!subject) return null
  if (second === undefined) return { kind: 'menu', subjectId: subject.id }

  const group = findGroup(subject, second)
  if (!group || group.pages.length === 0) return null

  return {
    kind: 'viewer',
    subjectId: subject.id,
    groupId: group.id,
    pageIndex: clampPageIndex(pageParam, group.pages.length),
  }
}

/**
 * Where the in-application back control goes. Deterministically the parent
 * route, never history.back(), which preserves the previous back behaviour.
 */
export function parentHref(brand: BrandManifest, screen: Screen): string {
  if (screen.kind === 'viewer') {
    const subject = findSubject(brand, screen.subjectId)
    if (subject && subject.groups.length > 1) return subjectHref(brand.id, subject.id)
  }
  return brandHref(brand.id)
}
```

- [ ] **Step 8: Export the default brand identifier**

In `src/core/brand-registry.ts`, replace the hardcoded fallback inside `resolveBrandId` with a named export so the redirect route and the resolver agree on one value:

```ts
export const DEFAULT_BRAND_ID = 'minene'

export const resolveBrandId = (pathname: string) => {
  const first = pathname.split('/').filter(Boolean)[0]
  return first || DEFAULT_BRAND_ID
}
```

- [ ] **Step 9: Run to verify resolution passes**

Run: `pnpm exec vitest run tests/resolve-screen.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 10: Run the whole suite**

Run: `pnpm test:run`
Expected: 128 tests pass. The action reducer and its 13 tests are still present and still green.

- [ ] **Step 11: Commit**

```bash
git add src/core/hrefs.ts src/core/navigation.ts src/core/brand-registry.ts tests/hrefs.test.ts tests/resolve-screen.test.ts
git commit -m "feat: resolve URLs into screens and build internal hrefs"
```

---

### Task 4: Next.js scaffolding beside Vite

Next and Vite coexist from here until Task 9. `app/` is a separate tree from `src/`, both consume `src/components` and `src/core`, and keeping the Vite build alive means every later task can be compared against a live reference rather than a stale PNG.

**Files:**
- Create: `app/layout.tsx`, `app/page.tsx`, `app/not-found.tsx`
- Create: `vitest.config.ts`
- Modify: `vite.config.ts`, `tsconfig.json`, `package.json`, `.gitignore`, `src/styles.css`

**Interfaces:**
- Consumes: `DEFAULT_BRAND_ID` and `brandHref` from Task 3
- Produces: `pnpm dev:next`, `pnpm build:next`; a working root layout that every brand route nests inside

- [ ] **Step 1: Install Next**

```bash
pnpm add next@16.3.1
pnpm remove @types/node && pnpm add -D @types/node@^26.2.0
```

- [ ] **Step 2: Split the Vitest configuration out of the Vite configuration**

Create `vitest.config.ts`:

```ts
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    setupFiles: './tests/setup.ts',
    css: true,
    exclude: [...configDefaults.exclude, '**/.worktrees/**', '**/tests/visual/**'],
  },
})
```

The `tests/visual` exclusion matters: those are Playwright tests and Vitest must not try to run them.

Replace `vite.config.ts` with a build-only configuration:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Temporary. Deleted in Task 9 once Next owns the build.
export default defineConfig({
  plugins: [react()],
})
```

- [ ] **Step 3: Update tsconfig**

In `tsconfig.json` `compilerOptions`, change `"jsx": "react-jsx"` to `"jsx": "preserve"`, and add:

```json
"incremental": true,
"plugins": [{ "name": "next" }]
```

Change `include` to:

```json
"include": ["src", "app", "scripts", "tests", "vite.config.ts", "vitest.config.ts", "playwright.config.ts", "next-env.d.ts", ".next/types/**/*.ts"]
```

Leave `strict` and `noUncheckedIndexedAccess` alone.

- [ ] **Step 4: Move the page background out of index.html**

`index.html` carries `html, body { margin: 0; background: #e9e9ee; }` inline, and `src/styles.css` targets a `#root` element that Next does not create. In `src/styles.css`, replace:

```css
html,
body,
#root {
  min-height: 100%;
  margin: 0;
}
```

with:

```css
html,
body {
  min-height: 100%;
  margin: 0;
  /* Moved in from index.html so the Next document keeps the same ground colour
     behind the shell and there is no flash before the stylesheet applies. */
  background: #e9e9ee;
}
```

This is safe for the Vite build too: `#root` is a bare `div` filling the body, and it inherits both properties from `body`.

- [ ] **Step 5: Write the root layout**

Create `app/layout.tsx`:

```tsx
import '@fontsource-variable/heebo'
import '../src/styles.css'
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Multi-brand content viewer',
  description: 'A configurable multi-brand content viewer.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#e9e9ee',
}

/**
 * Next permits <html> only in the root layout, and a root layout cannot read a
 * child segment's params, so per-brand lang and dir cannot be server-rendered
 * here. These are the default brand's values; BrandShell corrects them on the
 * client for any brand that differs, and .brand-shell carries its own dir and
 * lang so the rendered result never depends on that effect.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 6: Write the root redirect and the generic 404**

Create `app/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { DEFAULT_BRAND_ID } from '../src/core/brand-registry'
import { brandHref } from '../src/core/hrefs'

export default function RootPage() {
  redirect(brandHref(DEFAULT_BRAND_ID))
}
```

Create `app/not-found.tsx`:

```tsx
import { brandHref } from '../src/core/hrefs'
import { DEFAULT_BRAND_ID } from '../src/core/brand-registry'

export default function NotFound() {
  return (
    <main className="brand-not-found">
      <div className="brand-not-found__card">
        <h1>Page not found</h1>
        <p>There is nothing at this address.</p>
        <a href={brandHref(DEFAULT_BRAND_ID)}>Go to the default brand</a>
      </div>
    </main>
  )
}
```

- [ ] **Step 7: Add the Next scripts**

In `package.json` `scripts`, add alongside the existing entries. Do not replace `dev` or `build` yet:

```json
"dev:next": "next dev",
"build:next": "next build",
"start:next": "next start"
```

In `.gitignore`, add:

```
.next/
next-env.d.ts
```

- [ ] **Step 8: Verify the Next build**

Run: `pnpm build:next`
Expected: the build succeeds and reports three routes, `/`, `/_not-found`, and the 404 handling. `/minene` does not exist yet and returns the not-found page. That is correct for this task.

- [ ] **Step 9: Verify nothing regressed**

Run: `pnpm test:run && pnpm build`
Expected: 128 tests pass and the Vite build still succeeds.

- [ ] **Step 10: Commit**

```bash
git add app vitest.config.ts vite.config.ts tsconfig.json package.json pnpm-lock.yaml .gitignore src/styles.css
git commit -m "chore: add Next.js scaffolding beside the Vite build"
```

This is the last task in which both builds work. Task 5 cuts Vite off.

---

### Task 5: Cut over to Next, with the brand layout, shell, and home route

This is the point of no return, and the largest task. `next/link` enters the shared components here, and it cannot render outside Next, so the Vite build stops working the moment `HomeScreen` is converted. Cutting Vite off first, in one deliberate act, is cleaner than leaving a build that silently no longer works.

Everything from here is verified against the Task 1 references. Do not begin if Task 1 was skipped.

The shell lives in the layout so it persists across navigations rather than remounting. Because a layout cannot read a child segment's params, the shell derives the current screen from the URL itself using the pure `resolveScreen` from Task 3.

**Files:**
- Delete: `index.html`, `src/main.tsx`, `src/App.tsx`, `vite.config.ts`, `vercel.json`, `dist/`, `tests/App.test.tsx`
- Create: `app/[brandId]/layout.tsx`, `app/[brandId]/brand-shell-client.tsx`, `app/[brandId]/page.tsx`
- Modify: `src/components/BrandShell.tsx`, `src/components/HomeScreen.tsx`, `src/styles.css`, `package.json`, `tsconfig.json`, `.gitignore`
- Test: `tests/shared-components.test.tsx`

**Interfaces:**
- Consumes: `resolveScreen`, `parentHref`, `brandHref`, `subjectHref`, `toolHref`, `DEFAULT_BRAND_ID`
- Produces:
  - `BrandShell` props become `{ brand, screen, children, modal?, backHref, homeHref, onShare }`
  - `HomeScreen` props become `{ subjects, subjectHref: (subjectId: string) => string }`
  - `useShareTarget(): { register: (build: (() => PageActionContext) | null) => void }` exported from `app/[brandId]/brand-shell-client.tsx`, which Task 7 uses to hand the shell the page context its share sheet needs

- [ ] **Step 1: Confirm the references exist**

```bash
ls tests/visual/__snapshots__/ | wc -l
```

Expected: 20. If this is not 20, stop and complete Task 1 first. There is no way back after Step 2.

- [ ] **Step 2: Delete the Vite entry point**

```bash
git rm index.html src/main.tsx src/App.tsx vite.config.ts vercel.json tests/App.test.tsx
rm -rf dist
```

`vercel.json` goes because its only content is the catch-all rewrite to `index.html`, which Next makes unnecessary.

`tests/App.test.tsx` is deleted rather than ported. Before deleting, read its 12 assertions and confirm each has a home in `tests/resolve-screen.test.ts`, `tests/hrefs.test.ts`, the component tests, or the visual comparison. The brand-resolution and progress-restore assertions are the two to check carefully; progress restore is covered again in Task 7. Add any assertion that has no home.

- [ ] **Step 3: Swap the scripts**

In `package.json`, replace the script block with:

```json
"scripts": {
  "dev": "next dev",
  "start": "next start",
  "validate:brands": "tsx scripts/validate-brands.ts",
  "test": "vitest",
  "test:run": "vitest run",
  "build": "pnpm validate:brands && tsc --noEmit && next build",
  "check": "pnpm test:run && pnpm build",
  "visual:reference": "VIEWER_MODE=click playwright test --update-snapshots",
  "visual:verify": "VIEWER_MODE=url playwright test"
}
```

Remove `dev:next`, `build:next`, `start:next`, and `preview`. Remove `vite` from `devDependencies`; keep `@vitejs/plugin-react`, which Vitest still needs.

In `.gitignore`, remove `dist`. In `tsconfig.json` `include`, remove `"vite.config.ts"`.

`visual:reference` keeps `VIEWER_MODE=click` and is now effectively frozen: it described how to reach each screen in the application that no longer exists. Leave it in place as the record of how the references were produced. `visual:verify` is the script used from here on.

- [ ] **Step 4: Write the failing tests for the anchor-based components**

In `tests/shared-components.test.tsx`, replace the `HomeScreen` describe block with:

```tsx
describe('HomeScreen', () => {
  it('renders one link per subject pointing at its route', () => {
    render(<HomeScreen subjects={demoBrand.subjects} subjectHref={(id) => `/demo/${id}`} />)

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(demoBrand.subjects.length)
    expect(links[0]).toHaveAttribute('href', `/demo/${demoBrand.subjects[0]!.id}`)
    expect(links[0]).toHaveTextContent(demoBrand.subjects[0]!.label)
  })

  it('applies each subject card colour', () => {
    render(<HomeScreen subjects={demoBrand.subjects} subjectHref={(id) => `/demo/${id}`} />)

    const first = screen.getAllByRole('link')[0]!
    expect(first.getAttribute('style')).toContain(demoBrand.subjects[0]!.cardColor)
  })
})
```

In the `BrandShell` describe block, change every query that finds the back, home, or tool control from `role: 'button'` to `role: 'link'`, and change the props passed from `onBack`, `onHome`, and `onTool` to `backHref` and `homeHref`. Keep `onShare` a callback: opening the share sheet is not navigation. Assert that the back link's `href` equals the `backHref` passed in, and that each tool link points at `/{brandId}/tools/{toolId}`.

- [ ] **Step 5: Run to verify failure**

Run: `pnpm exec vitest run tests/shared-components.test.tsx`
Expected: FAIL, `getAllByRole('link')` finds nothing because the components still render buttons.

- [ ] **Step 6: Convert HomeScreen to anchors**

Replace `src/components/HomeScreen.tsx`:

```tsx
import Link from 'next/link'
import type { CSSProperties } from 'react'
import type { BrandSubject } from '../core/brand-types'

type HomeScreenProps = {
  subjects: BrandSubject[]
  subjectHref: (subjectId: string) => string
}

type SubjectCardStyle = CSSProperties & { '--card-color': string }

export function HomeScreen({ subjects, subjectHref }: HomeScreenProps) {
  return (
    <div className="home-screen">
      <div className="subject-grid">
        {subjects.map((subject) => (
          <Link
            className="subject-card"
            href={subjectHref(subject.id)}
            key={subject.id}
            style={{ '--card-color': subject.cardColor } as SubjectCardStyle}
          >
            <span className="subject-card__label">{subject.label}</span>
            <img className="subject-card__icon" src={subject.icon} alt="" />
          </Link>
        ))}
      </div>
    </div>
  )
}
```

An anchor does not inherit the button resets the layout relied on, so add to the `.subject-card` rule in `src/styles.css`:

```css
  text-decoration: none;
  color: inherit;
```

- [ ] **Step 7: Convert BrandShell's controls to anchors**

In `src/components/BrandShell.tsx`, add `'use client'` as the first line, add `import Link from 'next/link'` and `import { toolHref } from '../core/hrefs'`, and change the props type to:

```tsx
type BrandShellProps = {
  brand: BrandManifest
  screen: Screen
  children: ReactNode
  modal?: ReactNode
  backHref: string
  homeHref: string
  onShare: () => void
}
```

Replace the back button:

```tsx
<Link className="icon-button back-button" href={backHref} aria-label={brand.labels.back}>
  <svg aria-hidden="true" viewBox="0 0 11 18"><path d="m1.5 1.5 7.5 7.5-7.5 7.5" /></svg>
</Link>
```

Replace the home navigation button:

```tsx
<Link className="bottom-nav__action" href={homeHref} aria-current={isHome ? 'page' : undefined}>
  {homeIcon}
  <span>{brand.labels.home}</span>
</Link>
```

Replace the tool buttons:

```tsx
{brand.tools.map((tool) => (
  <Link
    className="bottom-nav__action"
    href={toolHref(brand.id, tool.id)}
    key={tool.id}
    aria-current={screen.kind === 'tool' && screen.toolId === tool.id ? 'page' : undefined}
  >
    <img src={tool.icon} alt="" />
    <span>{tool.label}</span>
  </Link>
))}
```

Drop `document.title` from the effect, leaving only `lang` and `dir`. The title now comes from `generateMetadata`, so it is in the served HTML rather than applied after hydration:

```tsx
useEffect(() => {
  const root = document.documentElement
  const previousLang = root.getAttribute('lang')
  const previousDirection = root.getAttribute('dir')

  root.lang = brand.locale
  root.dir = brand.direction

  return () => {
    if (previousLang === null) root.removeAttribute('lang')
    else root.lang = previousLang

    if (previousDirection === null) root.removeAttribute('dir')
    else root.dir = previousDirection
  }
}, [brand.direction, brand.locale])
```

Add to the `.icon-button` and `.bottom-nav__action` rules in `src/styles.css`:

```css
  text-decoration: none;
  color: inherit;
```

Leave the `modal` slot and its `inert` and `aria-hidden` handling on `.brand-shell__base` exactly as they are. The share sheet must keep rendering as a sibling of the base, not inside the content, or the background stops being inert.

- [ ] **Step 8: Run the component tests**

Run: `pnpm exec vitest run tests/shared-components.test.tsx`
Expected: PASS.

- [ ] **Step 9: Write the brand layout**

Create `app/[brandId]/layout.tsx`:

```tsx
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { BrandNotFound } from '../../src/components/BrandNotFound'
import { brandManifestEntries, getBrand } from '../../src/core/brand-registry'
import { BrandShellClient } from './brand-shell-client'

type BrandParams = { params: Promise<{ brandId: string }> }

export function generateStaticParams() {
  return brandManifestEntries.map(([brandId]) => ({ brandId }))
}

export async function generateMetadata({ params }: BrandParams): Promise<Metadata> {
  const { brandId } = await params
  const brand = getBrand(brandId)
  return brand ? { title: brand.title } : { title: 'Brand not found' }
}

export async function generateViewport({ params }: BrandParams): Promise<Viewport> {
  const { brandId } = await params
  const brand = getBrand(brandId)
  return {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    themeColor: brand?.theme.background ?? '#e9e9ee',
  }
}

export default async function BrandLayout({ children, params }: BrandParams & { children: ReactNode }) {
  const { brandId } = await params
  const brand = getBrand(brandId)

  // Rendered here rather than in app/not-found.tsx because naming the brand that
  // was requested needs the param, and a global not-found receives none.
  if (!brand) return <BrandNotFound brandId={brandId} />

  return <BrandShellClient brand={brand}>{children}</BrandShellClient>
}
```

- [ ] **Step 10: Write the shell client wrapper**

The share control lives in the shell header, but only a route knows what is on screen. Rather than move the control, a route registers a factory that builds the page context on demand. The shell calls it inside the click handler, so `window.location.href` is never read during render, and the sheet still renders in the shell's `modal` slot, which is what keeps the background inert.

Create `app/[brandId]/brand-shell-client.tsx`:

```tsx
'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { BrandShell } from '../../src/components/BrandShell'
import { ShareSheet } from '../../src/components/ShareSheet'
import type { BrandManifest } from '../../src/core/brand-types'
import type { PageActionContext } from '../../src/core/page-actions'
import { brandHref } from '../../src/core/hrefs'
import { createInitialScreen, parentHref, resolveScreen } from '../../src/core/navigation'

type ShareTarget = {
  /** A route registers a factory. Passing null clears it on unmount. */
  register: (build: (() => PageActionContext) | null) => void
}

const ShareTargetContext = createContext<ShareTarget | null>(null)

export function useShareTarget(): ShareTarget {
  const value = useContext(ShareTargetContext)
  if (!value) throw new Error('useShareTarget must be used inside BrandShellClient')
  return value
}

export function BrandShellClient({ brand, children }: { brand: BrandManifest; children: ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [build, setBuild] = useState<(() => PageActionContext) | null>(null)
  const [shareContext, setShareContext] = useState<PageActionContext | null>(null)

  // A bare setState would call the factory rather than store it, so it is wrapped.
  const register = useCallback((next: (() => PageActionContext) | null) => {
    setBuild(() => next)
  }, [])

  const shareTarget = useMemo<ShareTarget>(() => ({ register }), [register])

  // The layout cannot read a child segment's params, so the screen comes from the
  // URL through the same pure resolver the route components use.
  const segments = pathname.split('/').filter(Boolean).slice(1)
  const screen = resolveScreen(brand, segments, searchParams.get('page')) ?? createInitialScreen()

  return (
    <ShareTargetContext.Provider value={shareTarget}>
      <BrandShell
        brand={brand}
        screen={screen}
        backHref={parentHref(brand, screen)}
        homeHref={brandHref(brand.id)}
        onShare={() => setShareContext(build ? build() : null)}
        modal={shareContext ? (
          <ShareSheet
            context={shareContext}
            labels={brand.labels}
            onClose={() => setShareContext(null)}
          />
        ) : undefined}
      >
        {children}
      </BrandShell>
    </ShareTargetContext.Provider>
  )
}
```

- [ ] **Step 11: Write the home route**

Create `app/[brandId]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { HomeScreen } from '../../src/components/HomeScreen'
import { getBrand } from '../../src/core/brand-registry'
import { subjectHref } from '../../src/core/hrefs'

export default async function BrandHomePage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params
  const brand = getBrand(brandId)
  if (!brand) notFound()

  return <HomeScreen subjects={brand.subjects} subjectHref={(id) => subjectHref(brand.id, id)} />
}
```

- [ ] **Step 12: Verify**

Run: `pnpm exec tsc --noEmit && pnpm test:run && pnpm build`
Expected: no type errors, the suite green at roughly 116 tests, and the build reporting `/[brandId]` as a prerendered route.

- [ ] **Step 13: Compare against the reference**

```bash
pnpm build && pnpm start --port 4173 &
VIEWER_MODE=url pnpm exec playwright test --grep "^home$"
```

Expected: the `home` snapshot matches at all five widths.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat: serve the brand home screen from Next and retire the Vite build"
```

---

### Task 6: Subject route

**Files:**
- Create: `app/[brandId]/[subjectId]/page.tsx`
- Modify: `src/components/SubjectMenu.tsx`, `src/styles.css`
- Test: `tests/SubjectMenu.test.tsx`

**Interfaces:**
- Consumes: `resolveScreen`, `groupHref`, `subjectHref`
- Produces: `SubjectMenu` props become `{ subject, groupHref: (groupId: string) => string }`

- [ ] **Step 1: Write the failing test**

Replace `tests/SubjectMenu.test.tsx` assertions that query buttons:

```tsx
it('renders one link per group pointing at its route', () => {
  const subject = demoBrand.subjects.find((candidate) => candidate.id === 'multiple')!

  render(<SubjectMenu subject={subject} groupHref={(id) => `/demo/multiple/${id}`} />)

  const links = screen.getAllByRole('link')
  expect(links).toHaveLength(subject.groups.length)
  expect(links[0]).toHaveAttribute('href', `/demo/multiple/${subject.groups[0]!.id}`)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/SubjectMenu.test.tsx`
Expected: FAIL, no links found.

- [ ] **Step 3: Convert SubjectMenu to anchors**

In `src/components/SubjectMenu.tsx`, change the props to `{ subject, groupHref }`, import `Link` from `next/link`, and replace the `button.group-card` with:

```tsx
<Link className="group-card" href={groupHref(group.id)} key={group.id}>
  <span className="group-card__icon-wrap" aria-hidden="true">
    <img className="group-card__icon" src={group.icon ?? subject.icon} alt="" />
  </span>
  <span className="group-card__label">{group.label}</span>
  <span className="group-card__arrow" aria-hidden="true">
    <svg viewBox="0 0 12 20">
      <path d="m2.5 2 7 8-7 8" />
    </svg>
  </span>
</Link>
```

Add to the `.group-card` rule in `src/styles.css`:

```css
  text-decoration: none;
  color: inherit;
```

- [ ] **Step 4: Write the subject route with the single-group redirect**

Create `app/[brandId]/[subjectId]/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation'
import { SubjectMenu } from '../../../src/components/SubjectMenu'
import { brandManifestEntries, getBrand } from '../../../src/core/brand-registry'
import { groupHref } from '../../../src/core/hrefs'
import { resolveScreen } from '../../../src/core/navigation'

type SubjectParams = { params: Promise<{ brandId: string; subjectId: string }> }

export function generateStaticParams() {
  return brandManifestEntries.flatMap(([brandId, brand]) =>
    brand.subjects.map((subject) => ({ brandId, subjectId: subject.id })))
}

export default async function SubjectPage({ params }: SubjectParams) {
  const { brandId, subjectId } = await params
  const brand = getBrand(brandId)
  if (!brand) notFound()

  const screen = resolveScreen(brand, [subjectId], null)
  if (!screen || screen.kind !== 'menu') notFound()

  const subject = brand.subjects.find((candidate) => candidate.id === screen.subjectId)
  if (!subject) notFound()

  // A subject with exactly one group never showed a chooser in the single-page
  // application. The equivalent under routing is a redirect to that group.
  const onlyGroup = subject.groups.length === 1 ? subject.groups[0] : undefined
  if (onlyGroup) redirect(groupHref(brand.id, subject.id, onlyGroup.id))

  return (
    <SubjectMenu
      subject={subject}
      groupHref={(groupId) => groupHref(brand.id, subject.id, groupId)}
    />
  )
}
```

- [ ] **Step 5: Verify**

Run: `pnpm exec tsc --noEmit && pnpm test:run && pnpm build`
Expected: no type errors, all tests pass, and the build reports `/[brandId]/[subjectId]` as prerendered.

- [ ] **Step 6: Verify the redirect by hand**

```bash
pnpm build && pnpm start --port 4173 &
curl -sI http://127.0.0.1:4173/minene/tasks | head -5
```

Expected: a 307 or 308 with `location: /minene/tasks/daily-tasks`.

- [ ] **Step 7: Compare against the reference**

```bash
VIEWER_MODE=url pnpm exec playwright test --grep "subject chooser"
```

Expected: the `subject-menu` snapshot matches at all five widths.

- [ ] **Step 8: Commit**

```bash
git add app src/components/SubjectMenu.tsx src/styles.css tests/SubjectMenu.test.tsx
git commit -m "feat: serve the subject chooser from a Next route"
```

---

### Task 7: Viewer route, progress restore, and sharing

The largest remaining task. It owns the three genuinely stateful behaviours: paging through the URL, restoring remembered progress, and handing the shell a real share context.

**Files:**
- Create: `app/[brandId]/[subjectId]/[groupId]/page.tsx`
- Create: `app/[brandId]/[subjectId]/[groupId]/viewer-client.tsx`
- Create: `src/hooks/use-progress.ts`
- Create: `tests/use-progress.test.ts`

**Interfaces:**
- Consumes: `readProgress`, `writeProgress`, `progressEntryKey` from `src/core/progress.ts`; `groupHref`; `resolveScreen`; `useShareTarget` from Task 5
- Produces: `useProgress(brandId: string): { read: () => ProgressMap; remember: (subjectId: string, groupId: string, pageIndex: number) => void }`

- [ ] **Step 1: Write the failing test for the progress hook**

Create `tests/use-progress.test.ts`:

```ts
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { progressStorageKey } from '../src/core/progress'
import { useProgress } from '../src/hooks/use-progress'

describe('useProgress', () => {
  it('remembers a page for a brand, subject, and group', () => {
    const { result } = renderHook(() => useProgress('demo'))

    result.current.remember('multiple', 'group-one', 2)

    expect(JSON.parse(window.localStorage.getItem(progressStorageKey('demo'))!))
      .toEqual({ 'multiple/group-one': 2 })
  })

  it('reads back what it remembered', () => {
    const { result } = renderHook(() => useProgress('demo'))
    result.current.remember('multiple', 'group-one', 2)

    expect(result.current.read()).toEqual({ 'multiple/group-one': 2 })
  })

  it('keeps entries for other groups when remembering a new one', () => {
    const { result } = renderHook(() => useProgress('demo'))

    result.current.remember('multiple', 'group-one', 2)
    result.current.remember('multiple', 'group-two', 1)

    expect(result.current.read()).toEqual({ 'multiple/group-one': 2, 'multiple/group-two': 1 })
  })

  it('returns an empty map when nothing has been remembered', () => {
    const { result } = renderHook(() => useProgress('demo'))

    expect(result.current.read()).toEqual({})
  })
})
```

The third test is the one that matters. A naive implementation that writes only the new entry would silently wipe every other remembered page.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/use-progress.test.ts`
Expected: FAIL, cannot resolve `../src/hooks/use-progress`.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/use-progress.ts`:

```ts
'use client'

import { useCallback } from 'react'
import { progressEntryKey, readProgress, writeProgress, type ProgressMap } from '../core/progress'

const unavailableStorage: Storage = {
  get length() { return 0 },
  clear: () => undefined,
  getItem: () => null,
  key: () => null,
  removeItem: () => undefined,
  setItem: () => undefined,
}

/**
 * Storage is touched only inside callbacks, never during render, so this is safe
 * during the server pass of a client component.
 */
function browserStorage(): Storage {
  try {
    return window.localStorage
  } catch {
    return unavailableStorage
  }
}

export function useProgress(brandId: string) {
  const read = useCallback((): ProgressMap => readProgress(browserStorage(), brandId), [brandId])

  const remember = useCallback((subjectId: string, groupId: string, pageIndex: number) => {
    const storage = browserStorage()
    writeProgress(storage, brandId, {
      ...readProgress(storage, brandId),
      [progressEntryKey(subjectId, groupId)]: pageIndex,
    })
  }, [brandId])

  return { read, remember }
}
```

- [ ] **Step 4: Run to verify the hook passes**

Run: `pnpm exec vitest run tests/use-progress.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the viewer client**

The share sheet is not rendered here. It renders in the shell's `modal` slot so the background stays inert; this component only registers the factory that builds its context.

Create `app/[brandId]/[subjectId]/[groupId]/viewer-client.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { useShareTarget } from '../../brand-shell-client'
import { PageViewer } from '../../../../src/components/PageViewer'
import type { BrandManifest, ContentGroup } from '../../../../src/core/brand-types'
import { groupHref } from '../../../../src/core/hrefs'
import { progressEntryKey } from '../../../../src/core/progress'
import { useProgress } from '../../../../src/hooks/use-progress'

type ViewerClientProps = {
  brand: BrandManifest
  subjectId: string
  group: ContentGroup
  pageIndex: number
  hasExplicitPage: boolean
}

export function ViewerClient({ brand, subjectId, group, pageIndex, hasExplicitPage }: ViewerClientProps) {
  const router = useRouter()
  const { read, remember } = useProgress(brand.id)
  const { register } = useShareTarget()
  const hasRestored = useRef(false)

  // An explicit ?page= always wins. Only when it is absent does remembered
  // progress apply, and it replaces rather than pushes so history stays clean.
  // The ref guards against restoring a second time after the replace lands.
  useEffect(() => {
    if (hasExplicitPage || hasRestored.current) return
    hasRestored.current = true

    const remembered = read()[progressEntryKey(subjectId, group.id)]
    if (remembered === undefined) return

    const target = Math.max(0, Math.min(group.pages.length - 1, remembered))
    if (target !== pageIndex) router.replace(groupHref(brand.id, subjectId, group.id, target))
  }, [brand.id, group.id, group.pages.length, hasExplicitPage, pageIndex, read, router, subjectId])

  // The share control lives in the shell header, which has no page context.
  // window.location.href is read inside the factory, so it runs at click time.
  useEffect(() => {
    const page = group.pages[pageIndex]
    if (!page) return

    register(() => ({
      brandId: brand.id,
      brandName: brand.name,
      groupId: group.id,
      groupName: group.label,
      page,
      pageIndex,
      currentUrl: window.location.href,
    }))

    return () => register(null)
  }, [brand.id, brand.name, group, pageIndex, register])

  const changePage = (nextIndex: number) => {
    remember(subjectId, group.id, nextIndex)
    // replace, not push: paging through eight pages must leave one history entry
    // so the back control still means "leave this group".
    router.replace(groupHref(brand.id, subjectId, group.id, nextIndex))
  }

  return (
    <PageViewer
      direction={brand.direction}
      group={group}
      pageIndex={pageIndex}
      onPageChange={changePage}
      onShare={() => undefined}
    />
  )
}
```

`PageViewer` already ignores its `onShare` prop, binding it as `_onShare`. The share control is in the header and always was. The prop is kept so `PageViewer` and its 16 tests are untouched by this conversion.

- [ ] **Step 6: Write the viewer route**

Create `app/[brandId]/[subjectId]/[groupId]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { brandManifestEntries, getBrand } from '../../../../src/core/brand-registry'
import { resolveScreen } from '../../../../src/core/navigation'
import { ViewerClient } from './viewer-client'

type ViewerParams = {
  params: Promise<{ brandId: string; subjectId: string; groupId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export function generateStaticParams() {
  return brandManifestEntries.flatMap(([brandId, brand]) =>
    brand.subjects.flatMap((subject) =>
      subject.groups.map((group) => ({ brandId, subjectId: subject.id, groupId: group.id }))))
}

export default async function ViewerPage({ params, searchParams }: ViewerParams) {
  const { brandId, subjectId, groupId } = await params
  const query = await searchParams
  const brand = getBrand(brandId)
  if (!brand) notFound()

  const rawPage = query.page
  const pageParam = typeof rawPage === 'string' ? rawPage : null

  const screen = resolveScreen(brand, [subjectId, groupId], pageParam)
  if (!screen || screen.kind !== 'viewer') notFound()

  const subject = brand.subjects.find((candidate) => candidate.id === screen.subjectId)
  const group = subject?.groups.find((candidate) => candidate.id === screen.groupId)
  if (!group) notFound()

  return (
    <ViewerClient
      brand={brand}
      subjectId={screen.subjectId}
      group={group}
      pageIndex={screen.pageIndex}
      hasExplicitPage={pageParam !== null}
    />
  )
}
```

- [ ] **Step 7: Verify**

Run: `pnpm exec tsc --noEmit && pnpm test:run && pnpm build`
Expected: no type errors, all tests pass, and the build reports `/[brandId]/[subjectId]/[groupId]` as prerendered with 20 entries.

- [ ] **Step 8: Verify paging, clamping, and restore by hand**

```bash
pnpm build && pnpm start --port 4173 &
```

- `/minene/results/overview?page=99` renders the last page, not a 404.
- `/minene/results/overview?page=abc` renders the first page.
- `/minene/results/nope` returns 404.
- Open `/minene/people/employee-value-package`, page to the fourth page, navigate home, then reopen the group. The URL should settle at `?page=4`. The brief first-page flash before it settles is the accepted regression recorded in the spec.

- [ ] **Step 9: Compare against the reference**

```bash
VIEWER_MODE=url pnpm exec playwright test --grep "page viewer"
```

Expected: the `page-viewer` snapshot matches at all five widths.

- [ ] **Step 10: Commit**

```bash
git add app src/hooks tests/use-progress.test.ts
git commit -m "feat: serve the page viewer from a Next route"
```

---

### Task 8: Tools route

**Files:**
- Create: `app/[brandId]/tools/[toolId]/page.tsx`

**Interfaces:**
- Consumes: `resolveScreen`, `getBrand`, `brandManifestEntries`
- Produces: nothing later tasks depend on

- [ ] **Step 1: Write the route**

Create `app/[brandId]/tools/[toolId]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { ToolScreen } from '../../../../src/components/ToolScreen'
import { brandManifestEntries, getBrand } from '../../../../src/core/brand-registry'
import { resolveScreen } from '../../../../src/core/navigation'
import { TOOLS_SEGMENT } from '../../../../src/core/hrefs'

export function generateStaticParams() {
  return brandManifestEntries.flatMap(([brandId, brand]) =>
    brand.tools.map((tool) => ({ brandId, toolId: tool.id })))
}

export default async function ToolPage({ params }: { params: Promise<{ brandId: string; toolId: string }> }) {
  const { brandId, toolId } = await params
  const brand = getBrand(brandId)
  if (!brand) notFound()

  const screen = resolveScreen(brand, [TOOLS_SEGMENT, toolId], null)
  if (!screen || screen.kind !== 'tool') notFound()

  const tool = brand.tools.find((candidate) => candidate.id === screen.toolId)
  if (!tool) notFound()

  return <ToolScreen tool={tool} />
}
```

- [ ] **Step 2: Verify**

Run: `pnpm exec tsc --noEmit && pnpm test:run && pnpm build`
Expected: no type errors, all tests pass, and the build reports `/[brandId]/tools/[toolId]` as prerendered with three entries.

- [ ] **Step 3: Verify an unknown tool 404s**

```bash
pnpm build && pnpm start --port 4173 &
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4173/minene/tools/nope
```

Expected: `404`.

- [ ] **Step 4: Compare against the reference**

```bash
VIEWER_MODE=url pnpm exec playwright test --grep "tool screen"
```

Expected: the `tool` snapshot matches at all five widths.

- [ ] **Step 5: Commit**

```bash
git add app
git commit -m "feat: serve tool screens from a Next route"
```

---

### Task 9: Remove the navigation reducer and finish the handover

Vite went in Task 5. What remains is dead code from the state-driven era, the documentation, and the final full-suite visual comparison.

**Files:**
- Modify: `src/core/navigation.ts`, `src/core/brand-registry.ts`, `tests/navigation.test.ts`, `README.md`

**Interfaces:**
- Consumes: everything from Tasks 3 through 8
- Produces: a `src/core/navigation.ts` whose entire surface is `Screen`, `createInitialScreen`, `resolveScreen`, `clampPageIndex`, and `parentHref`

- [ ] **Step 1: Remove the reducer**

From `src/core/navigation.ts`, delete `NavigationAction`, `reduceNavigation`, `openGroup`, `openSubject`, `validScreen`, `movePage`, `selectPage`, `groupForViewer`, and `restoredPageIndex`. Keep `Screen`, `createInitialScreen`, `resolveScreen`, `clampPageIndex`, `parentHref`, and the private `findSubject` and `findGroup` helpers that `resolveScreen` and `parentHref` use.

`findSubject` and `findGroup` stay private. The route components in Tasks 6, 7, and 8 do their own inline lookups against the manifest, so nothing outside this module needs them.

The `progress` parameter disappears from this module entirely. Progress is now the concern of `src/hooks/use-progress.ts` and the viewer route, and `src/core/progress.ts` is unchanged and still directly tested.

- [ ] **Step 2: Remove the reducer tests**

From `tests/navigation.test.ts`, delete the 13 reducer tests. Every guarantee they covered has an equivalent in `tests/resolve-screen.test.ts`: unknown-identifier handling, page clamping, and the back-target rule are covered by the `resolveScreen` and `parentHref` blocks. Read the file once and confirm this before deleting.

If the file is empty afterwards, delete it:

```bash
git rm tests/navigation.test.ts
```

- [ ] **Step 3: Remove the pathname-based brand resolver**

From `src/core/brand-registry.ts`, delete `resolveBrandId`. Its only caller was `src/App.tsx`, which no longer exists; the brand now comes from the route param. Keep `DEFAULT_BRAND_ID`, which `app/page.tsx` and `app/not-found.tsx` use.

- [ ] **Step 4: Run the whole gate**

Run: `pnpm check`
Expected: brand validation passes, no type errors, the Next build succeeds, and the suite is green at
107 tests. The arithmetic, so a mismatch is diagnosable rather than mysterious: 103 baseline, plus 2
in Task 2, plus 23 in Task 3, minus 12 when `tests/App.test.tsx` goes in Task 5, plus 4 in Task 7,
minus 13 when the reducer tests go in Step 2.

- [ ] **Step 5: Confirm the prerendered route list**

Run: `pnpm build`
Expected prerendered routes: `/`, `/_not-found`, `/minene`, 8 subject routes, 20 group routes, and 3 tool routes.

- [ ] **Step 6: Run the full visual comparison**

```bash
pnpm build && pnpm start --port 4173 &
pnpm visual:verify
```

Expected: all 20 snapshots match the Task 1 references. This is the acceptance gate for the whole conversion. If any differ, the conversion is not finished, regardless of what the unit tests say.

- [ ] **Step 7: Update the README**

In `README.md`:

- `pnpm dev` now starts Next on port 3000, not Vite on 5173.
- `pnpm preview` no longer exists. The equivalent is `pnpm build && pnpm start`.
- Remove the instruction to set the Vercel output directory to `dist`. Vercel autodetects Next.js, and `vercel.json` is gone.
- Replace the "URL behavior" section. Every screen now has an address, and the four shapes are `/<brand-id>`, `/<brand-id>/<subject-id>`, `/<brand-id>/<subject-id>/<group-id>` with an optional one-based `?page=`, and `/<brand-id>/tools/<tool-id>`.
- State that an unknown subject, group, or tool returns 404, and that an unknown brand renders the brand-not-found screen.
- In `docs/adding-a-brand.md`, add that `tools` is a reserved subject identifier and that brand validation rejects it.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: remove the navigation reducer and document the routes"
```

- [ ] **Step 9: Clear the Vercel output override**

In the Vercel project settings, clear any output directory override left from the Vite build, which would have been set to `dist`. Vercel then autodetects Next.js. This is a manual dashboard step and cannot be done from the repository. Deploy a preview and load `/minene`, a deep group URL, and a tool URL with full page refreshes before promoting.

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: the route map to Tasks 5 through 8; page index as a search parameter to Tasks 3 and 7; reserved identifiers to Task 2; single-group subjects to Task 6; URL resolution and the 404 change to Task 3; server and client boundaries to Tasks 5 through 8; browser globals to Tasks 5 and 7; metadata, theme, and fonts to Tasks 4 and 5; navigation semantics to Tasks 5, 6, and 7; progress restore to Task 7; build and tooling to Tasks 4 and 5; deployment to Tasks 5 and 9; testing to Tasks 1 and 9.

**Corrections made during review, worth knowing before you start:**

1. The original draft kept Vite alive until the final task. That is impossible. `next/link` enters the shared components in Task 5 and cannot render outside Next, so the Vite build dies there. The cutover moved into Task 5 and is now explicit, which makes Task 1 load-bearing rather than merely prudent.
2. The original draft rendered `ShareSheet` inside the viewer component. That would have placed it inside `.brand-shell__base`, breaking the `inert` and `aria-hidden` treatment that makes the background unreachable while the sheet is open. The sheet now renders in the shell's existing `modal` slot, and the viewer registers a factory that builds its context at click time.

**Deferred deliberately.** The pnpm bump from 10.34.5 to 11.0.9 is not scheduled here. Nothing in this conversion needs it; it is required before sub-project 4 and is recorded in the spec. Say so if you would rather do it now.

**Weakest point.** Task 7's progress restore is the only place where correctness depends on effect ordering rather than a pure function, and it is the one behaviour the visual comparison cannot catch, because a snapshot of the settled page looks identical either way. Step 8's manual check is what actually verifies it. Do not skip it.
