# מוח ארגוני Redesign — Plan 2: Restructure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the brain's five screens into two — a role-aware book at `/tools/brain` and an ingest screen that carries the approval queue — and give every task a sheet instead of a form wedged into a list.

**Architecture:** No new data. Every capability already exists in `rules-api`, `roles-api` and `documents-api`; this moves it. The hub is deleted so the bottom nav lands on real content, the admin list merges into the book because it was the same query with different chrome, and the lobby moves under the ingest form because uploading and approving are one act.

**Tech Stack:** Next 16.3.1 App Router, React 19.2.8, TypeScript (strict, `noUncheckedIndexedAccess`), Vitest + Testing Library + jsdom, plain CSS with per-brand custom properties.

**Spec:** `docs/superpowers/specs/2026-08-27-brain-redesign-design.md`
**Visual reference:** the published restructure artifact — two device drawings, ten numbered callouts, and a table of where each old screen's contents go.

## A deviation from the usual plan format, stated rather than hidden

This plan gives full test code and exact verification for every task, and describes implementation rather than reproducing every line of it. That is a deliberate narrowing: Plan 1 was written to be handed to a fresh agent, and this one is being executed inline by the author of the code it changes. The tests are the part that drives the work, so they are complete. If this plan is ever handed to someone without that context, the implementation bodies must be filled in first.

## Global Constraints

- **RTL and Hebrew.** Every string is Hebrew; layout uses logical properties.
- **The shell is 402px.** The 320px case is real and unverifiable in this browser — Chrome will not size a window below ~400. Anything that depends on 320 must be reasoned about, and said to be reasoned about.
- **Do not touch** the bottom nav, `BrandShell`, the content viewer, or the manifest label `מוח ארגני`.
- **The 15 frozen Playwright references cannot be regenerated.** Never run Playwright with `-u`.
- **`src/brain/brain.css` is policed** by `tests/brain/palette.test.ts`: no hex but `#fff`/`#000`, no colour function without a `var(--`, no `var()` fallback.
- **Do not touch the database.** `rules.is_starred` stays; minene simply stops reading it.
- **The tenant holds the author's own test data**, not a client's. Browser verification may write freely; there is nothing to protect but the convenience of having 32 rows in the queue to look at.
- **TDD**, and **commit after every task**. No `Co-Authored-By` trailer.

---

### Task 1: Delete the hub; the book becomes `/tools/brain`

**Files:**
- Move: `app/[brandId]/tools/brain/book/book-client.tsx` → `app/[brandId]/tools/brain/book-client.tsx`
- Rewrite: `app/[brandId]/tools/brain/page.tsx` — was the hub, becomes the book's route
- Delete: `app/[brandId]/tools/brain/book/`
- Test: `tests/brain/brain-screen.test.tsx` (rewritten), `tests/brain/surface-gates.test.tsx`

**Interfaces:**
- Produces: `/tools/brain` renders `BookClient` for any member. No role gate.

- [ ] **Step 1: Rewrite the screen test to describe the new front door**

Replace the body of `tests/brain/brain-screen.test.tsx` with:

```tsx
describe('the מוח ארגוני front door', () => {
  it('is the knowledge book itself, not a menu in front of it', async () => {
    await renderBrain('staff')

    // The bottom nav already reaches this tool. Four cards in front of four
    // screens cost two taps before any task began, and the largest element on
    // that page was a list of marketing copy from the manifest.
    expect(screen.getByRole('tab', { name: 'כל החוקים' })).toBeVisible()
  })

  it('offers a staff member no way into the owner surfaces', async () => {
    await renderBrain('staff')
    expect(screen.queryByRole('link', { name: /הזנה/ })).toBeNull()
  })

  it('gives an owner one link to the ingest screen', async () => {
    await renderBrain('owner')

    expect(screen.getByRole('link', { name: /הזנה/ }))
      .toHaveAttribute('href', `/${mineneBrand.id}/tools/brain/ingest`)
  })
})
```

The mock of `require-brand` stays; `BookClient` must be mocked out the way `surface-gates` mocks its clients, since this test is about the route, not the list.

- [ ] **Step 2: Run and watch it fail.** `npx vitest run tests/brain/brain-screen.test.tsx` — fails on the missing tab and the missing link.

- [ ] **Step 3: Move the client, rewrite the page**

`page.tsx` becomes what `book/page.tsx` was, plus it passes `role` down so the client can decide what an owner additionally sees. Delete the `entries` array, the tool lookup, the `ToolScreen` render and the manifest preview list entirely.

- [ ] **Step 4: Verify.** `npx vitest run && npx tsc --noEmit && npx next build`. The build's route list must show `/[brandId]/tools/brain` and no `/tools/brain/book`.

- [ ] **Step 5: Commit.**

```bash
git commit -m "feat: make the knowledge book the tool's front door

The hub existed only to route to four places, while the bottom nav already
had a מוח ארגני tab -- so every task cost two taps before it began, and the
biggest element on the page was a list of marketing copy from the manifest.

/tools/brain is now the book. An owner gets one link out of it; a staff
member gets none, because there is nowhere they may go."
```

---

### Task 2: Four views in a 2×2 grid

**Files:** `app/[brandId]/tools/brain/book-client.tsx`, `src/brain/brain.css`, `tests/brain/knowledge-book.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('shows all four views at once rather than scrolling one out of reach', () => {
  render(<BookClient role="staff" />)

  const strip = screen.getByRole('tablist', { name: 'תצוגות הידע' })
  // Two rows of two. At 320 the fourth label starts beyond the edge with
  // nothing peeking, and a control with four tabs reads as one with three --
  // which made the whole proven-process ranking unreachable.
  expect(strip).toHaveClass('knowledge-tabs--grid')
  expect(within(strip).getAllByRole('tab')).toHaveLength(4)
})
```

- [ ] **Step 2: Run it and watch it fail** on the missing class.

- [ ] **Step 3: Implement.** Swap `.knowledge-tabs`'s flex-and-scroll for `display: grid; grid-template-columns: 1fr 1fr;`, drop the `mask-image` and the `overflow-x`, and add the `--grid` class. The fade added in `d3db8a6` goes with it: it was a patch over the overflow this removes.

- [ ] **Step 4: Verify** the suite, then the palette guard specifically.

- [ ] **Step 5: Commit.**

---

### Task 3: הוספת ידע becomes a sheet

**Files:** `src/brain/SubmitKnowledge.tsx`, `app/[brandId]/tools/brain/book-client.tsx`, `tests/brain/submit-knowledge.test.tsx`

**Interfaces:** Consumes `BottomSheet` from Plan 1 Task 4.

- [ ] **Step 1: Write the failing tests**

```tsx
it('opens over the list rather than pushing it down', async () => {
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: 'הוספת ידע' }))

  expect(screen.getByRole('dialog', { name: 'הוספת ידע' })).toBeVisible()
})

it('puts focus on the first field a contributor fills', async () => {
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: 'הוספת ידע' }))

  expect(screen.getByLabelText('החוק')).toHaveFocus()
})

it('closes on Escape without losing what was typed', async () => {
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: 'הוספת ידע' }))
  await user.type(screen.getByLabelText('החוק'), 'לחייך')
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'הוספת ידע' }))

  // Escape abandons the sheet, not the draft. A contributor who dismisses it
  // by reflex and loses a paragraph does not type a second one.
  expect(screen.getByLabelText('החוק')).toHaveValue('לחייך')
})
```

- [ ] **Step 2: Run and watch all three fail.**

- [ ] **Step 3: Implement.** The collapsed state stays a button; the open state becomes `BottomSheet` with `openKey="submit"`. Draft state lifts out of the sheet so dismissal does not clear it. Add a `textRef` for the initial focus.

- [ ] **Step 4: Verify.** The seven existing submit tests must still pass — they query by label and role.

- [ ] **Step 5: Commit.**

---

### Task 4: The star leaves

**Files:** `src/brain/types.ts`, `src/brain/rules-api.ts`, `app/[brandId]/tools/brain/admin/admin-client.tsx`, `tests/fixtures/rule.ts`, `tests/brain/rules-api.test.ts`, `tests/brain/admin-row.test.tsx`, `tests/brain/admin-search.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
it('does not select a column nothing renders', async () => {
  const { api, columns } = client()
  await api.listRules({ topicId: null })

  // is_starred is one owner's unexplained flag on a row that now carries a
  // percentage built from real votes. The column stays in the database --
  // dropping it is a migration in another repo, and it holds live data --
  // but nothing here reads it.
  expect(columns[0]?.split(',')).not.toContain('is_starred')
})
```

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Remove it.** `Rule.is_starred`, `RULE_COLUMNS`, `setStar`, `ListRulesOptions.starredOnly`, `p_starred_only`, the fixture field, the star button and the starred-only checkbox.

**Do not lose this coverage:** `setStar` is the call one test uses to prove an RLS-filtered update returning `{ data: null, error: null }` throws rather than handing back a fieldless row. Move that assertion to `updateRule`, which has the same shape.

- [ ] **Step 4: Verify.** `grep -rn "is_starred\|isStarred\|starredOnly\|setStar" src app tests` returns nothing.

- [ ] **Step 5: Commit.**

---

### Task 5: The admin list merges into the book

The heart of this plan. Two screens showing one query become one list with role-aware options.

**Files:**
- Modify: `app/[brandId]/tools/brain/book-client.tsx`
- Delete: `app/[brandId]/tools/brain/admin/`
- Modify: `src/brain/RolesManager.tsx` — becomes a sheet
- Delete: `src/brain/PeopleManager.tsx`, `src/brain/people-api.ts`, `tests/brain/people-api.test.ts`
- Test: `tests/brain/knowledge-book.test.tsx`, `tests/brain/admin-panels.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
describe('what an owner gets on the same list', () => {
  it('offers search, which a staff member never sees', async () => {
    render(<BookClient role="owner" />)
    expect(await screen.findByRole('button', { name: 'חיפוש וסינון' })).toBeVisible()

    cleanup()
    render(<BookClient role="staff" />)
    expect(screen.queryByRole('button', { name: 'חיפוש וסינון' })).toBeNull()
  })

  it('reaches pending and rejected rules, which the book never showed', async () => {
    const user = userEvent.setup()
    render(<BookClient role="owner" />)
    await user.click(await screen.findByRole('button', { name: 'חיפוש וסינון' }))
    await user.selectOptions(screen.getByLabelText('סטטוס'), 'pending')

    await waitFor(() => expect(rulesApi.listRules)
      .toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' })))
  })

  it('opens the role catalogue as a sheet, not as furniture in the list', async () => {
    const user = userEvent.setup()
    render(<BookClient role="owner" />)
    await user.click(await screen.findByRole('button', { name: 'תפקידים' }))

    expect(screen.getByRole('dialog', { name: 'תפקידים' })).toBeVisible()
  })
})
```

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement.** The book gains a `role` prop, an owner-only header row (חיפוש וסינון, תפקידים), a status filter inside the search panel, and the KPI cards move out. `RolesManager` swaps `<details>` for `BottomSheet`. `PeopleManager` and `people-api` are deleted outright — assigning one of a handful of accounts a job title once a year did not earn a panel, and it is what made the screen unrecognisable.

- [ ] **Step 4: Verify.** All 16 knowledge-book tests still pass. `npx next build` shows no `/tools/brain/admin`.

- [ ] **Step 5: Commit.**

---

### Task 6: `/tools/brain/ingest` — the form and the queue on one screen

**Files:**
- Create: `app/[brandId]/tools/brain/ingest/page.tsx`, `ingest-client.tsx`
- Delete: `app/[brandId]/tools/brain/extract/`, `app/[brandId]/tools/brain/lobby/`
- Test: `tests/brain/ingest.test.tsx` (from `extract-modes` + `lobby` + `rule-edit`'s lobby half)

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows what an upload produced without navigating anywhere', async () => {
  documentsApi.extractRules.mockResolvedValue({ rules: [{}, {}] })
  const user = setup()
  await user.upload(screen.getByLabelText('קובץ PDF'), pdf())
  await user.click(screen.getByRole('button', { name: 'העלאה וחילוץ' }))

  // The reason these two screens merged: an owner used to be told "6 חוקים
  // ממתינים בלובי" and then had to go somewhere else to act on them.
  await waitFor(() => expect(rulesApi.listPendingRules).toHaveBeenCalledTimes(2))
})

it('offers all three sources against one topic picker', async () => {
  setup()
  expect(screen.getAllByRole('tab')).toHaveLength(3)
  expect(screen.getAllByLabelText('נושא')).toHaveLength(1)
})

it('gives the queue one filled action and two quiet ones', async () => {
  setup()
  const row = (await screen.findAllByRole('listitem'))[0] as HTMLElement

  // Thirty-two rows of three identical outlined buttons is why draining this
  // queue is tiring, and why the action that discards work looked exactly like
  // the one that keeps it.
  expect(within(row).getByRole('button', { name: /אישור/ })).toHaveAttribute('data-weight', 'primary')
  expect(within(row).getByRole('button', { name: /דחייה/ })).toHaveAttribute('data-weight', 'quiet')
})
```

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement.** `ingest-client` merges `ExtractClient` and `LobbyClient`: three modes over one topic picker, the hunt folded in as the third, the queue beneath, the documents list collapsed at the foot, KPI cards at the top. Reloading the queue after an extraction is what ties the halves together.

- [ ] **Step 4: Verify.** Owner gate on the route, per `surface-gates`.

- [ ] **Step 5: Commit.**

---

### Task 7: A file control in Hebrew

**Files:** `app/[brandId]/tools/brain/ingest/ingest-client.tsx`, `src/brain/brain.css`, `tests/brain/ingest.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('names the chosen file, in Hebrew, instead of leaving it to the browser', async () => {
  const user = setup()
  await user.upload(screen.getByLabelText('קובץ PDF'), pdf('נהלי פתיחה.pdf'))

  // A bare <input type="file"> renders the browser's own control, which is why
  // this screen currently shows "Choose File / No file chosen" in English in
  // the middle of an RTL page.
  expect(screen.getByText(/נהלי פתיחה\.pdf/)).toBeVisible()
})

it('says no file is chosen rather than showing nothing', () => {
  setup()
  expect(screen.getByText('לא נבחר קובץ')).toBeVisible()
})
```

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement.** The input keeps its label association for the accessible name and is visually hidden (clip-path, not `display:none`, which would take it out of the tab order). A styled `<label>` becomes the visible control and shows the filename and size.

- [ ] **Step 4: Verify** in the browser, since this one is entirely about what the browser draws.

- [ ] **Step 5: Commit.**

---

### Task 8: Redirects for the three production routes

**Files:** `app/[brandId]/tools/brain/lobby/page.tsx`, `extract/page.tsx`, `admin/page.tsx` — each a one-line redirect

`/lobby` and `/extract` → `/ingest`. `/admin` → `/tools/brain`, since its list is now the book's.

- [ ] **Step 1: Write the failing test** asserting each old route calls `redirect` with the new path.
- [ ] **Step 2: Run and watch it fail.**
- [ ] **Step 3: Implement** with `redirect()` from `next/navigation`.
- [ ] **Step 4: Verify** the build lists all three.
- [ ] **Step 5: Commit.**

---

### Task 9: Review

- [ ] **Step 1:** Run `/code-review high` over the full diff against `main`.
- [ ] **Step 2:** Fix every CRITICAL and HIGH finding; judge MEDIUM on merit.
- [ ] **Step 3:** Re-run the suite, the typecheck and the build.
- [ ] **Step 4:** Commit fixes separately from the work being reviewed.

---

### Task 10: The browser pass

- [ ] **Step 1:** `npx next dev --port 4300 --hostname 127.0.0.1` — bound explicitly, or Next blocks its own dev bundle as cross-origin and nothing hydrates.
- [ ] **Step 2:** Walk both screens and both sheets.
- [ ] **Step 3:** Check what jsdom cannot: the four views fitting, nothing overflowing 402, the file control reading Hebrew, and the queue's one filled action.
- [ ] **Step 4:** Never press אישור or דחייה. The queue holds a client's real rules.
- [ ] **Step 5:** Fix findings in their own commits, with the finding in the message.

---

### Task 11: Ship it

`main` has neither the eight-tasks port nor this redesign, so this is one
release taking the brain from three screens to a restructured two-screen tool
with eight new capabilities. There is no client on the other end of it — the
tenant is the author's own test data — so the sequence is mechanical rather
than ceremonial.

- [ ] **Step 1:** Merge `feat/brain-foundation` into `feat/brain-knowledge-axes`, then that into `main`, running the suite after each merge rather than trusting the pre-merge run.
- [ ] **Step 2:** `git push origin main`.
- [ ] **Step 3:** Confirm Vercel picked it up and the deployment succeeded, by deployment id rather than by assuming push-to-deploy fired.
- [ ] **Step 4:** Load the deployed URL, sign in, and walk both screens. A build that compiles is not a screen that renders: `requireBrand` and the middleware behave differently against a real domain and a real cookie than against 127.0.0.1.
- [ ] **Step 5:** Report the deployment URL and what was verified on it.
