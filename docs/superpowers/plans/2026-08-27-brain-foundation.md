# מוח ארגוני Redesign — Plan 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the brain's five surfaces on the brand's own palette, give them one card and one real bottom sheet, and add a guard that stops off-brand colour returning.

**Architecture:** Two tokens are added to the brand theme so a brand missing them fails the build rather than falling through to a hardcoded colour. The brain's CSS moves out of the 3172-line shared stylesheet into `src/brain/brain.css`, where a test can police it. A `BottomSheet` primitive supplies the dismissal behaviour the current sheet does not have. No route changes and no data-layer changes — those are Plan 2.

**Tech Stack:** Next 16.3.1 App Router, React 19.2.8, TypeScript (strict, `noUncheckedIndexedAccess`), Vitest + Testing Library + jsdom, plain CSS with per-brand custom properties.

**Spec:** `docs/superpowers/specs/2026-08-27-brain-redesign-design.md`

## Global Constraints

- **RTL and Hebrew.** Every string is Hebrew; every layout uses logical properties (`margin-inline-start`, not `margin-left`).
- **The shell is 402px wide.** That is the design target. Nothing may assume more.
- **Do not touch** the bottom nav, `BrandShell`'s markup, the content viewer, or the manifest label `מוח ארגני` (missing vav, deliberately unfixed).
- **The 15 frozen Playwright references cannot be regenerated.** They cover `subject-menu`, `page-viewer` and `/minene/tools/persuade`. Never run Playwright with `-u`; `playwright.config.ts` throws on it.
- **Approved colours, and nothing else, in `src/brain/brain.css`:** `var(--primary)`, `var(--primary-strong)`, `var(--text)`, `var(--muted)`, `var(--background)`, `var(--surface)`, `var(--surface-sunken)`, `var(--positive)`, `var(--border)`, plus `#fff` and `transparent`.
- **New token values, verbatim:** `--surface-sunken` is `#F7F2EC`. `--positive` is `#0F6F66`.
- **TDD.** No production line without a failing test first, except CSS, which jsdom cannot render — CSS is verified by the palette guard and by the browser pass in Task 8.
- **Commit after every task.** Attribution is disabled in this repo; no `Co-Authored-By` trailer.

---

### Task 1: The two brand tokens

Both are theme tokens rather than stylesheet constants, so `validate-brand.ts` enumerates them and `pnpm build` runs it. A brand missing one fails the build instead of silently rendering a fallback — the exact failure this redesign exists to correct.

**Files:**
- Modify: `src/core/brand-types.ts` — `BrandTheme`
- Modify: `src/core/validate-brand.ts` — `themeTokens`
- Modify: `src/components/BrandShell.tsx` — `ThemeStyle` and `themeStyle`
- Modify: `src/brands/minene.ts` — `theme`
- Modify: `tests/fixtures/demo-brand.ts` — `theme`
- Test: `tests/validate-brand.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BrandTheme.surfaceSunken: string` and `BrandTheme.positive: string`; the CSS custom properties `--surface-sunken` and `--positive` on the `.app-stage` element.

- [ ] **Step 1: Write the failing test**

In `tests/validate-brand.test.ts`, add:

```ts
describe('the semantic surface tokens', () => {
  test('refuses a brand with no sunken surface', () => {
    const brand = {
      ...validBrand,
      theme: { ...validBrand.theme, surfaceSunken: '' },
    } as BrandManifest

    // A missing token used to fall through to whatever hex was written beside
    // the var() call, which is how the brain ended up painted in three
    // palettes. Failing the build is the point of naming them here.
    expect(validateBrand(brand).map((issue) => issue.message).join(' '))
      .toContain('theme.surfaceSunken')
  })

  test('refuses a brand with no positive colour', () => {
    const brand = {
      ...validBrand,
      theme: { ...validBrand.theme, positive: '' },
    } as BrandManifest

    expect(validateBrand(brand).map((issue) => issue.message).join(' '))
      .toContain('theme.positive')
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/validate-brand.test.ts`
Expected: both new tests FAIL. `validateBrand` does not know either token, so it returns no issue mentioning them.

- [ ] **Step 3: Add the tokens**

`src/core/brand-types.ts`, in `BrandTheme`, after `surface`:

```ts
  surface: string
  /** The fill for a row or card that sits on top of `surface`. */
  surfaceSunken: string
  /** עשה, a proven process, a high rating. Never decoration. */
  positive: string
  border: string
```

`src/core/validate-brand.ts`, in `themeTokens`, after `'surface'`:

```ts
  'surface',
  'surfaceSunken',
  'positive',
  'border',
```

`src/components/BrandShell.tsx` — add to the `ThemeStyle` type beside `'--surface'`:

```ts
  '--surface': string
  '--surface-sunken': string
  '--positive': string
```

and to the `themeStyle` object:

```ts
    '--surface': brand.theme.surface,
    '--surface-sunken': brand.theme.surfaceSunken,
    '--positive': brand.theme.positive,
```

`src/brands/minene.ts`, in `theme`:

```ts
    surface: '#FFFCF8',
    surfaceSunken: '#F7F2EC',
    positive: '#0F6F66',
    border: '#DED5CD',
```

`tests/fixtures/demo-brand.ts`, in `theme`:

```ts
    surface: '#FFFFFF',
    surfaceSunken: '#F1F5FA',
    positive: '#0F6F66',
    border: '#D5E2F3',
```

`tests/validate-brand.test.ts`, in the `validBrand` literal's `theme`:

```ts
    surface: '#ffffff',
    surfaceSunken: '#f2f6f9',
    positive: '#0f6f66',
    border: '#d4dce3',
```

- [ ] **Step 4: Run the full suite and the build**

Run: `npx vitest run && npx tsc --noEmit && npx next build`
Expected: all tests PASS (378 + 2), no type errors, build succeeds. `pnpm build` runs `validate:brands`, so a missed brand surfaces here.

- [ ] **Step 5: Commit**

```bash
git add src/core/brand-types.ts src/core/validate-brand.ts src/components/BrandShell.tsx src/brands/minene.ts tests/fixtures/demo-brand.ts tests/validate-brand.test.ts
git commit -m "feat: name the two semantic surface tokens the brain needs

Both are theme tokens rather than stylesheet constants, so validate-brand
enumerates them and the build runs it. A brand missing one fails loudly
instead of falling through to whatever hex was written beside the var()
call -- which is how the brain came to be painted in three palettes."
```

---

### Task 2: Extract `src/brain/brain.css`

`src/styles.css` is 3172 lines against the project's own 800-line ceiling, and roughly 600 of those are brain CSS interleaved with cockpit CSS. Moving it out is what lets Task 3 police it.

**The trap:** `.brain-surface` is used by `app/[brandId]/cockpit/video/video-wizard.tsx:188`, so the rule `.brain-screen, .brain-surface { ... }` and its siblings **stay in `styles.css`**. Moving them silently breaks the video wizard's scrolling, which no test covers.

**Files:**
- Create: `src/brain/brain.css`
- Modify: `src/styles.css` — remove the moved rules
- Modify: `app/layout.tsx` — import the new sheet

**Interfaces:**
- Consumes: nothing.
- Produces: `src/brain/brain.css`, imported globally after `styles.css`.

- [ ] **Step 1: Move by allowlist, not by line number**

Move every rule whose selector begins with one of these, and only these:

```
.upload-page   .documents-list   .approval-lobby   .rule-edit-sheet
.admin-        .knowledge-       .rule-vote        .roles-manager
.people-manager .action-sheet    .kpi-cards        .external-hunt
.brain-entries .brain-entry
```

Leave behind: `.brain-screen`, `.brain-surface`, and `.brain-screen .tool-screen`. Every prefix above was checked with `grep -rl` against `src` and `app`; none is referenced by a non-brain component, and `.brain-surface` is the one that is.

Line numbers are useless here because they shift as soon as the first block moves. Work by selector.

- [ ] **Step 2: Import it**

`app/layout.tsx`, after the existing import:

```ts
import '../src/styles.css'
import '../src/brain/brain.css'
```

Order matters: `brain.css` comes second so a brain rule wins a tie against a shared rule of equal specificity, which is what the old single-file order already gave it.

- [ ] **Step 3: Verify nothing was left behind or dragged along**

Run:

```bash
grep -nE "^\.(upload-page|documents-list|approval-lobby|rule-edit-sheet|admin-|knowledge-|rule-vote|roles-manager|people-manager|action-sheet|kpi-cards|external-hunt|brain-entr)" src/styles.css
grep -nE "^\.(brain-screen|brain-surface)" src/brain/brain.css
```

Expected: both print nothing.

- [ ] **Step 4: Verify the app still builds and passes**

Run: `npx vitest run && npx tsc --noEmit && npx next build`
Expected: 380 tests PASS, no type errors, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/brain/brain.css src/styles.css app/layout.tsx
git commit -m "refactor: move the brain's CSS out of the shared stylesheet

styles.css is 3172 lines against this project's own 800-line ceiling, and
roughly 600 are brain CSS interleaved with cockpit CSS. Splitting it by
selector allowlist rather than by line range is what makes the move
verifiable, and it is what lets the next commit police the palette.

.brain-screen and .brain-surface deliberately stay: video-wizard.tsx uses
.brain-surface for its screen role, and moving it would have broken the
wizard's scrolling with no test to notice."
```

---

### Task 3: The palette guard, and the repaint

The guard is written first and fails on eleven real colours. That is the point: it is the test that would have caught this a week ago.

**Files:**
- Create: `tests/brain/palette.test.ts`
- Modify: `src/brain/brain.css`

**Interfaces:**
- Consumes: `--surface-sunken` and `--positive` from Task 1; `src/brain/brain.css` from Task 2.
- Produces: nothing other code imports.

- [ ] **Step 1: Write the failing guard**

Create `tests/brain/palette.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * White and transparent are not brand decisions -- they are the absence of a
 * colour, and both are already used for a raised surface on top of a sunken
 * one. Everything else must come from the brand, through a token.
 */
const ALLOWED = new Set(['#fff', '#ffffff'])

const HEX = /#[0-9a-fA-F]{3,8}\b/g

describe('the brain paints only in brand colours', () => {
  it('uses no hex outside the allowed set', () => {
    const css = readFileSync(new URL('../../src/brain/brain.css', import.meta.url), 'utf8')

    const offenders = [...new Set(css.match(HEX) ?? [])]
      .filter((hex) => !ALLOWED.has(hex.toLowerCase()))

    // Eleven off-brand colours sat here for a week because a var() fallback
    // never fires inside the shell -- the brain rendered cool blue-grey on a
    // warm cream shell and nothing failed. This is the check that notices.
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run it and read the list**

Run: `npx vitest run tests/brain/palette.test.ts`
Expected: FAIL, listing roughly these: `#c51f73`, `#1d2645`, `#fffdfc`, `#e7e3e9`, `#aea9b4`, `#fef2f6`, `#e8368f`, `#8b8592`, `#1f8a5f`, `#f6f7fb`, `#8f4859`, `#716c7b`, `#fff0f7`, `#e4f5ed`, `#fde9f2`, `#a4761f`, `#f4f7fb`, `#f8f6fc`, `#f9f9fc`, `#f3f0fd`.

The list is the work. Do not shorten it by widening `ALLOWED`.

- [ ] **Step 3: Repaint**

Replace every offender by meaning, not by nearest colour:

| was | becomes | because |
|---|---|---|
| `#c51f73`, `#8f4859`, `#e8368f` | `var(--primary-strong)` or `var(--primary)` | the brand's own rose; strong for text, plain for fills |
| `#1d2645`, `#3f3532` | `var(--text)` | |
| `#aea9b4`, `#8b8592`, `#716c7b`, `#887c77` | `var(--muted)` | three greys for one job, two of them cool |
| `#fffdfc` | `var(--surface)` | |
| `#e7e3e9` | `var(--border)` | |
| `#f6f7fb`, `#fef2f6`, `#f4f7fb`, `#f8f6fc`, `#f9f9fc`, `#fff0f7` | `var(--surface-sunken)` | six card fills collapse to one |
| `#1f8a5f`, `#e4f5ed` | `var(--positive)` | |
| `#fde9f2` | `var(--surface-sunken)` with `color: var(--primary-strong)` | a tint carrying meaning becomes a token carrying meaning |
| `#a4761f` | `var(--muted)` | the mid rating band stops being a third colour |

Delete `var(--token, #hex)` fallbacks as you go — inside the shell they never fire, and outside it the page has no brand anyway.

Two rules change shape rather than colour:

- `.admin-like[data-tone='mid']` becomes `var(--muted)`, so the rating scale is positive / neutral / negative rather than four bands.
- `.knowledge-heading[data-polarity='do']` and `.admin-polarity-badge[data-polarity='do']` take `var(--positive)`; their `dont` twins take `var(--primary-strong)`.

- [ ] **Step 4: Run the guard and the suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: `tests/brain/palette.test.ts` PASSES, all others still pass.

- [ ] **Step 5: Commit**

```bash
git add tests/brain/palette.test.ts src/brain/brain.css
git commit -m "fix: paint the brain in the brand's own colours

The live theme is a warm dusty rose. DESIGN.md documents a hot pink and
navy palette the app no longer uses, and the brain added eleven cool-toned
hex values belonging to neither -- so the book's rows rendered blue-grey on
a cream shell while the cockpit two taps away was sand and clay.

None of it failed anything, because a var() fallback never fires inside the
shell. The guard added here is the check that notices: it reads brain.css
and refuses any hex that is not white.

Six card fills collapse to --surface-sunken, three greys to --muted, and
the rating scale loses its fourth band. Colour on these screens now only
appears where it means something."
```

---

### Task 4: The `BottomSheet` primitive

`.action-sheet-layer` is CSS with one consumer, and that consumer has no Escape handler, no focus move on open, and no focus restore on close. Focus is not layout, so jsdom can test all of it.

**Files:**
- Create: `src/brain/BottomSheet.tsx`
- Test: `tests/brain/bottom-sheet.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export function BottomSheet(props: {
    openKey: string | null
    label: string
    onDismiss: () => void
    initialFocusRef?: { current: { focus: () => void } | null }
    children: ReactNode
  }): ReactElement | null
  ```
  `initialFocusRef` is typed structurally rather than as `RefObject<HTMLElement>`
  on purpose: `RefObject<T>` has a mutable `current`, so it is invariant, and a
  `useRef<HTMLTextAreaElement>(null)` from Task 5 would not be assignable. What
  this actually needs is something focusable.
  Renders nothing when `openKey` is null.

- [ ] **Step 1: Write the failing tests**

Create `tests/brain/bottom-sheet.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { BottomSheet } from '../../src/brain/BottomSheet'

function Harness({ onDismiss = vi.fn() }: { onDismiss?: () => void }) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const fieldRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <button onClick={() => setOpenKey('rule-1')} type="button">פתיחה</button>
      <BottomSheet
        initialFocusRef={fieldRef}
        label="עריכת חוק"
        onDismiss={() => { setOpenKey(null); onDismiss() }}
        openKey={openKey}
      >
        <input aria-label="נוסח" ref={fieldRef} type="text" />
        <input aria-label="תגובה" type="text" />
      </BottomSheet>
    </>
  )
}

describe('the bottom sheet', () => {
  it('renders nothing until something opens it', () => {
    render(<Harness />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('moves focus into the sheet when it opens', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'פתיחה' }))

    expect(screen.getByLabelText('נוסח')).toHaveFocus()
  })

  it('closes on Escape', async () => {
    const onDismiss = vi.fn()
    const user = userEvent.setup()
    render(<Harness onDismiss={onDismiss} />)
    await user.click(screen.getByRole('button', { name: 'פתיחה' }))
    await user.keyboard('{Escape}')

    expect(onDismiss).toHaveBeenCalled()
  })

  it('closes when the backdrop is pressed', async () => {
    const onDismiss = vi.fn()
    const user = userEvent.setup()
    render(<Harness onDismiss={onDismiss} />)
    await user.click(screen.getByRole('button', { name: 'פתיחה' }))
    await user.click(screen.getByRole('button', { name: 'סגירה' }))

    expect(onDismiss).toHaveBeenCalled()
  })

  it('returns focus to whatever opened it', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'פתיחה' })
    await user.click(trigger)
    await user.keyboard('{Escape}')

    // Without this a keyboard user is dropped at the top of the document every
    // time a sheet closes, and has to tab back to where they were.
    expect(trigger).toHaveFocus()
  })

  it('does not steal focus back while a second field is being typed in', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'פתיחה' }))
    await user.type(screen.getByLabelText('תגובה'), 'אב')

    // The bug this primitive exists to prevent: onDismiss in the effect's
    // dependency list tears the effect down every render and re-fires the
    // initial focus, so the second character lands in the first field. It is
    // invisible while a sheet has one field. This one has two.
    expect(screen.getByLabelText('תגובה')).toHaveValue('אב')
    expect(screen.getByLabelText('נוסח')).toHaveValue('')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/brain/bottom-sheet.test.tsx`
Expected: FAIL — `Failed to resolve import "../../src/brain/BottomSheet"`.

- [ ] **Step 3: Write the primitive**

Create `src/brain/BottomSheet.tsx`:

```tsx
'use client'

import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'

/** Anything with a focus method. See the note on invariance in the plan. */
type FocusRef = { current: { focus: () => void } | null }

/**
 * The dismissal behaviour every sheet in this app shares: Escape closes it,
 * focus moves into it on open, and focus returns to whatever opened it on
 * close -- without which a keyboard user is dropped at the top of the document
 * every time a sheet closes.
 *
 * `openKey` is the identity of what is open, not a boolean. The effect re-runs
 * when the key changes, so a sheet swapped straight from one subject to another
 * re-focuses for the new one. A boolean would not change across that swap and
 * the effect would not re-run.
 */
export function BottomSheet({ openKey, label, onDismiss, initialFocusRef, children }: {
  openKey: string | null
  label: string
  onDismiss: () => void
  initialFocusRef?: FocusRef
  children: ReactNode
}): ReactElement | null {
  // Held in a ref and deliberately NOT a dependency below. Callers pass inline
  // arrows, so the identity changes every render, and with it in the list the
  // effect tears down and re-runs on every render of the open sheet. That is
  // not merely wasteful: re-running re-fires the initial focus, so focus is
  // yanked back to the first field after every keystroke anywhere else in the
  // sheet. Invisible while a sheet has one field; not invisible now.
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  const focusRef = useRef(initialFocusRef)
  focusRef.current = initialFocusRef

  useEffect(() => {
    if (!openKey) return undefined

    const trigger = document.activeElement as HTMLElement | null
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismissRef.current()
    }

    document.addEventListener('keydown', onKeyDown)
    focusRef.current?.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      trigger?.focus()
    }
    // openKey alone: opening, closing and swapping subject are the only three
    // events that should move focus.
  }, [openKey])

  if (!openKey) return null

  return (
    <div className="action-sheet-layer">
      {/* A button, not a div with onClick: it has to be reachable and pressable
          without a pointer, and it is the only dismissal a screen-reader user
          can find by touch exploration. */}
      <button
        aria-label="סגירה"
        className="action-sheet__backdrop"
        onClick={onDismiss}
        type="button"
      />
      <section aria-label={label} aria-modal="true" className="bottom-sheet" dir="rtl" role="dialog">
        {children}
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/brain/bottom-sheet.test.tsx`
Expected: all six PASS.

- [ ] **Step 5: Style it**

In `src/brain/brain.css`, add `.bottom-sheet` beside the existing `.action-sheet-layer` rules, reusing the shape `.rule-edit-sheet` already has:

```css
.bottom-sheet {
  position: relative;
  width: min(420px, 100%);
  max-height: 85dvh;
  overflow-y: auto;
  display: grid;
  gap: 12px;
  padding: 16px;
  border-radius: 16px 16px 0 0;
  background: var(--surface);
  text-align: right;
}
```

`max-height` with its own scroll is the one addition: `RuleEditSheet` grew a second textarea and a role list, and on a short viewport its actions can now sit below the fold with no way to reach them.

- [ ] **Step 6: Run everything and commit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 386 tests PASS.

```bash
git add src/brain/BottomSheet.tsx tests/brain/bottom-sheet.test.tsx src/brain/brain.css
git commit -m "feat: give the brain a bottom sheet that behaves like one

.action-sheet-layer was CSS with a single consumer that had no Escape
handler, no focus move on open and no focus restore on close. It looked
like a sheet and behaved like a div: a keyboard user who closed it was
dropped at the top of the document.

onDismiss is held in a ref rather than listed as an effect dependency, and
the test for that is not theoretical -- callers pass inline arrows, the
effect would tear down every render, and re-running it re-fires the initial
focus so a character typed into a second field lands in the first. The edit
sheet grew its second field last week.

max-height with its own scroll, because that same sheet grew a role list
and its actions can now fall below a short viewport."
```

---

### Task 5: Move `RuleEditSheet` onto the primitive

The first consumer, which proves the primitive and fixes the sheet that most needs it.

**Files:**
- Modify: `src/brain/RuleEditSheet.tsx`
- Modify: `app/[brandId]/tools/brain/lobby/lobby-client.tsx` — pass `openKey`
- Test: `tests/brain/rule-edit.test.tsx`

**Interfaces:**
- Consumes: `BottomSheet` from Task 4.
- Produces: `RuleEditSheet` keeps its existing props and gains no new ones; `draft.ruleId` becomes the sheet's `openKey`.

- [ ] **Step 1: Write the failing test**

Append to `tests/brain/rule-edit.test.tsx`, inside the component `describe`:

```tsx
it('closes on Escape, like every other sheet', async () => {
  const onCancel = vi.fn()
  render(
    <RuleEditSheet
      draft={DRAFT}
      error=""
      isSaving={false}
      onCancel={onCancel}
      onChange={vi.fn()}
      onSave={vi.fn()}
      roles={ROLES}
    />,
  )
  await userEvent.setup().keyboard('{Escape}')

  expect(onCancel).toHaveBeenCalled()
})

it('puts focus on the rule text when it opens', () => {
  render(
    <RuleEditSheet
      draft={DRAFT}
      error=""
      isSaving={false}
      onCancel={vi.fn()}
      onChange={vi.fn()}
      onSave={vi.fn()}
      roles={ROLES}
    />,
  )

  // The field a reviewer came to correct, not the topic select above it.
  expect(screen.getByLabelText('נוסח החוק')).toHaveFocus()
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/brain/rule-edit.test.tsx`
Expected: both new tests FAIL — nothing listens for Escape, nothing focuses.

- [ ] **Step 3: Rebuild the sheet on the primitive**

In `src/brain/RuleEditSheet.tsx`, replace the hand-rolled `<div className="action-sheet-layer">` and its backdrop button with `BottomSheet`, and add the focus ref:

```tsx
import { useRef } from 'react'
import { BottomSheet } from './BottomSheet'
```

```tsx
  const textRef = useRef<HTMLTextAreaElement>(null)

  return (
    <BottomSheet
      initialFocusRef={textRef}
      label="עריכת חוק"
      onDismiss={onCancel}
      openKey={draft.ruleId}
    >
      <h2 className="rule-edit-sheet__title">עריכת חוק</h2>
      {/* ...every existing field, unchanged, with ref={textRef} on the
          נוסח החוק textarea... */}
    </BottomSheet>
  )
```

Delete `.rule-edit-sheet`'s own positioning rules from `src/brain/brain.css`; `.bottom-sheet` supplies them now. Keep `.rule-edit-sheet__title`, `__field`, `__row`, `__roles`, `__hint`, `__error` and `__actions`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/brain/rule-edit.test.tsx tests/brain/lobby.test.ts`
Expected: PASS, including the eleven that already existed.

- [ ] **Step 5: Commit**

```bash
git add src/brain/RuleEditSheet.tsx src/brain/brain.css tests/brain/rule-edit.test.tsx
git commit -m "refactor: put the edit sheet on the real sheet primitive

Its first consumer, and the one that most needed it: a reviewer correcting
a rule now gets focus on the text they came to fix, Escape to abandon it,
and their place back in the queue when the sheet closes."
```

---

### Task 6: One card

Four card treatments become one component with head, body and meta slots.

**Files:**
- Create: `src/brain/BrainCard.tsx`
- Modify: `src/brain/KnowledgeRow.tsx`
- Modify: `src/brain/brain.css`
- Test: `tests/brain/brain-card.test.tsx`

**Interfaces:**
- Consumes: `--surface-sunken` from Task 1.
- Produces:
  ```ts
  export function BrainCard(props: {
    head?: ReactNode
    children: ReactNode
    meta?: ReactNode
    actions?: ReactNode
    as?: 'li' | 'div'
  }): ReactElement
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/brain/brain-card.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrainCard } from '../../src/brain/BrainCard'

describe('the one card', () => {
  it('renders as a list item when it is one of many', () => {
    render(<ul><BrainCard as="li">לחייך</BrainCard></ul>)

    expect(screen.getByRole('listitem')).toHaveTextContent('לחייך')
  })

  it('renders as a plain box when it stands alone', () => {
    render(<BrainCard>לחייך</BrainCard>)

    expect(screen.queryByRole('listitem')).toBeNull()
    expect(screen.getByText('לחייך')).toBeVisible()
  })

  it('omits the head and meta rows entirely when it has none', () => {
    const { container } = render(<BrainCard>לחייך</BrainCard>)

    // An empty head still occupies its gap in the grid, which reads as a card
    // that failed to load its own metadata.
    expect(container.querySelector('.brain-card__head')).toBeNull()
    expect(container.querySelector('.brain-card__meta')).toBeNull()
  })

  it('keeps the head, the body, the meta and the actions in reading order', () => {
    const { container } = render(
      <BrainCard actions={<button type="button">אישור</button>} head={<span>#12</span>} meta={<span>טיפ</span>}>
        לחייך
      </BrainCard>,
    )

    const classes = [...(container.firstElementChild?.children ?? [])].map((child) => child.className)
    expect(classes).toEqual([
      'brain-card__head', 'brain-card__body', 'brain-card__meta', 'brain-card__actions',
    ])
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/brain/brain-card.test.tsx`
Expected: FAIL — `Failed to resolve import "../../src/brain/BrainCard"`.

- [ ] **Step 3: Write the component**

Create `src/brain/BrainCard.tsx`:

```tsx
import type { ReactElement, ReactNode } from 'react'

/**
 * Every row on every brain surface. A rule in the book, a rule in the queue, a
 * rule in the history and a document in the list are the same object with
 * different content, and before this they were four card treatments introduced
 * in one week.
 *
 * Each slot is omitted rather than rendered empty: an empty head still occupies
 * its gap in the grid, which reads as a card that failed to load.
 */
export function BrainCard({ head, children, meta, actions, as = 'div' }: {
  head?: ReactNode
  children: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  as?: 'li' | 'div'
}): ReactElement {
  const Tag = as
  return (
    <Tag className="brain-card">
      {head ? <p className="brain-card__head">{head}</p> : null}
      <div className="brain-card__body">{children}</div>
      {meta ? <p className="brain-card__meta">{meta}</p> : null}
      {actions ? <div className="brain-card__actions">{actions}</div> : null}
    </Tag>
  )
}
```

- [ ] **Step 4: Style it**

In `src/brain/brain.css`:

```css
.brain-card {
  display: grid;
  gap: 6px;
  padding: 12px;
  border-radius: 14px;
  background: var(--surface-sunken);
}

.brain-card__head,
.brain-card__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 0.75rem;
  color: var(--muted);
  /* Every number that appears on a card appears here: the rule number, the
     score, the vote count. Tabular so a column of them scans instead of
     jittering by glyph width. */
  font-variant-numeric: tabular-nums;
}

.brain-card__body {
  font-size: 0.9375rem;
  font-weight: 800;
  line-height: 1.2;
  color: var(--text);
}

.brain-card__actions {
  display: flex;
  gap: 8px;
}
```

`0.9375rem` is DESIGN.md's `title` at 15px; the weight and line height are its too.

- [ ] **Step 5: Move `KnowledgeRow` onto it**

Rewrite the return of `src/brain/KnowledgeRow.tsx`, keeping every comment that explains a decision:

```tsx
  return (
    <BrainCard
      actions={<RuleVote isSaving={isSaving} onClear={onClear} onVote={onVote} ruleId={rule.id} vote={vote} />}
      as="li"
      head={(
        <>
          <span>{`#${rule.rule_number}`}</span>
          <span>{getTopic(rule.topic_id)?.title ?? rule.topic_id}</span>
          {rule.sub_topic ? <span className="knowledge-row__sub-topic">{rule.sub_topic}</span> : null}
          {rule.like_pct != null ? (
            <span
              aria-label={`${rule.like_pct} אחוז לייקים מתוך ${rule.vote_count} מצביעים`}
              className="knowledge-row__score"
            >
              <span aria-hidden="true">{rule.like_pct}%</span>
            </span>
          ) : null}
        </>
      )}
    >
      {rule.text}
      {rule.kind === 'case' && rule.response ? (
        <p className="knowledge-row__response">
          <span className="knowledge-row__response-label">תגובה:</span> {rule.response}
        </p>
      ) : null}
      {rule.source_url ? (
        <a className="knowledge-row__source" href={rule.source_url} rel="noopener noreferrer" target="_blank">
          מקור חיצוני
        </a>
      ) : null}
    </BrainCard>
  )
```

The topic badge loses its own class: `.brain-card__head` styles it now. Delete `.knowledge-row`, `.knowledge-row__head`, `.knowledge-row__number`, `.knowledge-row__topic` and `.knowledge-row__text` from `src/brain/brain.css`; keep `__sub-topic`, `__score`, `__response`, `__response-label` and `__source`.

- [ ] **Step 6: Run everything and commit**

Run: `npx vitest run && npx tsc --noEmit && npx next build`
Expected: all PASS. `tests/brain/knowledge-book.test.tsx` must pass untouched — it queries by role and text, not by class, which is what makes this refactor safe.

```bash
git add src/brain/BrainCard.tsx src/brain/KnowledgeRow.tsx src/brain/brain.css tests/brain/brain-card.test.tsx
git commit -m "feat: one card for every brain row

Four card treatments, three of them introduced in the same week, become one
component with head, body, meta and action slots. Each slot is omitted
rather than rendered empty, because an empty head still occupies its gap and
reads as a card that failed to load.

The knowledge book is the first surface moved onto it. Its sixteen tests
pass untouched, which is the point: they query by role and text."
```

---

### Task 7: Correct `DESIGN.md` and the stale fallbacks

`DESIGN.md` documents a palette the app stopped using. Every `var(--x, #hex)` fallback in `src/styles.css` comes from it. Leaving both is how the next person repeats this.

**Files:**
- Modify: `DESIGN.md`
- Modify: `src/styles.css`

- [ ] **Step 1: Correct the palette block**

In `DESIGN.md`, replace the `colors:` block with the live theme, keeping the key names that the component specs below reference:

```yaml
colors:
  minene-rose: "#B76578"
  minene-rose-strong: "#8F4859"
  warm-text: "#3F3532"
  muted-copy: "#887C77"
  warm-surface: "#FFFCF8"
  surface-sunken: "#F7F2EC"
  positive: "#0F6F66"
  shell-ground: "#EEEAE7"
  mist-border: "#DED5CD"
  white: "#FFFFFF"
```

Add a line above it recording why:

```markdown
> The source of truth for these values is `src/brands/minene.ts`, which is what
> `BrandShell` actually emits. This file drifted from it once already: it
> documented a hot pink and navy palette for weeks after the app moved to warm
> rose, and the brain was built against the stale version.
```

- [ ] **Step 2: Correct the fallbacks**

In `src/styles.css`, replace every `var(--token, #hex)` with a bare `var(--token)`. The fallbacks never fire inside the shell, and outside it the page has no brand to fall back to — they are decoration that misled a reader for a week.

Run this to find them: `grep -c "var(--[a-z-]*, #" src/styles.css`

- [ ] **Step 3: Verify**

Run: `npx vitest run && npx next build`
Expected: PASS. Then confirm no fallback survives:

```bash
grep -c "var(--[a-z-]*, #" src/styles.css src/brain/brain.css
```
Expected: `0` for both.

- [ ] **Step 4: Commit**

```bash
git add DESIGN.md src/styles.css
git commit -m "docs: correct DESIGN.md to the palette the app actually uses

It documented hot pink and navy long after the brand moved to warm rose,
and the brain was built against the stale version -- which is most of why
it read as a different application.

The var() fallbacks go with it. They never fire inside the shell, so they
were never colour: they were a second, wrong palette sitting in the file
where the next reader would take them for the real one."
```

---

### Task 8: The browser pass

jsdom has no layout. This is the only step that sees any.

**Files:** none. This produces screenshots and, if needed, follow-up commits.

- [ ] **Step 1: Start the dev server bound to the host you will browse**

```bash
npx next dev --port 4300 --hostname 127.0.0.1
```

Bind it explicitly. Started on the default host and browsed via `127.0.0.1`, Next 16 treats the dev bundle as cross-origin and blocks it; the page never hydrates, and every form falls back to a native submit. It looks exactly like a broken login.

- [ ] **Step 2: Walk all five surfaces at three widths**

`/minene/tools/brain`, `/lobby`, `/extract`, `/admin`, `/book`, at 320, 402 and 768.

- [ ] **Step 3: Check the four things the tests cannot**

- No cool grey or blue remains anywhere in the brain. It should read warm against the cockpit home.
- The edit sheet: open it, type in the response field, confirm the character lands there. Press Escape; confirm focus returns to the עריכה button you came from.
- Every card is the same object at every size.
- Nothing overflows the 402px shell horizontally.

- [ ] **Step 4: Report with screenshots, and fix what you find in its own commit**

Anything found here gets its own commit with the finding in the message, the way `d3db8a6` recorded the fourth-tab overflow.

---

## What this plan does not do

Routing, the hub deletion, the two-screen merge, the submit-as-sheet move, the merged ingest screen, the file input replacement, the queue hierarchy and the star's removal are **Plan 2**, written after this one is executed. Everything here leaves all five surfaces on their current routes, working, and repainted.

The spec was revised on 2026-08-27, after Task 7, from three screens to two: the book and נתוני המוח turned out to be the same query with different chrome, and the star turned out to be unused now that rules carry a real rating. Nothing in Plan 1 depends on that change.
