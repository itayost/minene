# משכנע Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the persuasion engine into minene as a role-aware tab — a manager's real conversation on one side, a lab whose matrix is its own navigation on the other.

**Architecture:** The engine moves in as a module, not a service: both apps are Next 16.3.1, so `src/engine` and `src/lib` become minene directories and the HTTP layer between them disappears. Real conversations stay tenant-scoped; simulations are a separate, cross-tenant table, and that separation is what makes a shared bank safe.

**Tech Stack:** Next 16.3.1 App Router, React 19.2.8, TypeScript strict with `noUncheckedIndexedAccess`, Vitest + Testing Library + jsdom, Vercel AI SDK (`ai`, `@ai-sdk/openai`), Supabase, plain CSS with per-brand custom properties.

**Spec:** `docs/superpowers/specs/2026-08-27-persuasion-design.md`
**Visual reference:** the published persuasion artifact — two device drawings, the matrix heatmap, and the cell/bank detail.

## The same deviation as Plan 2, stated again

Full test code and exact verification per task; implementation described rather than reproduced line by line, because this is executed inline by the author of the code it changes. The tests are complete, since they are what drives the work. Handed to someone without that context, the implementation bodies must be filled in first.

## Global Constraints

- **RTL and Hebrew.** Logical properties throughout.
- **The shell is 402px.** Chrome will not size a window below ~400 on macOS, so 320 is reasoned about and said to be reasoned about, never claimed as verified.
- **Do not touch** the bottom nav, `BrandShell`, or the manifest label `מוח ארגני`.
- **The 15 frozen Playwright references cannot be regenerated.** Never run Playwright with `-u`. None covers `/tools/persuade`; the one tool snapshot is `/minene/tools/persuade` — **check this before Task 4 touches that route.**
- **`src/brain/brain.css` stays policed** by `tests/brain/palette.test.ts`. New persuasion CSS gets the same guard.
- **Migrations live in eran-task**, never in minene.
- **The tenant holds test data**, not a client's.
- **TDD**, commit after every task, no `Co-Authored-By` trailer.

---

### Task 0: Check the frozen reference before anything else

The tool-screen snapshot is `/minene/tools/persuade` — the exact route this plan replaces. If it is a live gate, Task 4 breaks it and the reference cannot be regenerated.

**Files:** none. This is a five-minute investigation whose answer changes the plan.

- [ ] **Step 1: Find out what the reference actually captures**

```bash
grep -n "persuade\|TOOL_LABEL" tests/visual/viewer.spec.ts
ls tests/visual/__snapshots__/tool-*
```

- [x] **Step 2: Decided, 2026-08-27, before any code was written**

**Answered: the references capture the generic `ToolScreen` at `/minene/tools/persuade`,** at five widths — `viewer.spec.ts:17` sets `TOOL_LABEL = 'משכנע'` and line 79 navigates to exactly that path. It is a live gate on the route this plan replaces.

**So the five `tool-*.png` references are retired, not regenerated.** This is the same act as `c0cee5f`, which deleted the home reference and its five snapshots when the home screen was deliberately replaced: the guards exist to stop a reference being silently overwritten with post-change output, and deleting one whose screen was deliberately retired is a different thing from regenerating it. The commit that removes them carries the reasoning.

The remaining ten — `subject-menu` and `page-viewer`, five widths each — stay a live gate and are untouched by anything in this plan.

**One consequence for Task 4:** `/tools/persuade` becomes a static segment beating the `[toolId]` route, exactly as `brain` already does. `[toolId]` then serves only `campaign`, which is still a real preview screen, so `ToolScreen` itself stays.

---

### Task 1: The invariant the whole design rests on

A simulation must never be seeded from a tenant's knowledge. If it ever is, the shared bank starts carrying one business's private rules into another's matrix. This is a test, not a comment, and it comes first so nothing is built on an unguarded assumption.

**Files:**
- Create: `tests/persuade/tenant-boundary.test.ts`

**Interfaces:**
- Consumes: nothing yet — it asserts over source text and, from Task 2, over the moved modules.
- Produces: the guard every later task must keep passing.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @vitest-environment node
 *
 * Reads files, so not jsdom -- import.meta.url is not a file: URL there and
 * readFileSync throws, which looks exactly like a failing guard.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

describe('a simulation never touches a tenant’s knowledge', () => {
  it('does not reach for ammunition, a tenant or an assignment', () => {
    const sim = source('src/persuade/engine/simulation.ts')

    // The bank is shared across tenants, and it is built only from simulations.
    // That is safe exactly as long as a simulation is an invented scenario
    // against a synthetic persona. Seed one from persuasion_ammunition and one
    // business's approved rules start appearing in another's matrix.
    expect(sim).not.toMatch(/ammunition/i)
    expect(sim).not.toMatch(/tenantId|tenant_id/)
    expect(sim).not.toMatch(/assignmentId|assignment_id/)
  })

  it('keeps the simulate route free of them too', () => {
    const route = source('app/api/persuade/simulate/route.ts')

    expect(route).not.toMatch(/ammunition/i)
    expect(route).not.toMatch(/assignmentId|assignment_id/)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/persuade/tenant-boundary.test.ts`
Expected: FAIL on the missing files. That is the correct first failure — the guard exists before the thing it guards.

- [ ] **Step 3: Leave it failing and commit it as a pending guard**

Do **not** stub files to make it pass. Commit the test alone, with the skip removed in Task 2 when the files arrive.

```bash
git add tests/persuade/tenant-boundary.test.ts
git commit -m "test: guard the boundary the shared bank depends on"
```

If committing a red test is unacceptable in this repo's workflow, fold this task into Task 2 rather than weakening the assertion.

---

### Task 2: Move the engine in

**Files:**
- Create: `src/persuade/engine/` — `types.ts`, `rules.ts`, `prompts.ts`, `knowledge.ts`, `prepare.ts`, `turn.ts`, `target.ts`, `simulation.ts`, `config.ts`, `ammunition.ts`
- Create: `src/persuade/lib/` — `model.ts`, `store.ts`, `caller.ts`, `access.ts`, `assignments.ts`, `content.ts`
- Modify: `package.json` — add `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `zod`
- Modify: `.env.example` — `OPENAI_API_KEY`
- Create: `content/` — personas and plans
- Test: `tests/persuade/tenant-boundary.test.ts` now runs

**Interfaces:**
- Consumes: nothing from minene.
- Produces: `preparePlan()`, `persuaderTurn()`, `runSimulation()`, `DEFAULT_RULES`, and the `ConversationState` / `PersuasionPlan` / `Run` types.

- [ ] **Step 1: Copy, do not rewrite**

```bash
cp -r ../eran-presueder/src/engine src/persuade/engine
cp -r ../eran-presueder/src/lib src/persuade/lib
cp -r ../eran-presueder/content content
```

Delete `src/persuade/lib/cors.ts` and `use-media-query.ts` on the way in: same-origin now, and minene has its own responsive approach.

- [ ] **Step 2: Port the imports**

eran-presueder uses `@/engine/...`; minene uses relative paths and has no such alias. Rewrite each import rather than adding an alias — an alias would make two path conventions live in one repo.

- [ ] **Step 3: Bring eran-presueder's own tests with it**

Its 141 tests are the safety net for this move. Copy them into `tests/persuade/` and repoint their imports. **A test that fails after the move is the move being wrong**, not a test to adjust.

- [ ] **Step 4: Verify**

Run: `npx vitest run && npx tsc --noEmit && npx next build`
Expected: minene's 381 plus eran-presueder's engine tests, all green. The boundary guard from Task 1 now runs and passes.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: bring the persuasion engine into minene as a module

Both apps are Next 16.3.1 and React 19.2.8, so this is a directory move
rather than a port between frameworks -- the comment in persuaderApi.js
claiming otherwise was written when the host was still Vite.

cors.ts does not come: same origin now. The engine's own 141 tests come
first, because they are what proves the move did not change behaviour."
```

---

### Task 3: The routes, and the matcher that would swallow them

**Files:**
- Create: `app/api/persuade/chat/route.ts`, `generate/route.ts`, `simulate/route.ts`
- Modify: `middleware.ts` — exclude `api`
- Test: `tests/persuade/api-gate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { config } from '../../middleware'

describe('the middleware and the persuasion API', () => {
  it('does not redirect an API call to the login screen', () => {
    const matcher = config.matcher[0] as string
    const pattern = new RegExp(matcher.replace(/^\/\(/, '(').replace(/\)$/, ')'))

    // The matcher exists to send a signed-out visitor to /login. Applied to an
    // API route that answers a fetch, it turns a 401 into a 307 pointing at an
    // HTML page -- which a caller cannot act on. The routes verify their own
    // caller before touching the model, so exclusion is the fix, not a second
    // check.
    expect(pattern.test('api/persuade/chat')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail.** The current matcher is `'/((?!login|logout|_next/static|_next/image|favicon.ico|brands/).*)'` and matches `api/...`.

- [ ] **Step 3: Add `api` to the exclusion list**, with a comment recording why: the routes authenticate their own caller, and a redirect is not an answer a fetch can use.

- [ ] **Step 4: Port the three routes.** They become minene route handlers. `resolveCaller` keeps working — same Supabase project, same cookie, now same origin. `PERSUADER_ALLOW_ANONYMOUS` stays for the drafting path but stops being a security boundary, since there is no separately-deployed origin to reach.

- [ ] **Step 5: Verify and commit.**

---

### Task 4: `/tools/persuade` — what has been asked of me

**Files:**
- Create: `app/[brandId]/tools/persuade/page.tsx`, `persuade-client.tsx`
- Create: `src/persuade/assignments-api.ts`
- Test: `tests/persuade/assignments.test.tsx`

**Interfaces:**
- Consumes: `BottomSheet` and `BrainCard` from the brain work.
- Produces: `/tools/persuade` rendering role-aware, with an owner link to `/tools/persuade/lab`.

**Blocked on Task 0.**

- [ ] **Step 1: Write the failing tests**

```tsx
it('lists what was asked of this person, not a menu of tools', async () => {
  render(<PersuadeClient brandId="minene" role="staff" />)

  expect(await screen.findByText('לקיים תדריך של 4 דקות בפתיחה, כל יום.')).toBeVisible()
})

it('distinguishes agreed from executed, because they are different facts', async () => {
  render(<PersuadeClient brandId="minene" role="staff" />)

  // A finished conversation writes an `asked` event and settles nothing. Only
  // an execution report closes an assignment, and a partial settles as not_done
  // so the measurement cannot drift upward one generous rounding at a time.
  const rows = await screen.findAllByRole('listitem')
  expect(within(rows[1] as HTMLElement).getByText(/הוסכם · טרם בוצע/)).toBeVisible()
})

it('gives an owner one link to the lab, and a staff member none', async () => {
  render(<PersuadeClient brandId="minene" role="owner" />)
  expect(await screen.findByRole('link', { name: /מעבדה/ }))
    .toHaveAttribute('href', '/minene/tools/persuade/lab')

  cleanup()
  render(<PersuadeClient brandId="minene" role="staff" />)
  await screen.findAllByRole('listitem')
  expect(screen.queryByRole('link', { name: /מעבדה/ })).toBeNull()
})
```

- [ ] **Step 2–5:** Run red, implement against `assignments`, verify, commit.

---

### Task 5: The conversation, as a sheet

**Files:** `src/persuade/Conversation.tsx`, `tests/persuade/conversation.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows the rung and the blocker, because they explain the next line', async () => {
  const user = await openConversation()
  await user.click(screen.getByRole('button', { name: 'שליחה' }))

  expect(await screen.findByText(/overloaded/)).toBeVisible()
})

it('never settles the assignment when the conversation ends', async () => {
  const user = await openConversation()
  await user.click(screen.getByRole('button', { name: 'סיום' }))

  // recordAsked runs on every finished conversation and settles nothing,
  // whatever the outcome. Only recordExecution may settle.
  await waitFor(() => expect(api.recordAsked).toHaveBeenCalled())
  expect(api.settleAssignment).not.toHaveBeenCalled()
})
```

- [ ] **Step 2–5:** Red, implement on `BottomSheet`, verify, commit.

---

### Task 6: Port scoring and rates

Not a merge. `lab/measurement` is an ancestor of `main`, so `git merge` does nothing; and those files were written before rules became a per-request `RuleConfig` and before `Run` lost its score fields.

**Files:** `src/persuade/engine/score.ts`, `rates.ts`; `tests/persuade/rates.test.ts`

- [ ] **Step 1: Recover the files, per eran-presueder's own README**

```bash
git -C ../eran-presueder show lab/measurement:src/engine/score.ts > src/persuade/engine/score.ts
git -C ../eran-presueder show lab/measurement:src/engine/rates.ts > src/persuade/engine/rates.ts
```

- [ ] **Step 2: Write the failing tests, which are the port's specification**

```ts
it('keeps the two denominators apart', () => {
  const runs = [
    run({ outcome: 'agreed', executed: 'yes' }),
    run({ outcome: 'agreed', executed: 'no' }),
    run({ outcome: 'refused' }),
    run({ outcome: 'refused' }),
  ]

  // Out of 100 conversations, how many said yes -- and out of 100 who said yes,
  // how many actually did. Different denominators on purpose, never merged.
  expect(computeRates(runs).persuasionRate).toBe(50)
  expect(computeRates(runs).executionRate).toBe(50)
})

it('reports no execution rate at all when nobody agreed', () => {
  const rates = computeRates([run({ outcome: 'refused' })])

  // Zero agreements means the execution denominator is zero. That is "no data",
  // not 0% -- the same null-is-not-zero rule the brain's rating follows.
  expect(rates.executionRate).toBeNull()
})

it('counts a partial execution as not done', () => {
  const rates = computeRates([run({ outcome: 'agreed', executed: 'partial' })])

  // Otherwise the measurement drifts upward one generous rounding at a time.
  expect(rates.executionRate).toBe(0)
})
```

The second test is a **deliberate change** from the recovered code, which returns 0 for a zero denominator. Record it in the commit message.

- [ ] **Step 3: Port until green.** Check `50de4c2 fix: a counter-offer is not an agreement` — it landed after the strip and changed outcome detection. Restoring `score.ts` naively could undo it.

- [ ] **Step 4–5:** Verify, commit.

---

### Task 7: The `simulations` table

**Files:** a migration in **eran-task**, not minene: `supabase/migrations/*_add_simulations.sql`

- [ ] **Step 1: Write the migration**

Columns: `id`, `industry`, `job_role_id`, `need`, `persona_id`, `plan jsonb`, `turns jsonb`, `outcome`, `score jsonb`, `created_at`. **No `tenant_id`** — that absence is the design, and the column comment must say so.

RLS: readable by any authenticated user, writable by owners. The comment records why this table is the one exception to tenant scoping: it holds invented conversations against synthetic personas, so there is no tenant's knowledge in it to protect.

- [ ] **Step 2: Apply it and verify against the deployed schema**, the way the brain's columns were checked — a bogus column returns `42703`, a real one returns `42501`.

- [ ] **Step 3: Commit in eran-task**, and note the cross-repo dependency in minene's plan.

---

### Task 8: The matrix

**Files:** `app/[brandId]/tools/persuade/lab/page.tsx`, `lab-client.tsx`; `src/persuade/Matrix.tsx`; `src/persuade/persuade.css`; `tests/persuade/matrix.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it('renders a cell with no runs as unmeasured, not as zero', async () => {
  render(<Matrix cells={[cell({ industry: 'פארם', roleId: 'r2', runs: 0 })]} />)

  const cell_ = await screen.findByRole('gridcell', { name: /פארם.*אין ריצות/ })
  expect(cell_).toHaveAttribute('data-heat', 'none')
  expect(cell_).not.toHaveTextContent('0%')
})

it('carries the denominator with the rate', async () => {
  render(<Matrix cells={[cell({ rate: 81, runs: 42 })]} />)

  // 81% off four runs and 81% off forty support different decisions.
  expect(await screen.findByText('42 ריצות')).toBeVisible()
})

it('is a real grid, so it can be read a row at a time', async () => {
  render(<Matrix cells={grid()} />)
  expect(await screen.findByRole('grid')).toBeVisible()
})
```

- [ ] **Step 2: Run red.**

- [ ] **Step 3: Implement.** One hue, light to dark, five steps from the brand rose. Per-step label colour is computed, not chosen: `#B76578` reaches only 4.08:1 against white and fails at body size, so step 4 is `#A35468` at 5.22:1. No-data gets no fill plus a hatch, so the distinction survives greyscale and colour blindness.

- [ ] **Step 4: Add the palette guard for the new stylesheet**, extending `tests/brain/palette.test.ts` to cover `src/persuade/persuade.css` — same three rules.

- [ ] **Step 5–6:** Verify, commit.

---

### Task 9: The cell, and the bank derived from it

**Files:** `src/persuade/CellDetail.tsx`, `src/persuade/simulations-api.ts`, `tests/persuade/bank.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('builds the bank from scored runs rather than from a stored list', async () => {
  const bank = await buildBank(runsIn({ industry: 'אופנה', roleId: 'r1' }))

  // Not a table somebody maintains: a query over what actually won. A stored
  // bank drifts from the runs the moment either changes.
  expect(bank[0]).toMatchObject({ category: 'less_work_later', wonCount: 14 })
})

it('ranks by how often an argument won, not by how often it was tried', async () => {
  const bank = await buildBank([
    ...Array.from({ length: 20 }, () => tried('numbers')),
    ...Array.from({ length: 3 }, () => won('numbers')),
    ...Array.from({ length: 5 }, () => won('social_proof')),
  ])

  expect(bank[0]?.category).toBe('social_proof')
})

it('reports a blocker’s break rate, not just its frequency', async () => {
  const blockers = await blockersIn(runsIn({ industry: 'אופנה', roleId: 'r1' }))

  // "Encountered 26 times" is not useful. "Broken in 19 of 26" is.
  expect(blockers[0]).toMatchObject({ id: 'overloaded', encountered: 26, overcome: 19 })
})
```

- [ ] **Step 2–5:** Red, implement, verify, commit.

---

### Task 10: Review, browser pass, ship

- [ ] **Step 1:** `/code-review high main` over the whole diff.
- [ ] **Step 2:** Fix every CRITICAL and HIGH; judge MEDIUM on merit. **Re-check the Task 1 boundary guard by hand** — it is the one finding a reviewer is least likely to reach on its own.
- [ ] **Step 3:** Browser pass at 402 and 768. The matrix is the one surface whose entire job is visual comparison, so it is the one jsdom cannot judge at all.
- [ ] **Step 4:** Start the dev server with an explicit `--hostname`, or Next blocks its own bundle as cross-origin and nothing hydrates.
- [ ] **Step 5:** Merge, push, confirm the Vercel deployment by id, and load the deployed URL.

---

## Risks carried into implementation

- **Task 0 is settled and it cost five frozen references.** They gated the exact screen this replaces, and they are retired with the reasoning in the commit rather than regenerated. Ten remain as a live gate. This is the whole reason Task 0 ran first: found after Task 4, it would have looked like a broken test to make pass.
- **The industry axis has one value.** Minene is one business in one sector, so the matrix is a single honest row until a second tenant exists. Build for that rather than for the illustration in the artifact.
- **Every lab run costs model calls.** Single on-demand runs first. Batch only once a cell's real cost is known.
- **`OPENAI_API_KEY` is minene's first server secret.** Approved deliberately. It changes what a leak of this repo's environment would mean.
