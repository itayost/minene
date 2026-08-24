# Organisational Brain Implementation Plan (sub-project 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `מוח ארגוני` tool three working entry points ported from eran-task: the approval lobby, PDF rule extraction, and the admin rules history.

**Architecture:** A tool owns its whole URL subtree, so sub-screens can exist at all. A typed data layer under `src/brain/` wraps the existing `rules` and `documents` tables, keeping eran-task's dependency-injected `createRulesApi(client)` shape. The three surfaces are client components against the browser Supabase client, with row-level security enforcing tenancy.

**Tech Stack:** Next.js 16.3.1 App Router, React 19.2.8, TypeScript 7 strict, `@supabase/ssr` 0.12.4, Vitest 4, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-24-organisational-brain-design.md`

## Global Constraints

- Branch off `main`: `feat/organisational-brain`.
- Node `>=20.19.0`. Do not lower this floor.
- TypeScript `strict` and `noUncheckedIndexedAccess` stay enabled. Narrow, never `!` in new source.
- Baseline is 171 passing tests across 16 files, and `pnpm check` must stay green **without Supabase credentials**. Every new module must fail on use, not on load.
- No emojis in code, comments, or documentation.
- **Hebrew copy is reproduced verbatim from eran-task.** Restyling means palette, spacing and layout, never wording. Rewording while converting JSX to TypeScript would make a port bug and an intended change indistinguishable in review.
- Commit format `<type>: <description>`, type one of feat, fix, refactor, docs, test, chore, perf, ci. No attribution trailer.
- pnpm only.
- **Never change a file under `tests/visual/__snapshots__/`.** The 20 references cannot be regenerated. `pnpm visual:reference` exits 1 and `playwright.config.ts` throws on `-u` / `--update-snapshots` / `--update-snapshots=<mode>`. Never weaken either guard. Nothing in this sub-project may change a rendered pixel on the home grid, subject chooser, viewer, or the `משכנע` tool screen.
- **Do NOT fix the `מוח ארגני` label typo in `src/brands/minene.ts:135`.** It is missing a vav and the correct spelling is `מוח ארגוני`, but that label renders in the bottom navigation, which appears in all 20 references. It is scheduled for sub-project 4, where the shell legitimately changes.
- `--grep` must be unanchored: Playwright matches the full title path.

## Source of Truth for the Port

Every ported file has an exact origin. The repository is:

`/Users/itayostraich/Documents/GitHub/eran-task/.worktrees/interactive-dashboard`

on branch `feat/interactive-dashboard` (NOT `master`, which holds only docs).

**Read the origin file before writing its port.** These files carry dense comments explaining decisions that cost real debugging: why `listPendingRules` exists rather than a per-topic fan-out, why `status` defaults to `'approved'` and `topicId` has no default at all, why a `PGRST301` must not collapse into the generic failure bucket. Those comments are the most valuable thing being ported. Carry them across, adjusting only what TypeScript changes.

## Schema Facts, Measured

Enum values, read from the applied migrations. Encode these as union types, never as `string`:

| Column | Values |
|---|---|
| `rules.kind` | `'tip' \| 'process'` |
| `rules.status` | `'pending' \| 'approved' \| 'rejected'` |
| `rules.source` | `'generated' \| 'pdf'` |
| `documents.status` | `'processing' \| 'ready' \| 'failed'` |

The rules column list the API selects is exactly:
`id,topic_id,text,is_starred,created_at,kind,status,source`

The seven topic ids are `live`, `store`, `numbers`, `energy`, `team-energy`, `briefing`, `performance`.

The storage bucket is `documents`, and a document's object path is `<tenant_id>/<document_id>.pdf`. The storage policy matches on that prefix, so the path format is load-bearing, not a convention.

Both edge functions are deployed and active with `verify_jwt = true`: `generate-tips` and `extract-rules`. No backend work is required.

---

### Task 1: Find out whether the lobby will be empty

The lobby lists rules with `status = 'pending'`. If the shared project has none, phase 1 ships something correct but unverifiable by eye, because an empty lobby and a broken lobby look identical.

This task produces an answer, not code.

**Files:** none

- [ ] **Step 1: Ask the controller to run the check**

You cannot query the shared project: it needs either a service-role key, which must never enter this repository, or an authenticated session, whose password you do not have.

Report NEEDS_CONTEXT with this request, verbatim, for a human to run:

> In the Supabase dashboard for project `zibpqbrfvxmkqnwmiboo`, run:
> `select status, count(*) from public.rules group by status;`
> and paste the result.

- [ ] **Step 2: Record the consequence**

If pending rules exist, the phase order in this plan stands.

If there are none, report that phases 2 and 1 should swap, so PDF extraction lands first and creates the data the lobby displays. Do not write a seed script: that is a throwaway artifact for a problem one real PDF solves.

---

### Task 2: Let a tool own its subtree

Without this, every route added later renders inside the wrong shell. `src/core/navigation.ts:46` returns null for a third segment beneath a brand, and `app/[brandId]/brand-shell-client.tsx` turns null into the home screen, so `/minene/tools/brain/lobby` would show the lobby wrapped in home chrome with no error anywhere.

**Files:**
- Modify: `src/core/navigation.ts`
- Test: `tests/resolve-screen.test.ts`

**Interfaces:**
- Consumes: `TOOLS_SEGMENT`, `toolHref` from `src/core/hrefs.ts`
- Produces: `Screen`'s tool variant becomes `{ kind: 'tool'; toolId: string; subPath: readonly string[] }`

- [ ] **Step 1: Write the failing tests**

Add to `tests/resolve-screen.test.ts`:

```ts
it('resolves a tool sub-screen to that tool, carrying the rest of the path', () => {
  const toolId = demoBrand.tools[0]!.id
  expect(resolveScreen(demoBrand, ['tools', toolId, 'lobby'], null))
    .toEqual({ kind: 'tool', toolId, subPath: ['lobby'] })
})

it('carries a deeper sub-path too', () => {
  const toolId = demoBrand.tools[0]!.id
  expect(resolveScreen(demoBrand, ['tools', toolId, 'rules', '123'], null))
    .toEqual({ kind: 'tool', toolId, subPath: ['rules', '123'] })
})

it('resolves the tool root with an empty sub-path', () => {
  const toolId = demoBrand.tools[0]!.id
  expect(resolveScreen(demoBrand, ['tools', toolId], null))
    .toEqual({ kind: 'tool', toolId, subPath: [] })
})

it('still rejects an unknown tool however deep the path', () => {
  expect(resolveScreen(demoBrand, ['tools', 'nope', 'lobby'], null)).toBeNull()
})

it('returns the tool root as the parent of a sub-screen', () => {
  const toolId = demoBrand.tools[0]!.id
  expect(parentHref(demoBrand, { kind: 'tool', toolId, subPath: ['lobby'] }))
    .toBe(`/demo/tools/${toolId}`)
})

it('returns the brand root as the parent of the tool root', () => {
  const toolId = demoBrand.tools[0]!.id
  expect(parentHref(demoBrand, { kind: 'tool', toolId, subPath: [] })).toBe('/demo')
})
```

Existing tests asserting `toEqual({ kind: 'tool', toolId })` now need `subPath: []`. Update them; that churn is expected and was accepted in the spec.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/resolve-screen.test.ts`
Expected: FAIL on the sub-path cases, because the length guard rejects them.

- [ ] **Step 3: Implement**

In `src/core/navigation.ts`, change the tool variant of `Screen` to carry `subPath: readonly string[]`.

In `resolveScreen`, move the tool branch **above** the `segments.length > 2` guard, so a tool claims its whole subtree while subjects stay capped at two segments:

```ts
const first = segments[0]
if (first === undefined) return null

if (first === TOOLS_SEGMENT) {
  const toolId = segments[1]
  if (toolId === undefined) return null
  if (!brand.tools.some((tool) => tool.id === toolId)) return null
  // A tool owns everything beneath it. Route files decide which sub-screens
  // exist; this only decides whose shell the reader is inside, so the header,
  // back control and highlighted navigation item stay right all the way down.
  return { kind: 'tool', toolId, subPath: segments.slice(2) }
}

if (segments.length > 2) return null
```

In `parentHref`, return the tool root for a sub-screen:

```ts
if (screen.kind === 'tool' && screen.subPath.length > 0) {
  return toolHref(brand.id, screen.toolId)
}
```

Import `toolHref` alongside the existing `brandHref` and `subjectHref`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run tests/resolve-screen.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix the fallout and verify the whole suite**

`app/[brandId]/tools/[toolId]/page.tsx` compares `screen.kind !== 'tool'`, which still holds. Any other construction of a tool screen now needs `subPath`.

Run: `pnpm exec tsc --noEmit && pnpm test:run`
Expected: no type errors, and the suite green at 177 or more.

- [ ] **Step 6: Commit**

```bash
git add src/core/navigation.ts tests/resolve-screen.test.ts
git commit -m "feat: let a tool own its whole url subtree"
```

---

### Task 3: The typed data layer

**Files:**
- Create: `src/brain/types.ts`, `src/brain/topics.ts`, `src/brain/rules-api.ts`, `src/brain/documents-api.ts`
- Create: `tests/brain/rules-api.test.ts`, `tests/brain/documents-api.test.ts`

**Origin files, read before porting:**
- `src/services/rulesApi.js` (234 lines) and `src/services/rulesApi.test.js` (448)
- `src/services/documentsApi.js` (169) and `src/services/documentsApi.test.js` (278)
- `src/dashboardData.js` for the seven topics

**Interfaces:**
- Consumes: `createBrowserSupabase()` from `src/auth/supabase-browser.ts`
- Produces:
  - `createRulesApi(client): RulesApi` with `generateTips`, `listRules`, `listPendingRules`, `setStarred`, `setStatus`, `editRule`, `kpis`
  - `createDocumentsApi(client): DocumentsApi` with `upload`, `extract`, `status`, `list`
  - `RulesApiError` / `DocumentsApiError`, each carrying `code` and `status`
  - `RULE_TOPICS: readonly Topic[]`

- [ ] **Step 1: Write the types**

Create `src/brain/types.ts`:

```ts
export type RuleKind = 'tip' | 'process'
export type RuleStatus = 'pending' | 'approved' | 'rejected'
export type RuleSource = 'generated' | 'pdf'
export type DocumentStatus = 'processing' | 'ready' | 'failed'

/** Exactly the columns the API selects. Adding one here without adding it to
 *  the select string produces a field that is always undefined at runtime. */
export type Rule = {
  id: string
  topic_id: string
  text: string
  is_starred: boolean
  created_at: string
  kind: RuleKind
  status: RuleStatus
  source: RuleSource
}

/** Keyset pagination: list_rules orders by (created_at desc, id desc), so both
 *  are needed to resume unambiguously when two rows share a timestamp. */
export type RuleCursor = { created_at: string; id: string }

export type RulePage = { rows: Rule[]; nextCursor: RuleCursor | null }

export type BrainDocument = {
  id: string
  topic_id: string
  filename: string
  status: DocumentStatus
  error: string | null
  created_at: string
}

export type TenantKpis = {
  total: number
  approved: number
  pending: number
}

export type Topic = { id: string; title: string; lines: string[] }
```

Verify `TenantKpis` against the `tenant_kpis` RPC's actual return columns in `supabase/migrations/20260819180600_tenant_kpis_approved.sql` before finalising it, and match them exactly.

- [ ] **Step 2: Port the topics**

Create `src/brain/topics.ts` with the seven topics from `src/dashboardData.js`, Hebrew titles verbatim, typed as `readonly Topic[]`. Export a `getTopic(id: string): Topic | undefined` helper.

These are the rule vocabulary and have nothing to do with brand subjects. Say so in a comment, because the two look similar and must never be merged.

- [ ] **Step 3: Port the rules API**

Create `src/brain/rules-api.ts` from `src/services/rulesApi.js`.

Keep: the `createRulesApi(client)` factory shape, `PAGE_SIZE = 50`, the `COLUMNS` string verbatim, `PGRST301` handling, both Hebrew error messages (`'ההרשאה פגה. נא להתחבר מחדש.'` and `'לא הצלחנו להשלים את הבקשה'`), and every explanatory comment.

Drop: the module-level `browserRulesApi` singleton and its `supabaseClient.js` import. In minene the client comes from `createBrowserSupabase()`, called by the component, so nothing imports Supabase at module load and `pnpm check` keeps passing with no credentials.

Type the client parameter with a narrow structural interface as `src/auth/session.ts` does, not `SupabaseClient`. Supabase's generated types are deep enough to trip `TS2589`, and a narrow interface is what keeps the tests able to pass a plain object.

- [ ] **Step 4: Port the documents API**

Create `src/brain/documents-api.ts` from `src/services/documentsApi.js`, the same way.

Preserve the ordering comment on `upload`: the object must land in storage **before** the `documents` row is inserted, and the storage path must be exactly `<tenant_id>/<document_id>.pdf` or the storage policy rejects it.

`upload` takes the tenant id as an argument. It is never read from user input.

- [ ] **Step 5: Port the tests**

Port `rulesApi.test.js` and `documentsApi.test.js` to `tests/brain/`, converting to TypeScript and repointing imports. Do not rewrite the assertions: they describe behaviour that already works, so a failure means the port is wrong, which is the entire reason this is a port and not a rewrite.

- [ ] **Step 6: Verify**

Run: `pnpm exec tsc --noEmit && pnpm test:run`
Expected: no type errors; the suite grows by roughly 40 tests and stays green.

Also confirm the credential-free constraint still holds:

```bash
test -f .env.local && mv .env.local .env.local.bak
pnpm check && echo "credential-free: PASS"
test -f .env.local.bak && mv .env.local.bak .env.local
```

- [ ] **Step 7: Commit**

```bash
git add src/brain tests/brain
git commit -m "feat: add a typed data layer for rules and documents"
```

---

### Task 4: Expired sessions send the reader back to sign in

New behaviour with nothing to inherit. These screens make requests without navigating — polling an extraction, starring a rule — so a session can expire in place, where the middleware never sees it.

**Files:**
- Create: `src/brain/use-api-error.ts`
- Create: `tests/brain/use-api-error.test.tsx`

**Interfaces:**
- Consumes: `RulesApiError`, `DocumentsApiError`
- Produces: `useApiErrorHandler(): (error: unknown) => string | null` — returns a Hebrew message to display, or null when it has already redirected

- [ ] **Step 1: Write the failing test**

```tsx
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/minene/tools/brain/lobby',
}))

const { useApiErrorHandler } = await import('../../src/brain/use-api-error')
const { RulesApiError } = await import('../../src/brain/rules-api')

describe('useApiErrorHandler', () => {
  it('sends an expired session to sign in, preserving where they were', () => {
    replace.mockClear()
    const { result } = renderHook(() => useApiErrorHandler())

    const message = result.current(new RulesApiError('UNAUTHORIZED', 401, 'ההרשאה פגה. נא להתחבר מחדש.'))

    expect(replace).toHaveBeenCalledWith('/login?next=%2Fminene%2Ftools%2Fbrain%2Flobby')
    expect(message).toBeNull()
  })

  it('returns the message for an ordinary failure without redirecting', () => {
    replace.mockClear()
    const { result } = renderHook(() => useApiErrorHandler())

    const message = result.current(new RulesApiError('REQUEST_FAILED', 500, 'לא הצלחנו להשלים את הבקשה'))

    expect(replace).not.toHaveBeenCalled()
    expect(message).toBe('לא הצלחנו להשלים את הבקשה')
  })

  it('returns a generic Hebrew message for an unrecognised throw', () => {
    const { result } = renderHook(() => useApiErrorHandler())
    expect(result.current(new Error('boom'))).toBe('לא הצלחנו להשלים את הבקשה')
  })
})
```

- [ ] **Step 2: Run to verify failure, implement, run to verify it passes**

The implementation reads `usePathname()`, encodes it into `?next=`, and calls `router.replace` only for a 401. Everything else returns its message. Use `encodeURIComponent` on the path so the assertion above holds.

- [ ] **Step 3: Commit**

```bash
git add src/brain/use-api-error.ts tests/brain/use-api-error.test.tsx
git commit -m "feat: send an expired session back to sign in"
```

---

### Task 5: The מוח ארגוני screen, with three entry points

This is the task that satisfies the original request. It ships before any surface exists, so each button links to a route added in a later task; until then those routes 404. Add the buttons last-to-first if you would rather never see a dead link, but the screen itself is independently reviewable now.

**Files:**
- Create: `app/[brandId]/tools/brain/page.tsx`
- Modify: `src/styles.css`
- Test: `tests/routes.test.tsx`

**Interfaces:**
- Consumes: `requireBrand` from `src/auth/require-brand.ts`, `ToolScreen`, `toolHref`
- Produces: nothing later tasks import

- [ ] **Step 1: Write the route**

Create `app/[brandId]/tools/brain/page.tsx`. Next resolves a static segment before a dynamic one, the same rule that makes `tools` beat `[subjectId]`, so this serves `/minene/tools/brain` while `[toolId]` keeps serving `משכנע` and `קמפיינר` untouched. `ToolScreen` is not modified and there is no conditional on the tool id anywhere.

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireBrand } from '../../../../src/auth/require-brand'
import { ToolScreen } from '../../../../src/components/ToolScreen'

type BrainParams = { params: Promise<{ brandId: string }> }

const BRAIN_TOOL_ID = 'brain'

export default async function BrainPage({ params }: BrainParams) {
  const { brandId } = await params
  const { brand, session } = await requireBrand(brandId)

  const tool = brand.tools.find((candidate) => candidate.id === BRAIN_TOOL_ID)
  if (!tool) notFound()

  // The admin entry is owner-only, matching the route it points at. Showing a
  // staff member a link to a page that will 404 for them is worse than not
  // showing it: it reads as a broken app rather than as a permission boundary.
  const entries = [
    { href: `/${brand.id}/tools/${BRAIN_TOOL_ID}/lobby`, label: 'לובי אושר', note: 'חוקים הממתינים לאישור' },
    { href: `/${brand.id}/tools/${BRAIN_TOOL_ID}/extract`, label: 'חילוץ חוקים', note: 'העלאת PDF וחילוץ חוקים' },
    ...(session.role === 'owner'
      ? [{ href: `/${brand.id}/tools/${BRAIN_TOOL_ID}/admin`, label: 'דשבורד', note: 'היסטוריית החוקים' }]
      : []),
  ]

  return (
    <div className="brain-screen">
      <nav className="brain-entries" aria-label="כלי מוח ארגוני">
        {entries.map((entry) => (
          <Link className="brain-entry" href={entry.href} key={entry.href}>
            <span className="brain-entry__label">{entry.label}</span>
            <span className="brain-entry__note">{entry.note}</span>
          </Link>
        ))}
      </nav>

      <ToolScreen tool={tool} />
    </div>
  )
}
```

Note this route uses `notFound()` rather than `assertDefined`, unlike its sibling routes. Those call `resolveScreen` first, which has already proved the tool exists, so a miss there would be a bug. Here nothing has validated it, so a missing `brain` tool in a brand's manifest is a legitimate 404 rather than an invariant violation.

- [ ] **Step 2: Style the entries**

Append to `src/styles.css`. New class names only, so nothing the references cover is touched. Match the existing pink rows — same radius, same right-to-left alignment, same accent — but heavier, so actions read above reference material.

- [ ] **Step 3: Test the screen**

Add to `tests/routes.test.tsx`: an owner sees three entries, a staff member sees two and none of them is `דשבורד`, and the preview list still renders beneath them.

- [ ] **Step 4: Verify the references did not move**

```bash
VIEWER_TEST_EMAIL=... VIEWER_TEST_PASSWORD=... pnpm visual:verify
```

Expected: 20 passed. This screen is not among the four captured, so any movement means something unrelated broke. Never regenerate.

- [ ] **Step 5: Commit**

```bash
git add app/[brandId]/tools/brain src/styles.css tests/routes.test.tsx
git commit -m "feat: add the three organisational brain entry points"
```

---

### Task 6: Phase 1, לובי אושר

**Files:**
- Create: `app/[brandId]/tools/brain/lobby/page.tsx`, `app/[brandId]/tools/brain/lobby/lobby-client.tsx`
- Create: `src/brain/RuleEditSheet.tsx`
- Create: `tests/brain/lobby.test.tsx`

**Origin files:** `src/lobby/ApprovalLobby.jsx` (319), `src/lobby/RuleEditSheet.jsx` (127), `src/lobby/ApprovalLobby.test.jsx` (523)

**Interfaces:**
- Consumes: `createRulesApi`, `useApiErrorHandler`, `requireBrand`
- Produces: nothing later tasks import

- [ ] **Step 1: Read the origin, then port**

The server component calls `requireBrand`, then renders the client component. The client component owns all state and calls `createRulesApi(createBrowserSupabase())`.

Preserve exactly: oldest-first ordering, the cursor paging loop that pages `listPendingRules` until exhausted, approve and reject, the edit sheet correcting text, kind and topic before approval, and every Hebrew string including `'לובי אושר'`, `'אין כרגע חוקים הממתינים לאישור.'` and the `aria-label` on each action that names the rule it applies to.

That `aria-label` exists because the visible `אישור` and `דחייה` labels repeat down the list, leaving a screen-reader user with no way to tell which rule a button belongs to. Keep it.

- [ ] **Step 2: Port the tests, run, commit**

Port `ApprovalLobby.test.jsx`, converting to TypeScript. Run `pnpm exec tsc --noEmit && pnpm test:run`, then verify by hand against the real project, then commit as `feat: serve the approval lobby from a Next route`.

---

### Task 7: Phase 2, חילוץ חוקים

**Files:**
- Create: `app/[brandId]/tools/brain/extract/page.tsx`, `.../extract-client.tsx`
- Create: `src/brain/DocumentsList.tsx`
- Create: `tests/brain/extract.test.tsx`

**Origin files:** `src/upload/UploadPage.jsx` (172), `src/upload/DocumentsList.jsx` (104), plus both test files

**Interfaces:**
- Consumes: `createDocumentsApi`, `useApiErrorHandler`, `requireBrand`, `RULE_TOPICS`
- Produces: nothing later tasks import

- [ ] **Step 1: Read the origin, then port**

The server component passes `session.tenantId` to the client component as a prop, because `upload` needs it to build the storage path and it must never come from user input.

Preserve: topic selection from the seven rule topics, PDF-only validation with `'יש לבחור קובץ PDF להעלאה.'`, the upload-then-insert ordering, the `extract-rules` invocation, the status poll, and the success message reporting how many rules are now waiting in the lobby.

- [ ] **Step 2: Port the tests, run, commit**

Commit as `feat: serve pdf rule extraction from a Next route`.

---

### Task 8: Phase 3, דשבורד

**Files:**
- Create: `app/[brandId]/tools/brain/admin/page.tsx`, `.../admin-client.tsx`
- Create: `src/brain/AdminRulesTable.tsx`, `src/brain/AdminToolbar.tsx`, `src/brain/KpiCards.tsx`, `src/brain/KindFilter.tsx`, `src/brain/ActiveFilters.tsx`
- Create: `tests/brain/admin.test.tsx`

**Origin files:** `src/admin/AdminApp.jsx` (389) and its five components, plus their tests

**Interfaces:**
- Consumes: `createRulesApi`, `useApiErrorHandler`, `requireBrand`
- Produces: nothing later tasks import

- [ ] **Step 1: Gate the route to owners**

The server component calls `requireBrand`, then `notFound()` unless `session.role === 'owner'`. A 404, never a 403, so a staff member cannot learn the page exists. This is the first use of the `role` carried through in sub-project 2a.

- [ ] **Step 2: Read the origin, then port**

Preserve: topic, text and starred filters, persistent stars, cursor paging, and the KPI cards. Note that eran-task's `AdminApp` also owns an access-refusal branch for a non-owner; here the route 404s before rendering, so that branch is not ported. Say so in the commit body.

- [ ] **Step 3: Test the gate explicitly**

A staff role must get `notFound()` from the route, not a rendered page with hidden controls.

- [ ] **Step 4: Port the tests, run, commit**

Commit as `feat: serve the rules history from a Next route`.

---

### Task 9: Verify the whole thing end to end

**Files:** `README.md`

- [ ] **Step 1: Full gate**

```bash
pnpm check
VIEWER_TEST_EMAIL=... VIEWER_TEST_PASSWORD=... pnpm visual:verify
```

Expected: `pnpm check` green, and **20/20** visual. Nothing here should have moved a reference.

- [ ] **Step 2: Walk the real loop against the shared project**

Sign in, open `מוח ארגוני`, upload a real PDF through `חילוץ חוקים`, watch it reach `ready`, find the new rules in `לובי אושר`, approve one, and see it appear in `דשבורד`. That single pass exercises every ported surface and both edge functions.

- [ ] **Step 3: Confirm the boundaries hold**

- A staff account sees no `דשבורד` entry and gets 404 at its URL.
- `/minene/tools/brain/nonsense` answers 404.
- Back from a sub-screen returns to `מוח ארגוני`, and the bottom navigation keeps it highlighted throughout.

- [ ] **Step 4: Document and commit**

Add a `מוח ארגוני` section to `README.md` covering the three surfaces, the owner-only dashboard, and that the seven rule topics are a separate vocabulary from brand subjects.

---

## Self-Review

**Spec coverage.** Routing to Task 2; the data layer to Task 3; expired sessions to Task 4; the screen and its entry points to Task 5; the three surfaces to Tasks 6 through 8; the empty-lobby risk to Task 1; testing throughout and consolidated in Task 9.

**Why the ported tasks are thinner than the rest of this plan.** Tasks 6 through 8 name origin files instead of reproducing their code. That is deliberate and not a placeholder: the code exists, is proven, and carries comments worth more than anything I would paraphrase. What those tasks specify is what a port cannot read off the original — which behaviour is load-bearing, which comments must survive, what changes because the target is Next rather than Vite, and what is deliberately not ported. Reproducing 1,800 lines here would add a second source of truth that could drift from the first.

**Known ordering risk.** Task 5 ships buttons pointing at routes that do not exist until Tasks 6 through 8, so `מוח ארגוני` briefly offers three links that 404. That is visible to anyone using the deployed app between those commits. Building the surfaces first and the screen last would avoid it, at the cost of not being able to reach them while building. Either is defensible; the plan takes the reviewable-sooner option, and the risk is only real if this branch deploys mid-way.

**Weakest point.** Task 1 can block the whole plan, and it depends on a human running a query. If pending rules turn out to be absent, phases 1 and 2 swap, which reorders Tasks 6 and 7 but changes neither task's content.
