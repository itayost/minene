# Multi-Brand Content Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Minene redesign as a production-ready static content viewer whose shared interface can render additional brands from manifests and assets alone.

**Architecture:** A React and TypeScript single-page application owns all navigation, viewing, persistence, sharing, and responsive layout behavior. Brand manifests provide theme tokens, labels, subject/group structure, tool content, and public asset paths; a build-time validator rejects invalid manifests or missing files before Vite emits the static site.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, jsdom, pnpm, Vercel static hosting

**Spec:** `docs/superpowers/specs/2026-08-21-multi-brand-content-viewer-design.md`

## Global Constraints

- Require Node.js 20.19 or newer, matching the current Vite requirement.
- Use pnpm and commit `pnpm-lock.yaml`.
- Keep `minene-app-page-redesign/` unchanged as source reference material.
- Do not add authentication, a database, administration UI, analytics, notifications, or server-side content management.
- Keep shared components free of Minene-specific labels, IDs, colors, and paths.
- Namespace persisted progress by schema version, brand ID, subject ID, and group ID.
- Make `/` default to Minene and `/<brand-id>` resolve registered brands without a public brand picker.
- Treat Hebrew RTL, touch interaction, keyboard operation, safe-area insets, and reduced-motion as first-class behavior.
- Validate every registered manifest and referenced public asset before every production build.

## Planned File Structure

```text
.
├── index.html                         # Vite HTML entry point and viewport metadata
├── package.json                       # Scripts and dependencies
├── pnpm-lock.yaml                     # Reproducible dependency graph
├── tsconfig.json                      # Strict TypeScript settings
├── vite.config.ts                     # React plugin and Vitest/jsdom settings
├── vercel.json                        # SPA rewrite to index.html
├── scripts/
│   └── validate-brands.ts             # Build-time manifest and asset validation
├── public/brands/minene/
│   ├── icons/                         # Logo, subject icons, and tool icons
│   └── pages/                         # Referenced Minene content page PNGs
├── src/
│   ├── main.tsx                       # Browser mount and bundled Heebo font
│   ├── App.tsx                        # Brand resolution and screen composition
│   ├── styles.css                     # Tokens, responsive shell, RTL, and animations
│   ├── core/
│   │   ├── brand-types.ts             # Public brand manifest contract
│   │   ├── brand-registry.ts          # URL-safe registered manifests
│   │   ├── validate-brand.ts          # Pure manifest validation
│   │   ├── navigation.ts              # Pure screen reducer and group resolution
│   │   ├── progress.ts                # Versioned localStorage adapter
│   │   └── page-actions.ts            # Share, copy, WhatsApp, and download utilities
│   ├── brands/
│   │   └── minene.ts                  # Minene manifest only
│   └── components/
│       ├── BrandShell.tsx             # Responsive frame, header, and bottom navigation
│       ├── HomeScreen.tsx             # Subject card grid
│       ├── SubjectMenu.tsx            # Multi-group chooser
│       ├── PageViewer.tsx             # Image viewer, gestures, loading, and indicators
│       ├── ToolScreen.tsx             # Configured text-list tool
│       ├── ShareSheet.tsx             # Current-page action sheet
│       └── BrandNotFound.tsx           # Unknown-brand failure state
└── tests/
    ├── setup.ts                       # jest-dom and browser API cleanup
    ├── fixtures/demo-brand.ts         # Second brand proving the shared contract
    ├── validate-brand.test.ts
    ├── navigation.test.ts
    ├── progress.test.ts
    ├── page-actions.test.ts
    ├── PageViewer.test.tsx
    ├── shared-components.test.tsx
    └── App.test.tsx
```

---

### Task 1: Project Foundation and Brand Contract

**Files:**
- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `index.html`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `src/core/brand-types.ts`
- Create: `src/core/validate-brand.ts`
- Create: `tests/setup.ts`
- Create: `tests/validate-brand.test.ts`

**Interfaces:**
- Consumes: none
- Produces: `BrandManifest`, `BrandTheme`, `BrandSubject`, `ContentGroup`, `PageAsset`, `BrandTool`, `validateBrand(brand: BrandManifest): ValidationIssue[]`

- [ ] **Step 1: Scaffold the package and install the runtime/test dependencies**

Run:

```bash
pnpm init
pnpm add react react-dom @fontsource-variable/heebo
pnpm add -D typescript vite @vitejs/plugin-react vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom @types/react @types/react-dom tsx
```

Set these package scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "validate:brands": "tsx scripts/validate-brands.ts",
    "test": "vitest",
    "test:run": "vitest run",
    "build": "pnpm validate:brands && tsc --noEmit && vite build",
    "preview": "vite preview",
    "check": "pnpm test:run && pnpm build"
  }
}
```

- [ ] **Step 2: Add strict TypeScript, Vite, jsdom, and browser test setup**

Use `vite.config.ts` to configure React, `environment: 'jsdom'`, `setupFiles: './tests/setup.ts'`, and CSS-enabled component tests. Use `tsconfig.json` with `strict`, `noUncheckedIndexedAccess`, `jsx: 'react-jsx'`, `moduleResolution: 'Bundler'`, and `types: ['vitest/globals']`.

Set `tests/setup.ts` to import `@testing-library/jest-dom/vitest`, call `cleanup()` after each test, clear `localStorage`, and restore mocks.

- [ ] **Step 3: Write failing validation tests**

Create a minimal valid manifest fixture and assert both valid and invalid behavior:

```ts
expect(validateBrand(validBrand)).toEqual([])
expect(validateBrand({ ...validBrand, id: 'Not URL Safe' })[0]?.path).toBe('id')
expect(validateBrand({ ...validBrand, subjects: [] })).toContainEqual({
  path: 'subjects',
  message: 'must contain at least one subject',
})
```

Add cases for duplicate subject IDs, duplicate group IDs, zero groups, zero pages, duplicate tool IDs, missing theme tokens, and asset paths that do not begin with `/brands/<brand-id>/`.

- [ ] **Step 4: Run the validation test and confirm the red state**

Run: `pnpm vitest run tests/validate-brand.test.ts`

Expected: FAIL because `BrandManifest` and `validateBrand` do not exist.

- [ ] **Step 5: Define the complete brand contract**

Implement these shapes in `src/core/brand-types.ts`:

```ts
export type Direction = 'ltr' | 'rtl'
export type PageAsset = { src: string; alt: string }
export type ContentGroup = {
  id: string
  label: string
  icon?: string
  pages: PageAsset[]
}
export type BrandSubject = {
  id: string
  label: string
  icon: string
  cardColor: string
  groups: ContentGroup[]
}
export type BrandTool = {
  id: string
  label: string
  icon: string
  note?: string
  items: string[]
}
export type BrandTheme = {
  primary: string
  primaryStrong: string
  text: string
  muted: string
  background: string
  surface: string
  border: string
  fontFamily: string
}
export type BrandManifest = {
  id: string
  name: string
  title: string
  locale: string
  direction: Direction
  logo: PageAsset
  theme: BrandTheme
  labels: { home: string; share: string; save: string; whatsapp: string }
  subjects: BrandSubject[]
  tools: BrandTool[]
}
export type ValidationIssue = { path: string; message: string }
```

- [ ] **Step 6: Implement pure manifest validation**

Implement `validateBrand` with a URL-safe ID expression (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`), required non-empty labels, non-empty subjects/groups/pages, uniqueness checks at each collection boundary, required theme values, and `assertBrandAssetPath(brandId, path)` checking the `/brands/${brandId}/` prefix.

- [ ] **Step 7: Run tests and commit the foundation**

Run: `pnpm vitest run tests/validate-brand.test.ts && pnpm exec tsc --noEmit`

Expected: all validation tests pass and TypeScript emits no errors.

```bash
git add package.json pnpm-lock.yaml index.html tsconfig.json vite.config.ts src/core tests/setup.ts tests/validate-brand.test.ts
git commit -m "chore: scaffold multi-brand viewer"
```

---

### Task 2: Minene Brand Pack and Build-Time Asset Validation

**Files:**
- Create: `src/brands/minene.ts`
- Create: `src/core/brand-registry.ts`
- Create: `scripts/validate-brands.ts`
- Create: `public/brands/minene/icons/*`
- Create: `public/brands/minene/pages/*`
- Modify: `tests/validate-brand.test.ts`

**Interfaces:**
- Consumes: `BrandManifest`, `validateBrand`
- Produces: `mineneBrand: BrandManifest`, `brandRegistry: ReadonlyMap<string, BrandManifest>`, `getBrand(id: string): BrandManifest | undefined`, `resolveBrandId(pathname: string): string`

- [ ] **Step 1: Extend the test with Minene and route-resolution assertions**

```ts
expect(validateBrand(mineneBrand)).toEqual([])
expect(resolveBrandId('/')).toBe('minene')
expect(resolveBrandId('/minene')).toBe('minene')
expect(resolveBrandId('/unknown/')).toBe('unknown')
expect(getBrand('minene')).toBe(mineneBrand)
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `pnpm vitest run tests/validate-brand.test.ts`

Expected: FAIL because the Minene manifest and registry do not exist.

- [ ] **Step 3: Copy only the production assets referenced by the redesign**

Create `public/brands/minene/icons` and `public/brands/minene/pages`. Copy the logo and the 11 configured icons from `minene-app-page-redesign/project/icons/`. Copy these page files from `minene-app-page-redesign/project/pdfimg/`:

```text
p08 p10 p12 p13 p14 p16 p18 p20 p21 p22 p23 p24 p25 p26 p27
p36 p37 p39 p40 p41 p42 p43 p44 p45 p46 p47 p48 p49
p51 p52 p53 p54 p55 p57 p58 p59 p60 p61 p62
p65 p66 p68 p69 p70 p72 p73 p74 p75 p76 p77 p78 p80 p81
p86 p87 p88 p89
```

Preserve the `_0.png` suffix and do not modify the source bundle.

- [ ] **Step 4: Encode the existing redesign content as `mineneBrand`**

Use the section/group/page ordering from `Minene Cockpit App.dc.html` exactly:

```ts
const page = (number: number, alt: string): PageAsset => ({
  src: `/brands/minene/pages/p${String(number).padStart(2, '0')}_0.png`,
  alt,
})
```

Define the eight subjects in this order: tasks, self, energy, top, plan, results, people, training. Preserve the existing single-group and multi-group structure, Hebrew labels, card colors, and ordered page numbers. Define the campaign, persuade, and brain tools with their current text items and icons.

- [ ] **Step 5: Implement the registry without a routing dependency**

```ts
export const brandRegistry = new Map([[mineneBrand.id, mineneBrand]] as const)
export const getBrand = (id: string) => brandRegistry.get(id)
export const resolveBrandId = (pathname: string) => {
  const first = pathname.split('/').filter(Boolean)[0]
  return first || 'minene'
}
```

- [ ] **Step 6: Add filesystem-backed build validation**

In `scripts/validate-brands.ts`, iterate over registered brands, print each pure validation issue, collect all asset paths from the logo, subjects, groups, pages, and tools, and verify each with:

```ts
const publicFile = resolve(process.cwd(), 'public', assetPath.replace(/^\//, ''))
if (!existsSync(publicFile)) failures.push(`${brand.id}: missing asset ${assetPath}`)
```

Exit with status `1` and grouped actionable messages when failures exist; print `Validated 1 brand manifest.` on success.

- [ ] **Step 7: Run validation and commit the Minene pack**

Run: `pnpm validate:brands && pnpm vitest run tests/validate-brand.test.ts`

Expected: validation reports one valid brand and tests pass.

```bash
git add src/brands src/core/brand-registry.ts scripts/validate-brands.ts public/brands/minene tests/validate-brand.test.ts
git commit -m "feat: add Minene brand content pack"
```

---

### Task 3: Navigation State and Brand-Scoped Progress

**Files:**
- Create: `src/core/navigation.ts`
- Create: `src/core/progress.ts`
- Create: `tests/navigation.test.ts`
- Create: `tests/progress.test.ts`

**Interfaces:**
- Consumes: `BrandManifest`, `BrandSubject`, `ContentGroup`
- Produces: `Screen`, `NavigationAction`, `createInitialScreen()`, `reduceNavigation(brand, screen, action, progress)`, `readProgress(storage, brandId)`, `writeProgress(storage, brandId, progress)`

- [ ] **Step 1: Write failing navigation tests**

Cover these exact transitions:

```ts
expect(openSubject(singleGroupBrand, 'single', {})).toMatchObject({ kind: 'viewer' })
expect(openSubject(multiGroupBrand, 'multi', {})).toEqual({ kind: 'menu', subjectId: 'multi' })
expect(reduceNavigation(brand, viewer, { type: 'back' }, {})).toEqual({ kind: 'menu', subjectId: 'multi' })
expect(reduceNavigation(brand, menu, { type: 'home' }, {})).toEqual({ kind: 'home' })
```

Add page-next/page-previous boundary tests, page selection tests, tool opening, and invalid-ID fallback to home.

- [ ] **Step 2: Write failing persistence tests**

Use an in-memory `Storage` stub to verify:

- The key is `content-viewer.progress.v1.<brand-id>`.
- A valid `{ '<subject-id>/<group-id>': 2 }` object round-trips.
- Malformed JSON returns `{}`.
- Negative, non-integer, and non-number values are discarded.
- Minene progress is never returned for a different brand ID.

- [ ] **Step 3: Run both focused suites and confirm the red state**

Run: `pnpm vitest run tests/navigation.test.ts tests/progress.test.ts`

Expected: FAIL because navigation and progress modules do not exist.

- [ ] **Step 4: Implement the pure screen model**

Use this discriminated union:

```ts
export type Screen =
  | { kind: 'home' }
  | { kind: 'menu'; subjectId: string }
  | { kind: 'viewer'; subjectId: string; groupId: string; pageIndex: number }
  | { kind: 'tool'; toolId: string }
```

`openSubject` skips the menu only when the subject has exactly one group. `openGroup` clamps restored progress to `0..pages.length - 1`. `back` from a viewer returns to the menu only when its subject contains multiple groups.

- [ ] **Step 5: Implement defensive progress persistence**

Export `ProgressMap = Record<string, number>`, `progressEntryKey(subjectId, groupId)`, and `progressStorageKey(brandId)`. Parse unknown values defensively, keep only finite non-negative integers, and catch storage security/quota errors on read and write.

- [ ] **Step 6: Run tests and commit navigation behavior**

Run: `pnpm vitest run tests/navigation.test.ts tests/progress.test.ts`

Expected: all navigation and persistence cases pass.

```bash
git add src/core/navigation.ts src/core/progress.ts tests/navigation.test.ts tests/progress.test.ts
git commit -m "feat: add viewer navigation and progress"
```

---

### Task 4: Shared Shell, Home, Chooser, and Tools

**Files:**
- Create: `src/components/BrandShell.tsx`
- Create: `src/components/HomeScreen.tsx`
- Create: `src/components/SubjectMenu.tsx`
- Create: `src/components/ToolScreen.tsx`
- Create: `src/components/BrandNotFound.tsx`
- Create: `src/styles.css`
- Create: `tests/fixtures/demo-brand.ts`
- Create: `tests/shared-components.test.tsx`

**Interfaces:**
- Consumes: `BrandManifest`, `BrandSubject`, `ContentGroup`, `BrandTool`, `Screen`
- Produces: accessible presentational components with `onSubject`, `onGroup`, `onTool`, `onBack`, and `onHome` callbacks

- [ ] **Step 1: Write failing component-flow tests with the demo brand fixture**

Create `tests/fixtures/demo-brand.ts` with a blue theme, one single-group subject, one multi-group subject, and one tool. Render shared components and assert:

```ts
expect(screen.getByRole('button', { name: 'Single subject' })).toBeVisible()
await user.click(screen.getByRole('button', { name: 'Multiple subject' }))
expect(screen.getByRole('heading', { name: 'Multiple subject' })).toBeVisible()
expect(screen.getByRole('button', { name: 'Group two' })).toBeVisible()
```

Also assert document direction/language, bottom-tool labels, back/home controls, and the unknown-brand message.

- [ ] **Step 2: Run the app component tests and confirm the red state**

Run: `pnpm vitest run tests/shared-components.test.tsx`

Expected: FAIL because the shared components are absent.

- [ ] **Step 3: Implement accessible shared components**

`HomeScreen` renders configured subjects as buttons with decorative icons and visible labels. `SubjectMenu` renders a heading and one button per group. `ToolScreen` renders its note and items as semantic text/list content. `BrandNotFound` renders a heading and a link to `/`.

`BrandShell` sets CSS variables from `brand.theme`, sets and restores document language/direction/title, renders a compact brand header on home, renders a back/title/share row on inner screens, and uses `aria-current="page"` on the active bottom action.

- [ ] **Step 4: Recreate the responsive Minene visual system in CSS**

Define named selectors rather than inline styles: `.app-stage`, `.brand-shell`, `.status-bar`, `.app-header`, `.subject-grid`, `.subject-card`, `.subject-menu`, `.group-card`, `.tool-list`, `.bottom-nav`, and `.home-indicator`.

Use these behavior rules:

```css
.app-stage { min-height: 100dvh; display: grid; place-items: center; background: #e9e9ee; }
.brand-shell { width: min(100%, 402px); height: min(100dvh, 846px); background: var(--surface); overflow: hidden; }
@media (min-width: 540px) { .brand-shell { border-radius: 44px; box-shadow: 0 26px 60px rgb(15 18 32 / .34); } }
@media (max-width: 539px) { .brand-shell { width: 100%; height: 100dvh; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
```

Use safe-area padding and logical CSS properties so the shell supports RTL and LTR manifests.

- [ ] **Step 5: Run tests and commit the shared navigation UI**

Run: `pnpm vitest run tests/shared-components.test.tsx`

Expected: shared UI tests pass for the non-Minene demo fixture.

```bash
git add src/components src/styles.css tests/shared-components.test.tsx tests/fixtures/demo-brand.ts
git commit -m "feat: build reusable branded navigation shell"
```

---

### Task 5: Page Viewer, Gestures, and Remembered Position

**Files:**
- Create: `src/components/PageViewer.tsx`
- Create: `tests/PageViewer.test.tsx`
- Modify: `src/styles.css`
- Modify: `tests/shared-components.test.tsx`

**Interfaces:**
- Consumes: `ContentGroup`, `pageIndex`, `onPageChange(index: number)`, `onShare()`
- Produces: swipeable accessible image viewer with page indicators and image loading/error states

- [ ] **Step 1: Write failing PageViewer tests**

Render a three-page group and assert:

- The first image and `1 / 3` are visible.
- Clicking indicator 3 calls `onPageChange(2)`.
- ArrowRight/ArrowLeft follow visual next/previous behavior while respecting direction.
- A horizontal pointer gesture greater than 55px changes one page.
- A mostly vertical gesture does not change pages.
- Page changes never emit an index outside `0..pages.length - 1`.
- Image load hides the progress indicator; image error shows the configured alt text and retry control.

- [ ] **Step 2: Run the focused viewer suite and confirm the red state**

Run: `pnpm vitest run tests/PageViewer.test.tsx`

Expected: FAIL because `PageViewer` does not exist.

- [ ] **Step 3: Implement the viewer state and input behavior**

Use pointer events with a captured `{ x, y }` origin. On pointer up, navigate only when `Math.abs(dx) > 55` and `Math.abs(dx) > Math.abs(dy) * 1.4`. Reset loading and error state whenever the page source changes. Render indicators as labeled buttons such as `Go to page 2 of 3` and expose the current index with `aria-current="page"`.

The page image uses full width, automatic height, `object-fit: contain`, and its manifest alt string. The scroll container allows vertical pan and browser zoom.

- [ ] **Step 4: Verify the controlled viewer contract**

Rerender the viewer with the emitted index and assert that the visible image, counter, loading state, and active indicator update without the component keeping a second page index internally. App composition will connect this callback to navigation and persistence in Task 7.

- [ ] **Step 5: Run viewer and flow tests, then commit**

Run: `pnpm vitest run tests/PageViewer.test.tsx tests/shared-components.test.tsx`

Expected: page interactions and restored position pass.

```bash
git add src/components/PageViewer.tsx src/styles.css tests/PageViewer.test.tsx tests/shared-components.test.tsx
git commit -m "feat: add swipeable page viewer"
```

---

### Task 6: Share, Save, WhatsApp, and Action Sheet

**Files:**
- Create: `src/core/page-actions.ts`
- Create: `src/components/ShareSheet.tsx`
- Create: `tests/page-actions.test.ts`
- Modify: `tests/shared-components.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `PageAsset`, brand/group names, current URL, injected browser APIs
- Produces: `sharePage(context): Promise<'file' | 'url' | 'copied'>`, `downloadPage(context): Promise<void>`, `whatsappUrl(context): string`, `ShareSheet`

- [ ] **Step 1: Write failing browser-action tests**

Mock `fetch`, `navigator.canShare`, `navigator.share`, `navigator.clipboard.writeText`, `URL.createObjectURL`, and anchor `click`. Verify file share preference, URL share fallback, clipboard fallback, readable download filenames, object URL cleanup, and encoded WhatsApp URLs.

- [ ] **Step 2: Run action tests and confirm the red state**

Run: `pnpm vitest run tests/page-actions.test.ts`

Expected: FAIL because the action module is absent.

- [ ] **Step 3: Implement browser actions with explicit fallbacks**

`sharePage` fetches the current image, constructs a `File`, checks `navigator.canShare`, and catches file-fetch/share failures before trying URL share and then clipboard. Only rethrow when every available action fails.

`downloadPage` fetches the image, creates an object URL, clicks a detached anchor with a `minene-<group-id>-page-<n>.png` style filename, and revokes the URL in `finally`.

- [ ] **Step 4: Implement the accessible action sheet**

Render a modal dialog with `aria-modal="true"`, a heading, Share, Save, and WhatsApp buttons, click-outside close, Escape close, initial focus on Share, and focus return to the trigger. Show success or error feedback inside an `aria-live="polite"` region.

- [ ] **Step 5: Run tests and commit page actions**

Run: `pnpm vitest run tests/page-actions.test.ts tests/shared-components.test.tsx`

Expected: browser action fallbacks and modal flow pass.

```bash
git add src/core/page-actions.ts src/components/ShareSheet.tsx src/styles.css tests/page-actions.test.ts tests/shared-components.test.tsx
git commit -m "feat: add page sharing and saving"
```

---

### Task 7: Application Composition, Deep Links, and Vercel Build

**Files:**
- Create: `src/App.tsx`
- Create: `src/main.tsx`
- Create: `vercel.json`
- Modify: `index.html`
- Modify: `tests/App.test.tsx`

**Interfaces:**
- Consumes: brand registry, navigation reducer, persistence adapter, shared screens, page actions
- Produces: `App({ pathname?, registry?, storage? })`, browser entry point, Vercel SPA routing

- [ ] **Step 1: Add failing end-to-end component tests**

Using the demo fixture registry, test root/default resolution, explicit demo resolution, unknown brands, direct opening, chooser opening, back/home behavior, bottom tools, active state, and progress restoration after remount. Confirm that selecting a page updates both reducer state and the `${subjectId}/${groupId}` progress entry.

- [ ] **Step 2: Run App tests and confirm remaining failures**

Run: `pnpm vitest run tests/App.test.tsx`

Expected: integration cases fail until `App` composes the existing units.

- [ ] **Step 3: Implement App composition with dependency injection for tests**

Use defaults from `window.location.pathname`, `brandRegistry`, and `window.localStorage`. Resolve the brand once per pathname, load brand-scoped progress once, keep screen/share-sheet state locally, and render exactly one screen inside `BrandShell`. Unknown brands render `BrandNotFound` outside the branded shell.

Keep URL state at brand level only; subject and page changes remain local state in the first release.

- [ ] **Step 4: Mount the application and add Vercel routing**

`src/main.tsx` imports `@fontsource-variable/heebo`, imports `styles.css`, and mounts `<App />` into `#root`. `index.html` sets UTF-8, a responsive viewport including `viewport-fit=cover`, description metadata, and a neutral initial background.

Create:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

- [ ] **Step 5: Run the full test and production-build gate**

Run: `pnpm check`

Expected: all tests pass, brand validation succeeds, TypeScript is clean, and Vite emits `dist/`.

- [ ] **Step 6: Commit the integrated application**

```bash
git add src/App.tsx src/main.tsx index.html vercel.json tests/App.test.tsx
git commit -m "feat: compose deployable brand viewer"
```

---

### Task 8: Brand Authoring Guide and Visual Verification

**Files:**
- Create: `docs/adding-a-brand.md`
- Create: `README.md`
- Modify: `tests/fixtures/demo-brand.ts`
- Modify: `tests/App.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: complete application and `BrandManifest`
- Produces: documented brand workflow and verified Minene release candidate

- [ ] **Step 1: Prove a second brand requires no component edits**

Keep the demo fixture visually and structurally different from Minene: LTR direction, blue primary color, two subjects, different group counts, and one tool. Render `/demo` through the injected registry and assert demo labels, LTR direction, direct-open behavior, and chooser behavior. Do not import the demo fixture from production code.

- [ ] **Step 2: Write the brand authoring guide**

Document the exact workflow: create `public/brands/<id>/icons` and `pages`, copy `src/brands/minene.ts` to a new manifest, replace stable IDs/labels/theme/assets, register it in `src/core/brand-registry.ts`, run `pnpm validate:brands`, run `pnpm test:run`, and review `/<brand-id>`. Include the manifest field reference, asset-prefix rule, stable-ID warning, single-versus-multiple-group behavior, and a complete small manifest example.

- [ ] **Step 3: Write root setup and Vercel instructions**

`README.md` includes Node 20.19+, `pnpm install`, `pnpm dev`, `pnpm check`, `pnpm build`, the `dist/` output, and Vercel import instructions. Explain that `/` and `/minene` load Minene and additional registered brands use `/<brand-id>`.

- [ ] **Step 4: Run the local production preview and inspect real screens**

Run:

```bash
pnpm check
pnpm preview --host 127.0.0.1
```

Inspect at 390x844 and 1280x900:

- Minene home grid and all eight subject cards.
- A single-group flow such as Daily Tasks.
- A multi-group flow such as Results, People, or Training.
- Swipe, indicators, back, home, and each bottom tool.
- Share-sheet focus, Escape, fallback feedback, and save filename.
- Direct `/minene` load after a full page refresh.
- No horizontal overflow, clipped Hebrew text, missing images, broken safe-area spacing, or desktop frame defects.

Patch CSS or component defects as they are found and rerun affected tests.

- [ ] **Step 5: Verify the final diff and commit documentation/polish**

Run:

```bash
git diff --check
git status --short
pnpm check
```

Expected: no whitespace errors; only intended source, asset, test, and documentation files are present; all checks pass.

```bash
git add README.md docs/adding-a-brand.md src/styles.css tests
git commit -m "docs: explain brand authoring and deployment"
```

- [ ] **Step 6: Record the release handoff**

Report the verified local URLs, production build output, exact test/build commands, commit list, and the remaining external action: importing the repository into Vercel or running an authorized Vercel CLI deployment.
