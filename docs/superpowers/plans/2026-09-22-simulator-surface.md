# Simulator Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the lab screen into the instrument the brief asks for: every industry, every role, every need, the persuasions under each need, live counters, and filters, all read from the taxonomy rather than from whatever happens to have been run.

**Architecture:** The taxonomy (`role_needs`) is the spine and simulations are an overlay joined onto it by an exact lookup of `plan.id` against a map built with `planKeyFor`. Two queueing paths stop writing the world's reason into the `need` column. The screen polls counts rather than paging the table, and reads run summaries without the `turns` column.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Supabase (project ref `zibpqbrfvxmkqnwmiboo`, shared with eran-task), Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-09-22-simulator-surface-design.md`

## Global Constraints

- Hebrew only. There is no English surface and no second locale. Every visible string, every `aria-label`, and every thrown error message is Hebrew.
- RTL throughout. Use logical CSS properties (`margin-inline-start`, not `margin-left`).
- Biome style: single quotes, no semicolons, 2-space indent, 100 column width. Run `pnpm lint:fix` before committing.
- TypeScript strict. `pnpm ci` runs `biome ci . && tsc --noEmit && vitest run` and must pass before any task is considered done.
- No new npm dependencies. Nothing in this plan needs one.
- No migrations. Every table this plan reads (`role_needs`, `persuasion_lab_plans`, `simulations`, `simulation_jobs`) already grants `select` to `authenticated`. If a task seems to need a migration, stop and raise it: migrations live in the eran-task repo, not this one.
- The tenant boundary is absolute. Nothing added here may read `rules`, `roles`, `documents`, `profiles`, `persuasion_ammunition`, a `tenantId` or an `assignmentId`. `tests/persuade/tenant-boundary.test.ts` enforces this by reading source text, and Task 9 extends it to the new files.
- A cell that has never been run reports `runs: 0` and `persuasionRate: null`. Never `0`. "Nobody has tried this" and "everybody refused" are opposite facts and the screen renders them differently.

---

### Task 1: Find out why the cron stopped

This is an investigation, not a code change. It may end in a one-line fix or in a report; both are valid outcomes. Do it first, because the rest of the plan builds a screen whose numbers stay at zero until the loop runs.

**Files:**
- Create: `docs/superpowers/notes/2026-09-22-cron-stall.md`
- Possibly modify: `vercel.json`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks import. A written finding.

**Background you need:** `vercel.json` declares one cron, `/api/persuade/worker`, every 10 minutes. The route returns 401 unless the request carries `authorization: Bearer ${CRON_SECRET}`, and returns 401 when `CRON_SECRET` is unset, because `authorized()` returns false with no secret configured. The queue is empty, `simulation_feed.refilled_at` has not moved since 2026-09-17 20:30, and 249 jobs failed with `You have no credits remaining`.

- [ ] **Step 1: Establish whether the cron is registered at all**

```bash
cd /Users/itayostraich/Documents/GitHub/minene
cat .vercel/project.json 2>/dev/null || echo 'not linked'
vercel ls
```

If `.vercel/project.json` is absent, run `vercel link` and pick the project the user names. Record the project name in the note.

Crons are registered from the `vercel.json` of the **production** deployment only. A `vercel.json` that has only ever shipped on a preview branch registers nothing, which is the first hypothesis to rule in or out.

- [ ] **Step 2: Establish whether production carries the cron**

```bash
git log --oneline --all -- vercel.json
vercel ls --prod
git merge-base --is-ancestor $(git log -1 --format=%H -- vercel.json) origin/main \
  && echo 'cron block is in main' \
  || echo 'cron block is NOT in main'
```

Expected finding: whether the commit that introduced the `crons` block is an ancestor of what is live in production. Write the answer in the note.

- [ ] **Step 3: Check the secret exists in production**

```bash
vercel env ls production
```

Look for `CRON_SECRET`. Do not print its value, and do not paste it into the note. Record only present or absent.

- [ ] **Step 4: Write the finding**

Create `docs/superpowers/notes/2026-09-22-cron-stall.md` with: which project the repo is linked to, whether production carries the cron block, whether `CRON_SECRET` is set in production, and the conclusion. If the cause is outside this repo (no production deployment carrying the cron, or a missing environment variable), say so plainly and name the action the user has to take. Do not set an environment variable or promote a deployment on their behalf.

State explicitly in the note that model credits are exhausted and that no fix here produces a single run until they are restored.

- [ ] **Step 5: Apply the fix if it lives in the repo**

Only if Step 2 or 3 identified something in `vercel.json` itself. Otherwise skip.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/notes/2026-09-22-cron-stall.md vercel.json
git commit -m "docs: why the simulation cron stopped"
```

---

### Task 2: The cell index

A pure module that turns the taxonomy into a lookup from plan key to cell, shared by the feed, the experiments sweep and the screen. `planKeyFor` moves here from `lab-generator.ts` so one formula writes the keys and reads them back. `lab-generator.ts` imports the `ai` SDK, so the feed cannot import from it without dragging a model client into the queueing path.

**Files:**
- Create: `src/persuade/cell.ts`
- Modify: `src/persuade/lib/lab-generator.ts:18-42` (move the types and `planKeyFor` out, re-export them, drop the local `INDUSTRY_LABELS`)
- Test: `tests/persuade/cell.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface RoleRef { industry: string; roleSlug: string; roleLabel: string; roleOrder: number }`
  - `interface RoleNeed extends RoleRef { needKey: string; needLabel: string; metaNeed: string }`
  - `const planKeyFor: (need: { industry: string; roleSlug: string; needKey: string }) => string`
  - `type CellIndex = ReadonlyMap<string, RoleNeed>`
  - `function cellIndex(needs: readonly RoleNeed[]): CellIndex`
  - `function placeRun(index: CellIndex, planId: string | null | undefined): RoleNeed | null`
  - `function cellKey(cell: RoleNeed): string`
  - `const INDUSTRY_LABELS: Record<string, string>`
  - `function industryLabel(industry: string): string`

- [ ] **Step 1: Write the failing test**

Create `tests/persuade/cell.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  cellIndex,
  cellKey,
  industryLabel,
  placeRun,
  planKeyFor,
  type RoleNeed,
} from '../../src/persuade/cell'

const need = (industry: string, roleSlug: string, needKey: string): RoleNeed => ({
  industry,
  roleSlug,
  roleLabel: 'תפקיד',
  roleOrder: 1,
  needKey,
  needLabel: 'צורך',
  metaNeed: 'control',
})

describe('placing a run on the taxonomy', () => {
  it('finds the cell a generated plan key belongs to', () => {
    const index = cellIndex([need('retail', 'ceo', 'chain-visibility')])

    expect(placeRun(index, 'gen-retail-ceo-chain-visibility')).toMatchObject({
      industry: 'retail',
      roleSlug: 'ceo',
      needKey: 'chain-visibility',
    })
  })

  it('does not split a hyphenated slug by guesswork', () => {
    // Both halves contain hyphens, so any rule that splits the string has to
    // choose between retail/area/manager-food-waste and retail/area-manager/
    // food-waste. A map lookup never has to choose.
    const index = cellIndex([
      need('retail', 'area-manager', 'food-waste'),
      need('retail', 'area', 'manager-food-waste'),
    ])

    expect(placeRun(index, 'gen-retail-area-manager-food-waste')).toMatchObject({
      roleSlug: 'area-manager',
      needKey: 'food-waste',
    })
  })

  it('returns null for the hand-written plan rather than inventing a cell', () => {
    const index = cellIndex([need('retail', 'ceo', 'chain-visibility')])

    // briefings predates the taxonomy and belongs to no cell in it. Every one
    // of the 168 runs on record carries this plan id, so a version of this
    // that invented a cell would misplace the entire table.
    expect(placeRun(index, 'briefings')).toBeNull()
  })

  it('returns null for a missing plan id instead of throwing', () => {
    const index = cellIndex([need('retail', 'ceo', 'chain-visibility')])

    expect(placeRun(index, null)).toBeNull()
    expect(placeRun(index, undefined)).toBeNull()
  })

  it('writes the key the generator writes', () => {
    expect(planKeyFor(need('bank', 'branch-manager', 'service-quality'))).toBe(
      'gen-bank-branch-manager-service-quality',
    )
  })

  it('keys a cell distinctly across all three axes', () => {
    const a = cellKey(need('retail', 'ceo', 'profitability'))
    const b = cellKey(need('bank', 'ceo', 'profitability'))

    expect(a).not.toBe(b)
  })
})

describe('industry labels', () => {
  it('names all five industries in Hebrew', () => {
    // role_needs has role_label and need_label columns; the industry is a bare
    // slug with no label anywhere in the database, so the only Hebrew for it
    // lives here. A missing entry would print "infrastructure" on a screen
    // with no English surface.
    for (const industry of ['retail', 'bank', 'healthcare', 'restaurants', 'infrastructure']) {
      expect(industryLabel(industry)).toMatch(/[֐-׿]/)
    }
  })

  it('passes an unknown industry through rather than losing it', () => {
    expect(industryLabel('mining')).toBe('mining')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
pnpm vitest run tests/persuade/cell.test.ts
```

Expected: FAIL, cannot resolve `../../src/persuade/cell`.

- [ ] **Step 3: Write the module**

Create `src/persuade/cell.ts`:

```ts
/**
 * Where a run belongs in the taxonomy, resolved by exact lookup.
 *
 * The three axes the brief filters on -- industry, role, need -- are encoded in
 * the plan key and nowhere else that can be trusted: `simulations.job_role_id`
 * is null on 164 of 168 rows because the sweep is deliberately tenant-free, and
 * `simulations.need` held the world's reason rather than a need until Task 3.
 *
 * Resolution is a map lookup rather than a parse. Role slugs and need keys both
 * match `^[a-z0-9-]+$`, so `gen-retail-area-manager-food-waste` splits two ways
 * and a parser has to guess. Building the map with the same `planKeyFor` the
 * generator writes keys with removes the guess entirely.
 */

export interface RoleRef {
  industry: string
  roleSlug: string
  roleLabel: string
  roleOrder: number
}

export interface RoleNeed extends RoleRef {
  needKey: string
  needLabel: string
  metaNeed: string
}

export const planKeyFor = (need: {
  industry: string
  roleSlug: string
  needKey: string
}): string => `gen-${need.industry}-${need.roleSlug}-${need.needKey}`

export type CellIndex = ReadonlyMap<string, RoleNeed>

export function cellIndex(needs: readonly RoleNeed[]): CellIndex {
  return new Map(needs.map((need) => [planKeyFor(need), need]))
}

/**
 * Null is a real answer, not a failure. `briefings` is a plan that predates the
 * taxonomy, and every run on record carries it. Callers count these rather than
 * dropping them: a measurement screen that quietly loses runs has been wrong
 * here before.
 */
export function placeRun(index: CellIndex, planId: string | null | undefined): RoleNeed | null {
  if (!planId) return null
  return index.get(planId) ?? null
}

export const cellKey = (cell: RoleNeed): string =>
  `${cell.industry}/${cell.roleSlug}/${cell.needKey}`

/**
 * The only Hebrew an industry has. role_needs carries role_label and
 * need_label, but the industry is a bare slug constrained by a check
 * constraint, so there is nowhere in the database to read this from.
 */
export const INDUSTRY_LABELS: Record<string, string> = {
  retail: 'קמעונאות',
  bank: 'בנקאות',
  healthcare: 'בריאות',
  restaurants: 'מסעדנות',
  infrastructure: 'תשתיות',
}

/** An unlisted key passes through as-is rather than rendering as blank. */
export const industryLabel = (industry: string): string => INDUSTRY_LABELS[industry] ?? industry
```

- [ ] **Step 4: Run the test**

```bash
pnpm vitest run tests/persuade/cell.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Point lab-generator at the shared definitions**

In `src/persuade/lib/lab-generator.ts`, delete the local `RoleRef`, `RoleNeed`, `planKeyFor`, `INDUSTRY_LABELS` and `industryLabel`, and replace them with a re-export so existing importers keep working:

```ts
import { industryLabel, planKeyFor, type RoleNeed, type RoleRef } from '../cell'

export { planKeyFor, type RoleNeed, type RoleRef }
```

Leave `personaKeyFor` and `COMPANY_MANAGEMENT` where they are: they are generator concerns, not cell concerns.

- [ ] **Step 6: Verify nothing else broke**

```bash
pnpm tsc --noEmit && pnpm vitest run tests/persuade
```

Expected: PASS. If `generate-lab-content.ts` or `validate-lab-content.ts` fails to resolve a type, they are importing from `lab-generator`, which now re-exports it. Do not change their import paths.

- [ ] **Step 7: Commit**

```bash
git add src/persuade/cell.ts src/persuade/lib/lab-generator.ts tests/persuade/cell.test.ts
git commit -m "feat: resolve a run's cell by exact plan-key lookup"
```

---

### Task 3: Both queueing paths write the real need

**Files:**
- Modify: `src/persuade/lib/feed.ts:125-150` (`jobsForChunk`), `src/persuade/lib/feed.ts:225-268` (`refillFeed`)
- Modify: `src/persuade/lib/experiments.ts:257-271` (`planSweep`)
- Test: `tests/persuade/feed-plan.test.ts` (extend)

**Interfaces:**
- Consumes: `planKeyFor` and `RoleNeed` from `src/persuade/cell.ts` (Task 2).
- Produces:
  - `jobsForChunk(chunk, pairs, cells, needByPlanKey?: ReadonlyMap<string, string>)` — a fourth optional parameter mapping plan key to need key. Absent means every job gets `need: null`.
  - `SweepSpec` gains `needByPlanKey?: ReadonlyMap<string, string>`.

**Background you need:** `jobsForChunk` currently writes `need: cell.reason`, where `cell` is a `WorldCell` and `reason` is one of `forgot | no_time | no_value | low_confidence | disagrees | did_partially`. That is the world's hidden reason, which already travels on the same row inside `world`, built by `buildWorld(cell)`. Nothing is lost by removing it from `need`.

- [ ] **Step 1: Write the failing test**

Append to `tests/persuade/feed-plan.test.ts`:

```ts
describe('the need a job records', () => {
  const chunkOf = (count: number) => ({
    positions: Array.from({ length: count }, (_, i) => ({ pairIndex: i, worldIndex: 0, pass: 0 })),
    nextIndex: count,
    pass: 0,
  })

  const pairs = [
    { personaKey: 'p1', planKey: 'gen-retail-ceo-profitability', industry: 'retail' },
    { personaKey: 'p2', planKey: 'briefings', industry: 'retail' },
  ]

  it('writes the plan’s need key, not the world’s reason', () => {
    const jobs = jobsForChunk(
      chunkOf(1),
      pairs,
      worldCells(),
      new Map([['gen-retail-ceo-profitability', 'profitability']]),
    )

    expect(jobs[0]?.need).toBe('profitability')
  })

  it('keeps the world’s reason on the job, in the world', () => {
    // The reason is not being dropped, it is being put back where it belongs.
    // A test that only asserted the need would pass equally well if the reason
    // had been lost.
    const jobs = jobsForChunk(
      chunkOf(1),
      pairs,
      worldCells(),
      new Map([['gen-retail-ceo-profitability', 'profitability']]),
    )

    expect(jobs[0]?.world?.reason).toBeTruthy()
    expect(jobs[0]?.need).not.toBe(jobs[0]?.world?.reason)
  })

  it('records no need for a plan outside the taxonomy', () => {
    // briefings belongs to no cell. Null says so; inventing one would put every
    // run of it under a need nobody wrote.
    const jobs = jobsForChunk(chunkOf(2), pairs, worldCells(), new Map())

    expect(jobs.every((job) => job.need === null)).toBe(true)
  })

  it('records no need when no map is supplied at all', () => {
    const jobs = jobsForChunk(chunkOf(1), pairs, worldCells())

    expect(jobs[0]?.need).toBeNull()
  })
})
```

Add `jobsForChunk` to the existing import from `../../src/persuade/lib/feed` if it is not already there, and `worldCells` from `../../src/persuade/engine/world` (already imported at the top of this file).

- [ ] **Step 2: Run it to make sure it fails**

```bash
pnpm vitest run tests/persuade/feed-plan.test.ts
```

Expected: FAIL. The first test reports `need` is `'forgot'` (or another reason) rather than `'profitability'`.

- [ ] **Step 3: Change `jobsForChunk`**

In `src/persuade/lib/feed.ts`, change the signature and the one line:

```ts
export function jobsForChunk(
  chunk: FeedChunk,
  pairs: readonly FeedPair[],
  cells: readonly WorldCell[] = worldCells(),
  /**
   * Plan key to need key, from the taxonomy. Optional because a caller with no
   * taxonomy in hand should record no need rather than a wrong one: `need` held
   * the world's reason until 2026-09-22 and the column is not going back to
   * carrying two vocabularies.
   */
  needByPlanKey: ReadonlyMap<string, string> = new Map(),
): QueuedJob[] {
  return chunk.positions.map((position) => {
    const pair = pairs[position.pairIndex] as FeedPair
    const cell = cells[position.worldIndex] as WorldCell
    return {
      experiment: null,
      variant: null,
      persona_key: pair.personaKey,
      plan_key: pair.planKey,
      industry: pair.industry,
      segment: null,
      job_role_id: null,
      // The reason this job runs under travels in `world`, where buildWorld
      // puts it. This column is the taxonomy's need and nothing else.
      need: needByPlanKey.get(pair.planKey) ?? null,
      rules: DEFAULT_RULES,
      world: buildWorld(cell),
      pass: position.pass,
    }
  })
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm vitest run tests/persuade/feed-plan.test.ts
```

Expected: PASS.

- [ ] **Step 5: Give `refillFeed` the map**

In `src/persuade/lib/feed.ts`, add a reader and pass its result through. Put the reader beside `readInputs`:

```ts
/**
 * The taxonomy, as the one mapping from plan key to need key.
 *
 * Read here rather than derived from the plan key by string surgery: role slugs
 * and need keys both contain hyphens, so the split is ambiguous. See cell.ts.
 */
async function readNeedsByPlanKey(client: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await client
    .from('role_needs')
    .select('industry,role_slug,need_key')
  if (error) throw new Error(`קריאת role_needs נכשלה: ${error.message}`)

  return new Map(
    ((data ?? []) as Record<string, unknown>[]).map((row) => [
      planKeyFor({
        industry: String(row.industry),
        roleSlug: String(row.role_slug),
        needKey: String(row.need_key),
      }),
      String(row.need_key),
    ]),
  )
}
```

Import `planKeyFor` at the top: `import { planKeyFor } from '../cell'`.

Then in `refillFeed`, read it alongside the inputs and pass it in:

```ts
  const [personas, plans, needByPlanKey] = await Promise.all([
    readInputs(client, 'persuasion_personas', 'persona_key'),
    readInputs(client, 'persuasion_lab_plans', 'plan_key'),
    readNeedsByPlanKey(client),
  ])
```

```ts
  const jobs = jobsForChunk(chunk, pairs, cells, needByPlanKey)
```

- [ ] **Step 6: Fix the same line in the experiments sweep**

In `src/persuade/lib/experiments.ts`, add to `SweepSpec`:

```ts
  /** Plan key to need key. Absent means the jobs record no need. */
  needByPlanKey?: ReadonlyMap<string, string>
```

and in `planSweep`, replace `need: cell.reason,` with:

```ts
          // Same fix as feed.ts: the reason lives in `world`, and this column
          // is the taxonomy's need. One path fixed and not the other would
          // leave the column holding two meanings, which is the bug.
          need: spec.needByPlanKey?.get(planKey) ?? null,
```

- [ ] **Step 7: Verify the whole suite**

```bash
pnpm ci
```

Expected: PASS. `tests/persuade/feed-refill.test.ts` may stub the client; if it fails because `role_needs` is unexpected, add `role_needs` to its fake returning `{ data: [], error: null }` and assert that the resulting jobs carry `need: null`.

- [ ] **Step 8: Commit**

```bash
git add src/persuade/lib/feed.ts src/persuade/lib/experiments.ts tests/persuade/feed-plan.test.ts tests/persuade/feed-refill.test.ts
git commit -m "fix: the need column records a need, not the world's reason"
```

---

### Task 4: Read runs without their conversations, and count without reading them

**Files:**
- Modify: `src/persuade/lib/simulations.ts:22-30` (column list), `:106-140` (add the new readers)
- Modify: `src/persuade/simulations-api.ts`
- Test: `tests/persuade/simulations-store.test.ts` (extend)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, on the store returned by `createSimulationsStore` and on the api returned by `createSimulationsApi`:
  - `listSimulationSummaries(pageSize?: number): Promise<StoredSimulation[]>` — every row, no `turns`.
  - `countSimulations(): Promise<number>`
  - `countSimulationsSince(iso: string): Promise<number>`
  - `countAttemptsSince(iso: string): Promise<number>` — rows in `simulation_jobs` with `claimed_at >= iso`.

**Background you need:** `listSimulations` pages every row with every column, `turns` included. `turns` is a whole conversation as jsonb. At the 1,000 a day the cap allows, one month is 30,000 conversations, and the screen only needs `state.outcome`, `state.blockers` and `score`. `toStored` derives `violations` from turns, so a summary row yields `violations: []`; nothing on this screen reads violations.

`countAttemptsSince` reads `simulation_jobs` because that is what the daily cap counts (`attemptsToday` in `worker.ts` counts jobs claimed since UTC midnight, any status). Runs added and attempts made are different numbers whenever jobs fail, and 249 of 413 have.

- [ ] **Step 1: Write the failing test**

Append to `tests/persuade/simulations-store.test.ts`:

```ts
describe('reading without the conversations', () => {
  it('does not ask for turns', () => {
    const { store, selectedColumns } = fake([])
    void store.listSimulationSummaries()

    // turns is the heaviest column by far and nothing on the lab screen reads
    // it. Selecting it anyway is the difference between a few megabytes and a
    // few hundred once the loop is running at its cap.
    expect(selectedColumns()).not.toContain('turns')
    expect(selectedColumns()).toContain('score')
    expect(selectedColumns()).toContain('state')
  })

  it('still produces a usable run for the bank and the rate', async () => {
    const { store } = fake([
      {
        id: 'sim-1',
        industry: 'retail',
        job_role_id: null,
        need: 'profitability',
        persona_id: 'rona',
        plan: { id: 'gen-retail-ceo-profitability' },
        state: { outcome: 'agreed', blockers: ['overloaded'], interaction: 3 },
        score: { winningCategory: 'numbers', winningArgument: 'המספרים', persuaded: 'yes' },
        created_at: '2026-09-22T10:00:00Z',
      },
    ])

    const rows = await store.listSimulationSummaries()

    expect(rows[0]?.run.state.outcome).toBe('agreed')
    expect(rows[0]?.run.score?.winningCategory).toBe('numbers')
    // A row read without turns has no violations to derive, and says so as an
    // empty list rather than as undefined.
    expect(rows[0]?.run.turns).toEqual([])
    expect(rows[0]?.run.violations).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
pnpm vitest run tests/persuade/simulations-store.test.ts
```

Expected: FAIL, `store.listSimulationSummaries is not a function`.

- [ ] **Step 3: Add the readers**

In `src/persuade/lib/simulations.ts`, beside the existing `SIMULATION_COLUMNS`:

```ts
/**
 * Every column the screen needs and not one more.
 *
 * `turns` is the whole conversation. The lab screen reads state.outcome for the
 * rate, state.blockers for the blocker list and score for the bank, and never
 * the turns themselves -- so paging them in is hundreds of megabytes spent to
 * compute a percentage once the loop runs at its cap.
 */
const SUMMARY_COLUMNS = 'id,industry,job_role_id,need,persona_id,plan,state,outcome,score,created_at'
```

Inside `createSimulationsStore`, add:

```ts
    /**
     * The same rows as listSimulations, without the conversations. Paged the
     * same way and for the same reason: a `.limit(n)` here is a silent ceiling
     * that shows cells as unrun.
     */
    async listSimulationSummaries(pageSize = 1000): Promise<StoredSimulation[]> {
      const rows: SimulationRow[] = []
      for (let from = 0; ; ) {
        const { data, error } = await client
          .from('simulations')
          .select(SUMMARY_COLUMNS)
          .order('created_at', { ascending: false })
          .range(from, from + pageSize - 1)

        if (error) throw new Error(`קריאת הסימולציות נכשלה: ${error.message}`)
        const page = (data ?? []) as SimulationRow[]
        if (page.length === 0) break
        rows.push(...page)
        from += page.length
      }
      // toStored reads row.turns, which a summary row does not have. It already
      // falls back to [], so violations comes back empty rather than undefined.
      return rows.map(toStored)
    },

    async countSimulations(): Promise<number> {
      const { count, error } = await client
        .from('simulations')
        .select('id', { count: 'exact', head: true })
      if (error) throw new Error(`ספירת הסימולציות נכשלה: ${error.message}`)
      return count ?? 0
    },

    async countSimulationsSince(iso: string): Promise<number> {
      const { count, error } = await client
        .from('simulations')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', iso)
      if (error) throw new Error(`ספירת הסימולציות של היום נכשלה: ${error.message}`)
      return count ?? 0
    },

    /**
     * What the daily cap actually bounds. worker.ts counts jobs claimed since
     * UTC midnight, any status, because a failed job has already spent its
     * model calls. Showing runs-added against that cap would understate the
     * spend every time a job fails, and 249 of 413 have.
     */
    async countAttemptsSince(iso: string): Promise<number> {
      const { count, error } = await client
        .from('simulation_jobs')
        .select('id', { count: 'exact', head: true })
        .gte('claimed_at', iso)
      if (error) throw new Error(`ספירת הניסיונות של היום נכשלה: ${error.message}`)
      return count ?? 0
    },
```

- [ ] **Step 4: Extend the fake client so the counts are testable**

The existing `fake()` in the test returns a query object whose `select` records columns and whose `then` resolves `{ data: rows, error: null }`. A head count resolves through `then` too, so add `count` to that resolution:

```ts
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: rows, error: null, count: rows.length }),
        gte: () => q,
```

- [ ] **Step 5: Run the test**

```bash
pnpm vitest run tests/persuade/simulations-store.test.ts
```

Expected: PASS.

- [ ] **Step 6: Expose the readers to the browser**

In `src/persuade/simulations-api.ts`:

```ts
export function createSimulationsApi(client: Parameters<typeof createSimulationsStore>[0]) {
  const store = createSimulationsStore(client)
  return {
    listSimulations: (): Promise<StoredSimulation[]> => store.listSimulations(),
    listSimulationSummaries: (): Promise<StoredSimulation[]> => store.listSimulationSummaries(),
    countSimulations: (): Promise<number> => store.countSimulations(),
    countSimulationsSince: (iso: string): Promise<number> => store.countSimulationsSince(iso),
    countAttemptsSince: (iso: string): Promise<number> => store.countAttemptsSince(iso),
  }
}
```

- [ ] **Step 7: Verify**

```bash
pnpm ci
```

- [ ] **Step 8: Commit**

```bash
git add src/persuade/lib/simulations.ts src/persuade/simulations-api.ts tests/persuade/simulations-store.test.ts
git commit -m "feat: read run summaries and counts without paging every conversation"
```

---

### Task 5: The taxonomy, as a tree

**Files:**
- Create: `src/persuade/taxonomy.ts` (pure tree building)
- Create: `src/persuade/taxonomy-api.ts` (the read)
- Test: `tests/persuade/taxonomy.test.ts`

**Interfaces:**
- Consumes: `RoleNeed`, `industryLabel` from `src/persuade/cell.ts` (Task 2).
- Produces:
  - `interface NeedRow extends RoleNeed { needOrder: number }`
  - `interface TaxonomyNeed { needKey: string; needLabel: string; metaNeed: string }`
  - `interface TaxonomyRole { roleSlug: string; roleLabel: string; needs: TaxonomyNeed[] }`
  - `interface TaxonomyIndustry { industry: string; label: string; roles: TaxonomyRole[] }`
  - `function taxonomyFrom(rows: readonly NeedRow[]): TaxonomyIndustry[]`
  - `function createTaxonomyApi(client): { listRoleNeeds(): Promise<NeedRow[]> }`

- [ ] **Step 1: Write the failing test**

Create `tests/persuade/taxonomy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { type NeedRow, taxonomyFrom } from '../../src/persuade/taxonomy'

const row = (
  industry: string,
  roleSlug: string,
  roleOrder: number,
  needKey: string,
  needOrder: number,
): NeedRow => ({
  industry,
  roleSlug,
  roleLabel: `תפקיד ${roleSlug}`,
  roleOrder,
  needKey,
  needLabel: `צורך ${needKey}`,
  needOrder,
  metaNeed: 'control',
})

describe('building the taxonomy tree', () => {
  it('nests needs under roles under industries', () => {
    const tree = taxonomyFrom([
      row('retail', 'ceo', 1, 'profitability', 1),
      row('retail', 'ceo', 1, 'chain-visibility', 2),
      row('retail', 'store-manager', 2, 'daily-targets', 1),
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0]?.roles).toHaveLength(2)
    expect(tree[0]?.roles[0]?.needs.map((n) => n.needKey)).toEqual([
      'profitability',
      'chain-visibility',
    ])
  })

  it('orders roles by role_order and needs by need_order, not alphabetically', () => {
    // The order is the org chart and the priority list. Sorting these by label
    // would put the stockroom above the CEO and make the screen unreadable as
    // a hierarchy.
    const tree = taxonomyFrom([
      row('retail', 'zeta-role', 1, 'zeta-need', 1),
      row('retail', 'alpha-role', 2, 'alpha-need', 2),
      row('retail', 'zeta-role', 1, 'alpha-need', 2),
    ])

    expect(tree[0]?.roles.map((r) => r.roleSlug)).toEqual(['zeta-role', 'alpha-role'])
    expect(tree[0]?.roles[0]?.needs.map((n) => n.needKey)).toEqual(['zeta-need', 'alpha-need'])
  })

  it('carries every industry, including ones nobody has run', () => {
    // The whole point of reading structure from role_needs rather than from the
    // runs: an industry with no runs is a hole, and a hole is the most useful
    // thing this screen can show.
    const tree = taxonomyFrom([
      row('retail', 'ceo', 1, 'profitability', 1),
      row('infrastructure', 'ceo', 1, 'uptime', 1),
    ])

    expect(tree.map((t) => t.industry).sort()).toEqual(['infrastructure', 'retail'])
  })

  it('labels each industry in Hebrew', () => {
    const tree = taxonomyFrom([row('infrastructure', 'ceo', 1, 'uptime', 1)])

    expect(tree[0]?.label).toMatch(/[֐-׿]/)
  })

  it('returns an empty tree for no rows rather than throwing', () => {
    expect(taxonomyFrom([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
pnpm vitest run tests/persuade/taxonomy.test.ts
```

Expected: FAIL, cannot resolve `../../src/persuade/taxonomy`.

- [ ] **Step 3: Write the tree builder**

Create `src/persuade/taxonomy.ts`:

```ts
import { industryLabel, type RoleNeed } from './cell'

/**
 * The structure the screen is drawn from: industry, role, need.
 *
 * Read from role_needs rather than from the runs, which is the one decision
 * this whole screen turns on. matrixFrom derived its industries from the
 * simulations, so a sector nobody had run did not exist on screen. That answers
 * "what have we measured"; this screen answers "where has the sweep been", and
 * for that question the hole is the finding.
 */

export interface NeedRow extends RoleNeed {
  needOrder: number
}

export interface TaxonomyNeed {
  needKey: string
  needLabel: string
  metaNeed: string
}

export interface TaxonomyRole {
  roleSlug: string
  roleLabel: string
  needs: TaxonomyNeed[]
}

export interface TaxonomyIndustry {
  industry: string
  label: string
  roles: TaxonomyRole[]
}

/**
 * Ordered by role_order and need_order, never by label. The order is the org
 * chart and the priority list, both of which the labels would scramble.
 */
export function taxonomyFrom(rows: readonly NeedRow[]): TaxonomyIndustry[] {
  const industries = new Map<string, Map<string, { role: NeedRow; needs: NeedRow[] }>>()

  for (const row of rows) {
    const roles = industries.get(row.industry) ?? new Map()
    industries.set(row.industry, roles)
    const entry = roles.get(row.roleSlug) ?? { role: row, needs: [] }
    entry.needs.push(row)
    roles.set(row.roleSlug, entry)
  }

  return [...industries.entries()]
    .map(([industry, roles]) => ({
      industry,
      label: industryLabel(industry),
      roles: [...roles.values()]
        .sort((a, b) => a.role.roleOrder - b.role.roleOrder)
        .map(({ role, needs }) => ({
          roleSlug: role.roleSlug,
          roleLabel: role.roleLabel,
          needs: [...needs]
            .sort((a, b) => a.needOrder - b.needOrder)
            .map((need) => ({
              needKey: need.needKey,
              needLabel: need.needLabel,
              metaNeed: need.metaNeed,
            })),
        })),
    }))
    .sort((a, b) => a.industry.localeCompare(b.industry))
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm vitest run tests/persuade/taxonomy.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Write the read**

Create `src/persuade/taxonomy-api.ts`:

```ts
import type { NeedRow } from './taxonomy'

/**
 * role_needs, read from the browser.
 *
 * Safe from here and tenant-free by construction: role_needs is industry-scoped
 * and grants select to authenticated with a policy of `using (true)`. What a
 * branch manager needs is a fact about the job, not about one business, which
 * is the same reason the simulations table is readable across tenants.
 */
interface TaxonomyClient {
  from(table: string): {
    select(columns: string): PromiseLike<{
      data: Record<string, unknown>[] | null
      error: { message: string } | null
    }>
  }
}

const NEED_COLUMNS = 'industry,role_slug,role_label,role_order,need_key,need_label,need_order,meta_need'

export function createTaxonomyApi(client: TaxonomyClient) {
  return {
    async listRoleNeeds(): Promise<NeedRow[]> {
      const { data, error } = await client.from('role_needs').select(NEED_COLUMNS)
      if (error) throw new Error(`קריאת מפת הצרכים נכשלה: ${error.message}`)

      return (data ?? []).map((row) => ({
        industry: String(row.industry),
        roleSlug: String(row.role_slug),
        roleLabel: String(row.role_label),
        roleOrder: Number(row.role_order),
        needKey: String(row.need_key),
        needLabel: String(row.need_label),
        needOrder: Number(row.need_order),
        metaNeed: String(row.meta_need),
      }))
    },
  }
}

export type TaxonomyApi = ReturnType<typeof createTaxonomyApi>
```

- [ ] **Step 6: Verify**

```bash
pnpm ci
```

- [ ] **Step 7: Commit**

```bash
git add src/persuade/taxonomy.ts src/persuade/taxonomy-api.ts tests/persuade/taxonomy.test.ts
git commit -m "feat: read the industry, role and need taxonomy as a tree"
```

---

### Task 6: The grid, drawn on the spine

Replaces `matrix-data.ts`. The rows become every industry in the taxonomy and the columns every role in it, rather than whatever the runs happened to contain. Runs join on by their cell, and anything that places nowhere is counted in the open rather than dropped.

**Files:**
- Create: `src/persuade/coverage.ts`
- Delete: `src/persuade/matrix-data.ts`
- Delete: `tests/persuade/matrix-from-runs.test.ts`
- Modify: `src/persuade/Matrix.tsx` (MatrixCell carries `roleSlug`, not `jobRoleId`)
- Modify: `tests/persuade/matrix.test.tsx` (the prop rename)
- Modify: `app/[brandId]/tools/persuade/lab/lab-client.tsx` (minimal rewire, so the tree still compiles)
- Modify: `tests/persuade/lab.test.tsx` (add the taxonomy mock the rewire needs)
- Test: `tests/persuade/coverage.test.ts`

**Interfaces:**
- Consumes: `CellIndex`, `placeRun`, `cellKey`, `RoleNeed` from `src/persuade/cell.ts` (Task 2); `TaxonomyIndustry` from `src/persuade/taxonomy.ts` (Task 5); `StoredSimulation` from `src/persuade/lib/simulations.ts`.
- Produces:
  - `interface Placed { runsByCell: ReadonlyMap<string, Run[]>; unplaced: number; total: number }`
  - `function placeAll(index: CellIndex, sims: readonly StoredSimulation[]): Placed`
  - `function coverageOf(runs: readonly Run[]): { runs: number; persuasionRate: number | null }`
  - `function runsForRole(placed: Placed, industry: string, roleSlug: string, needs: readonly { needKey: string }[]): Run[]`
  - `function gridFrom(taxonomy: readonly TaxonomyIndustry[], placed: Placed): MatrixCell[]`
- `MatrixCell` becomes `{ industry: string; industryLabel: string; roleSlug: string; roleLabel: string; runs: number; persuasionRate: number | null }`.

**Background you need:** `matrixFrom` gave runs with no role their own column, because `job_role_id` is null on the sweep. That column is now unnecessary and misleading: a run places by its plan key, which every swept run has. What replaces it is the `unplaced` count, which is honest about a different thing (a run whose plan is outside the taxonomy, such as all 168 `briefings` runs).

- [ ] **Step 1: Write the failing test**

Create `tests/persuade/coverage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cellIndex, type RoleNeed } from '../../src/persuade/cell'
import { coverageOf, gridFrom, placeAll, runsForRole } from '../../src/persuade/coverage'
import type { StoredSimulation } from '../../src/persuade/lib/simulations'
import { taxonomyFrom } from '../../src/persuade/taxonomy'

const need = (industry: string, roleSlug: string, needKey: string): RoleNeed => ({
  industry,
  roleSlug,
  roleLabel: `תפקיד ${roleSlug}`,
  roleOrder: 1,
  needKey,
  needLabel: `צורך ${needKey}`,
  metaNeed: 'control',
})

const needs = [
  need('retail', 'ceo', 'profitability'),
  need('retail', 'ceo', 'chain-visibility'),
  need('bank', 'teller', 'service-quality'),
]

const taxonomy = taxonomyFrom(needs.map((n, i) => ({ ...n, needOrder: i + 1 })))
const index = cellIndex(needs)

const sim = (planId: string, outcome: string): StoredSimulation =>
  ({
    id: `s-${planId}-${outcome}-${Math.random()}`,
    cell: { industry: 'ignored', jobRoleId: null },
    run: { plan: { id: planId }, state: { outcome, blockers: [] } },
  }) as never

describe('placing runs on the taxonomy', () => {
  it('groups runs by their cell', () => {
    const placed = placeAll(index, [
      sim('gen-retail-ceo-profitability', 'agreed'),
      sim('gen-retail-ceo-profitability', 'refused'),
    ])

    expect(placed.runsByCell.get('retail/ceo/profitability')).toHaveLength(2)
  })

  it('counts a run outside the taxonomy instead of dropping it', () => {
    // Every one of the 168 runs on record carries the briefings plan, which
    // belongs to no cell. Dropping them would make the screen claim the table
    // is empty while showing a total of 168 elsewhere.
    const placed = placeAll(index, [sim('briefings', 'agreed'), sim('briefings', 'refused')])

    expect(placed.unplaced).toBe(2)
    expect(placed.runsByCell.size).toBe(0)
  })

  it('never loses a run: placed plus unplaced is the total', () => {
    const sims = [
      sim('gen-retail-ceo-profitability', 'agreed'),
      sim('briefings', 'agreed'),
      sim('gen-bank-teller-service-quality', 'refused'),
    ]
    const placed = placeAll(index, sims)

    const inCells = [...placed.runsByCell.values()].reduce((n, runs) => n + runs.length, 0)
    expect(inCells + placed.unplaced).toBe(sims.length)
    expect(placed.total).toBe(sims.length)
  })
})

describe('coverage of a set of runs', () => {
  it('is the share that agreed', () => {
    const placed = placeAll(index, [
      sim('gen-retail-ceo-profitability', 'agreed'),
      sim('gen-retail-ceo-profitability', 'agreed'),
      sim('gen-retail-ceo-profitability', 'refused'),
      sim('gen-retail-ceo-profitability', 'refused'),
    ])

    expect(coverageOf(placed.runsByCell.get('retail/ceo/profitability') ?? [])).toEqual({
      runs: 4,
      persuasionRate: 50,
    })
  })

  it('is null, never zero, when nothing has been run', () => {
    expect(coverageOf([])).toEqual({ runs: 0, persuasionRate: null })
  })
})

describe('the grid', () => {
  it('carries every industry and role in the taxonomy, run or not', () => {
    const grid = gridFrom(taxonomy, placeAll(index, []))

    // Two industries, one role each. None of them has a single run, and all of
    // them are on screen: the hole is the finding.
    expect(grid).toHaveLength(2)
    expect(grid.every((cell) => cell.runs === 0 && cell.persuasionRate === null)).toBe(true)
  })

  it('sums a role’s needs into its cell', () => {
    const grid = gridFrom(
      taxonomy,
      placeAll(index, [
        sim('gen-retail-ceo-profitability', 'agreed'),
        sim('gen-retail-ceo-chain-visibility', 'refused'),
      ]),
    )

    const retail = grid.find((c) => c.industry === 'retail' && c.roleSlug === 'ceo')
    expect(retail).toMatchObject({ runs: 2, persuasionRate: 50 })
  })

  it('labels the industry and the role in Hebrew', () => {
    const grid = gridFrom(taxonomy, placeAll(index, []))

    expect(grid[0]?.industryLabel).toMatch(/[֐-׿]/)
    expect(grid[0]?.roleLabel).toMatch(/[֐-׿]/)
  })
})

describe('the runs behind one role', () => {
  it('gathers every need of that role', () => {
    const placed = placeAll(index, [
      sim('gen-retail-ceo-profitability', 'agreed'),
      sim('gen-retail-ceo-chain-visibility', 'agreed'),
      sim('gen-bank-teller-service-quality', 'agreed'),
    ])

    const runs = runsForRole(placed, 'retail', 'ceo', [
      { needKey: 'profitability' },
      { needKey: 'chain-visibility' },
    ])

    expect(runs).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
pnpm vitest run tests/persuade/coverage.test.ts
```

Expected: FAIL, cannot resolve `../../src/persuade/coverage`.

- [ ] **Step 3: Write the module**

Create `src/persuade/coverage.ts`:

```ts
import { type CellIndex, cellKey, placeRun } from './cell'
import type { Run } from './engine/types'
import type { StoredSimulation } from './lib/simulations'
import type { MatrixCell } from './Matrix'
import type { TaxonomyIndustry } from './taxonomy'

/**
 * Runs, grouped onto the taxonomy.
 *
 * `unplaced` is load-bearing rather than diagnostic. Every run on record as of
 * 2026-09-22 carries the `briefings` plan, which predates the taxonomy and
 * belongs to no cell -- so a version of this that silently dropped what it
 * could not place would render an empty grid beside a total of 168 and give no
 * hint which of the two numbers to believe.
 */
export interface Placed {
  runsByCell: ReadonlyMap<string, Run[]>
  unplaced: number
  total: number
}

export function placeAll(index: CellIndex, sims: readonly StoredSimulation[]): Placed {
  const runsByCell = new Map<string, Run[]>()
  let unplaced = 0

  for (const sim of sims) {
    const cell = placeRun(index, sim.run.plan?.id)
    if (!cell) {
      unplaced += 1
      continue
    }
    const key = cellKey(cell)
    const existing = runsByCell.get(key)
    if (existing) existing.push(sim.run)
    else runsByCell.set(key, [sim.run])
  }

  return { runsByCell, unplaced, total: sims.length }
}

/**
 * Null, never 0, when nothing has been run. "Nobody has tried this cell" and
 * "everybody refused here" are opposite facts; the second is a finding and the
 * first is an absence, and the heat scale renders them differently.
 */
export function coverageOf(runs: readonly Run[]): { runs: number; persuasionRate: number | null } {
  if (runs.length === 0) return { runs: 0, persuasionRate: null }
  const agreed = runs.filter((run) => run.state.outcome === 'agreed').length
  return { runs: runs.length, persuasionRate: Math.round((agreed / runs.length) * 100) }
}

export function runsForRole(
  placed: Placed,
  industry: string,
  roleSlug: string,
  needs: readonly { needKey: string }[],
): Run[] {
  return needs.flatMap(
    (need) => placed.runsByCell.get(`${industry}/${roleSlug}/${need.needKey}`) ?? [],
  )
}

/**
 * Every industry and every role in the taxonomy, whether or not a run exists.
 *
 * This is the reversal the whole screen turns on. matrixFrom built its rows
 * from the runs, which answers "what have we measured"; this builds them from
 * the catalogue, which answers "where has the sweep been". For an instrument,
 * the second question is the one worth a screen.
 */
export function gridFrom(
  taxonomy: readonly TaxonomyIndustry[],
  placed: Placed,
): MatrixCell[] {
  return taxonomy.flatMap((industry) =>
    industry.roles.map((role) => ({
      industry: industry.industry,
      industryLabel: industry.label,
      roleSlug: role.roleSlug,
      roleLabel: role.roleLabel,
      ...coverageOf(runsForRole(placed, industry.industry, role.roleSlug, role.needs)),
    })),
  )
}
```

- [ ] **Step 4: Change MatrixCell and the Matrix component**

Replace `src/persuade/Matrix.tsx` entirely. Only the vocabulary changes; the heat scale, the accessibility behaviour and the keyboard handling are untouched.

```tsx
'use client'

export type MatrixCell = {
  industry: string
  /** Hebrew. The industry is a bare slug in the database with no label column. */
  industryLabel: string
  /**
   * From role_needs, not from public.roles. The per-tenant catalogue was the
   * wrong vocabulary for a sweep that is deliberately tenant-free, which is how
   * 164 of 168 runs ended up in a column labelled "no role".
   */
  roleSlug: string
  roleLabel: string
  runs: number
  /**
   * Null when nothing has been run here. Never 0: "nobody has tried this cell"
   * and "everybody refused here" are opposite facts, and the second is a
   * finding while the first is an absence.
   */
  persuasionRate: number | null
}

/**
 * Five steps, one hue, light to dark. Persuasion rate is a magnitude, so the
 * scale is sequential -- never diverging, which would imply a meaningful
 * midpoint, and never a rainbow, which implies an order the hues do not have.
 *
 * The step boundaries are even fifths. The label colour per step is computed
 * against the fill rather than chosen: steps 1-3 carry --text, 4-5 carry white,
 * and the obvious step 4 (the brand's own #B76578) had to be darkened to
 * #A35468 because it reaches only 4.08:1 against white and fails at body size.
 */
function heatStep(rate: number): 1 | 2 | 3 | 4 | 5 {
  if (rate < 20) return 1
  if (rate < 40) return 2
  if (rate < 60) return 3
  if (rate < 80) return 4
  return 5
}

const cellKey = (cell: MatrixCell) => `${cell.industry}::${cell.roleSlug}`

export function Matrix({
  cells,
  selected,
  onSelect,
}: {
  cells: readonly MatrixCell[]
  selected: MatrixCell | null
  onSelect: (cell: MatrixCell) => void
}) {
  const industries = [...new Map(cells.map((c) => [c.industry, c.industryLabel])).entries()]
  const roles = [...new Map(cells.map((c) => [c.roleSlug, c.roleLabel])).entries()]
  const byKey = new Map(cells.map((c) => [cellKey(c), c]))

  return (
    <div className="matrix-scroll">
      <table aria-label="שיעור שכנוע לפי ענף ותפקיד" className="matrix" role="grid">
        <thead>
          <tr>
            <th />
            {roles.map(([slug, label]) => (
              <th key={slug} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {industries.map(([industry, label]) => (
            <tr key={industry}>
              <th scope="row">{label}</th>
              {roles.map(([slug]) => {
                const cell = byKey.get(`${industry}::${slug}`)
                if (!cell) return <td className="cell" data-heat="none" key={slug} />

                const measured = cell.persuasionRate !== null
                return (
                  <td
                    // The row and column headers are out of reach for a screen
                    // reader moving cell to cell, so the cell says where it is.
                    aria-label={
                      measured
                        ? `${cell.industryLabel}, ${cell.roleLabel}, ${cell.persuasionRate} אחוז, ${cell.runs} ריצות`
                        : `${cell.industryLabel}, ${cell.roleLabel}, אין ריצות`
                    }
                    aria-selected={selected ? cellKey(selected) === cellKey(cell) : undefined}
                    className="cell"
                    data-heat={measured ? heatStep(cell.persuasionRate as number) : 'none'}
                    key={slug}
                    onClick={() => onSelect(cell)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') onSelect(cell)
                    }}
                    role="gridcell"
                    tabIndex={0}
                  >
                    <b>{measured ? `${cell.persuasionRate}%` : '—'}</b>
                    <span>{measured ? `${cell.runs} ריצות` : 'אין ריצות'}</span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 5: Update the component test to the new props**

In `tests/persuade/matrix.test.tsx`, rename every `jobRoleId` to `roleSlug` and `jobRoleName` to `roleLabel`, and add `industryLabel` to each fixture cell. Do not change what the tests assert.

- [ ] **Step 6: Delete what the grid replaces**

```bash
git rm src/persuade/matrix-data.ts tests/persuade/matrix-from-runs.test.ts
```

The behaviour those tests protected is not lost. "An unrun cell has a null rate" is now the second test in `coverage.test.ts`; "no run vanishes" is the third. The "runs that carry no role get their own column" behaviour is deliberately gone, replaced by `unplaced`: a run places by its plan key now, and `job_role_id` is no longer consulted at all.

- [ ] **Step 7: Keep the tree compiling**

Deleting `matrix-data.ts` breaks `lab-client.tsx`, which imports `matrixFrom`. Task 9 rewrites that file completely, but the branch must typecheck at the end of every task, so rewire it minimally now.

In `app/[brandId]/tools/persuade/lab/lab-client.tsx`:

- Replace the `matrixFrom` import with:

```ts
import { cellIndex } from '../../../../../src/persuade/cell'
import { coverageOf, gridFrom, placeAll } from '../../../../../src/persuade/coverage'
import { type NeedRow, taxonomyFrom } from '../../../../../src/persuade/taxonomy'
import { createTaxonomyApi } from '../../../../../src/persuade/taxonomy-api'
```

- Add the taxonomy api beside the others and a `needRows` state:

```ts
  const taxonomyApi = useMemo(() => createTaxonomyApi(createBrowserSupabase() as never), [])
  const [needRows, setNeedRows] = useState<NeedRow[]>([])
```

- In `load`, read it alongside the rest and set it:

```ts
      const [runs, needs, catalogue] = await Promise.all([
        simulationsApi.listSimulations(),
        taxonomyApi.listRoleNeeds(),
        rolesApi.listRoles(),
      ])
      setSimulations(runs)
      setNeedRows(needs)
      setRoles(catalogue)
```

  Add `taxonomyApi` to `load`'s dependency array.

- Replace the `cells` memo:

```ts
  const taxonomy = useMemo(() => taxonomyFrom(needRows), [needRows])
  const index = useMemo(() => cellIndex(needRows), [needRows])
  const placed = useMemo(() => placeAll(index, simulations), [index, simulations])
  const cells = useMemo(() => gridFrom(taxonomy, placed), [taxonomy, placed])
```

- Replace the `inCell` memo, which filtered on `jobRoleId`, with a lookup through the placement:

```ts
  const inCell = useMemo(
    () =>
      selected
        ? runsForRole(
            placed,
            selected.industry,
            selected.roleSlug,
            taxonomy
              .find((entry) => entry.industry === selected.industry)
              ?.roles.find((entry) => entry.roleSlug === selected.roleSlug)?.needs ?? [],
          )
        : [],
    [placed, selected, taxonomy],
  )
```

  Add `runsForRole` to the `coverage` import, and change `buildBank(inCell.map((s) => s.run))` and `blockersIn(inCell.map((s) => s.run))` to `buildBank(inCell)` and `blockersIn(inCell)`, since `runsForRole` already returns `Run[]`.

- In the selected-cell section, replace `selected.jobRoleName` with `selected.roleLabel` and `selected.industry` with `selected.industryLabel` in both the `aria-label` and the heading. Replace the `coverageOf` values there too: the `selected.runs` / `selected.persuasionRate` fields still exist on `MatrixCell`, so that line needs no change.

Keep `listSimulations` here. Task 9 switches it to `listSimulationSummaries` as part of its rewrite; switching it now would mean editing `lab.test.tsx` twice.

- [ ] **Step 8: Add the taxonomy mock to the existing screen test**

`tests/persuade/lab.test.tsx` renders `LabClient`, which now reads `role_needs`. Add beside its existing mocks:

```tsx
const taxonomy = vi.hoisted(() => ({ listRoleNeeds: vi.fn() }))
vi.mock('../../src/persuade/taxonomy-api', async (o) => ({
  ...(await o<Record<string, unknown>>()),
  createTaxonomyApi: () => taxonomy,
}))
```

and in `beforeEach`:

```tsx
  taxonomy.listRoleNeeds.mockResolvedValue([])
```

An empty taxonomy is the right default for those two tests: neither is about the grid, and both already assert against an empty matrix.

- [ ] **Step 9: Run everything**

```bash
pnpm ci
```

Expected: PASS. Biome, `tsc --noEmit` and the full vitest suite. The branch typechecks at the end of every task; if it does not, this step is not finished.

- [ ] **Step 10: Commit**

```bash
git add -A src/persuade tests/persuade app
git commit -m "feat: draw the grid from the taxonomy instead of from the runs"
```

---

### Task 7: What was handed over, and what won

The fourth level. The plan's arguments as the persuader received them, each annotated with how often that argument's category actually carried an agreement, plus the categories that won without ever being written down.

**Files:**
- Create: `src/persuade/persuasions.ts`
- Create: `src/persuade/lab-plans-api.ts`
- Test: `tests/persuade/persuasions.test.ts`

**Interfaces:**
- Consumes: `buildBank` from `src/persuade/bank.ts`; `CATEGORY_LABELS` from `src/persuade/labels.ts`; `PersuasionPlan`, `Argument`, `Run` from `src/persuade/engine/types.ts`.
- Produces:
  - `interface AnnotatedArgument { id: string; category: ArgumentCategory; categoryLabel: string; text: string; strength: number; categoryWins: number; winningSentences: string[] }`
  - `interface Persuasions { arguments: AnnotatedArgument[]; unwrittenWins: { category: ArgumentCategory; categoryLabel: string; wonCount: number; examples: string[] }[]; scoredRuns: number }`
  - `function persuasionsFor(plan: PersuasionPlan | null, runs: readonly Run[]): Persuasions`
  - `function createLabPlansApi(client): { getPlan(planKey: string): Promise<PersuasionPlan | null> }`

**Background you need:** `RunScore.winningArgument` is free text the judge wrote; `RunScore.winningCategory` is a typed enum, and every `Argument` carries a category. There is no id linking a win back to a specific argument sentence. So the annotation is per category, two arguments in the same category show the same count, and the screen has to say so. `buildBank` already computes wins and example sentences per category over a set of runs, counting only runs that agreed.

- [ ] **Step 1: Write the failing test**

Create `tests/persuade/persuasions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { PersuasionPlan, Run } from '../../src/persuade/engine/types'
import { persuasionsFor } from '../../src/persuade/persuasions'

const plan = {
  id: 'gen-retail-ceo-profitability',
  arguments: [
    { id: 'a1', category: 'numbers', text: 'המספרים מראים', strength: 8, why: '' },
    { id: 'a2', category: 'numbers', text: 'עוד מספרים', strength: 6, why: '' },
    { id: 'a3', category: 'authority', text: 'המנכ"ל ביקש', strength: 5, why: '' },
  ],
} as unknown as PersuasionPlan

const run = (outcome: string, category: string | null, sentence: string | null): Run =>
  ({
    state: { outcome },
    score: category
      ? { winningCategory: category, winningArgument: sentence, persuaded: 'yes' }
      : null,
  }) as unknown as Run

describe('annotating what was handed over', () => {
  it('counts a category’s wins against every argument in it', () => {
    const { arguments: args } = persuasionsFor(plan, [
      run('agreed', 'numbers', 'המספרים מראים'),
      run('agreed', 'numbers', 'עוד מספרים'),
    ])

    // Two arguments share the category, so both carry the same count. That is
    // the honest reading: winningArgument is free text the judge wrote and
    // winningCategory is the only typed link back to an argument.
    expect(args.find((a) => a.id === 'a1')?.categoryWins).toBe(2)
    expect(args.find((a) => a.id === 'a2')?.categoryWins).toBe(2)
  })

  it('shows an argument nothing has won on as zero, not as missing', () => {
    // An argument that has never carried a conversation is the most useful row
    // on this screen. Omitting it would hide exactly the finding it is here for.
    const { arguments: args } = persuasionsFor(plan, [run('agreed', 'numbers', 'המספרים מראים')])

    expect(args.find((a) => a.id === 'a3')).toMatchObject({ categoryWins: 0 })
    expect(args).toHaveLength(3)
  })

  it('carries the sentences that actually won', () => {
    const { arguments: args } = persuasionsFor(plan, [run('agreed', 'numbers', 'המספרים מראים')])

    expect(args.find((a) => a.id === 'a1')?.winningSentences).toContain('המספרים מראים')
  })

  it('does not count a refusal as a win', () => {
    // The scorer names the closest thing to a winner even when nothing moved
    // anyone. buildBank already refuses those; this asserts the refusal survives.
    const { arguments: args } = persuasionsFor(plan, [run('refused', 'numbers', 'המספרים מראים')])

    expect(args.every((a) => a.categoryWins === 0)).toBe(true)
  })

  it('reports a category that won but was never written down', () => {
    // The persuader improvised something the plan did not contain and it
    // worked. That is a finding about the plan, not noise.
    const { unwrittenWins } = persuasionsFor(plan, [
      run('agreed', 'less_work_later', 'יחסוך לך זמן אחר כך'),
    ])

    expect(unwrittenWins).toHaveLength(1)
    expect(unwrittenWins[0]).toMatchObject({ category: 'less_work_later', wonCount: 1 })
    expect(unwrittenWins[0]?.categoryLabel).toMatch(/[֐-׿]/)
  })

  it('counts how many runs were scored at all', () => {
    // Runs with no score are a different fact from runs that lost, and the
    // screen says which it is looking at.
    const { scoredRuns } = persuasionsFor(plan, [
      run('agreed', 'numbers', 'המספרים מראים'),
      run('agreed', null, null),
    ])

    expect(scoredRuns).toBe(1)
  })

  it('returns the empty shape for a need with no plan', () => {
    expect(persuasionsFor(null, [])).toEqual({
      arguments: [],
      unwrittenWins: [],
      scoredRuns: 0,
    })
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
pnpm vitest run tests/persuade/persuasions.test.ts
```

Expected: FAIL, cannot resolve `../../src/persuade/persuasions`.

- [ ] **Step 3: Write the module**

Create `src/persuade/persuasions.ts`:

```ts
import { buildBank } from './bank'
import type { ArgumentCategory, PersuasionPlan, Run } from './engine/types'
import { CATEGORY_LABELS } from './labels'

/**
 * What the persuader was handed, beside what actually worked.
 *
 * Attribution is by category and the screen says so. RunScore.winningArgument
 * is free text the judge wrote; RunScore.winningCategory is a typed enum and
 * every Argument carries one, so the category is the only link back that is
 * true. Two arguments in one category therefore show the same count. Making it
 * sentence-level means handing the judge the argument ids and changing the
 * scoring prompt, which makes new runs incomparable with old ones -- not worth
 * it at 168 runs.
 */

export interface AnnotatedArgument {
  id: string
  category: ArgumentCategory
  categoryLabel: string
  text: string
  strength: number
  /** Wins by this argument's CATEGORY, not by this sentence. */
  categoryWins: number
  /** The sentences that actually won in that category, as the judge recorded them. */
  winningSentences: string[]
}

export interface UnwrittenWin {
  category: ArgumentCategory
  categoryLabel: string
  wonCount: number
  examples: string[]
}

export interface Persuasions {
  arguments: AnnotatedArgument[]
  /** Categories that carried a conversation without appearing in the plan. */
  unwrittenWins: UnwrittenWin[]
  /** Runs carrying a score. A run with none has not lost; it has not been judged. */
  scoredRuns: number
}

export function persuasionsFor(plan: PersuasionPlan | null, runs: readonly Run[]): Persuasions {
  if (!plan) return { arguments: [], unwrittenWins: [], scoredRuns: 0 }

  const bank = buildBank(runs)
  const byCategory = new Map(bank.map((entry) => [entry.category, entry]))
  const written = new Set(plan.arguments.map((argument) => argument.category))

  return {
    arguments: plan.arguments.map((argument) => {
      const entry = byCategory.get(argument.category)
      return {
        id: argument.id,
        category: argument.category,
        categoryLabel: CATEGORY_LABELS[argument.category],
        text: argument.text,
        strength: argument.strength,
        categoryWins: entry?.wonCount ?? 0,
        winningSentences: entry?.examples ?? [],
      }
    }),
    unwrittenWins: bank
      .filter((entry) => !written.has(entry.category))
      .map((entry) => ({
        category: entry.category,
        categoryLabel: CATEGORY_LABELS[entry.category],
        wonCount: entry.wonCount,
        examples: entry.examples,
      })),
    scoredRuns: runs.filter((run) => run.score).length,
  }
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm vitest run tests/persuade/persuasions.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Write the plan read**

Create `src/persuade/lab-plans-api.ts`:

```ts
import type { PersuasionPlan } from './engine/types'

/**
 * One library plan, fetched when a need is opened.
 *
 * By key rather than all at once: there are 131 plans, each a full jsonb plan
 * with arguments, objections and an escalation ladder, and the screen shows one
 * at a time. persuasion_lab_plans grants select to authenticated and holds no
 * tenant's knowledge by construction -- its own table comment says why.
 */
interface PlansClient {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): PromiseLike<{
          data: Record<string, unknown> | null
          error: { message: string } | null
        }>
      }
    }
  }
}

export function createLabPlansApi(client: PlansClient) {
  return {
    /**
     * Null when the need has no generated plan yet, which is a real state and
     * not an error: the taxonomy has 130 needs and generation is a separate
     * pass over it.
     */
    async getPlan(planKey: string): Promise<PersuasionPlan | null> {
      const { data, error } = await client
        .from('persuasion_lab_plans')
        .select('plan_key,plan')
        .eq('plan_key', planKey)
        .maybeSingle()

      if (error) throw new Error(`קריאת התוכנית נכשלה: ${error.message}`)
      if (!data) return null

      // plan_key is asserted over the stored plan's own id, exactly as
      // loadPlans does: the key is the handle a run is recorded under.
      return { ...(data.plan as PersuasionPlan), id: String(data.plan_key) }
    },
  }
}

export type LabPlansApi = ReturnType<typeof createLabPlansApi>
```

- [ ] **Step 6: Verify**

```bash
pnpm vitest run tests/persuade/persuasions.test.ts && pnpm lint:fix
```

- [ ] **Step 7: Commit**

```bash
git add src/persuade/persuasions.ts src/persuade/lab-plans-api.ts tests/persuade/persuasions.test.ts
git commit -m "feat: show a need's arguments beside what actually won"
```

---

### Task 8: The counters, and the poll behind them

**Files:**
- Create: `src/persuade/use-live-counts.ts`
- Create: `src/persuade/Counters.tsx`
- Test: `tests/persuade/counters.test.tsx`

**Interfaces:**
- Consumes: `countSimulations`, `countSimulationsSince`, `countAttemptsSince` from `src/persuade/simulations-api.ts` (Task 4).
- Produces:
  - `function startOfUtcDay(now?: Date): string`
  - `interface Counts { total: number; today: number; attemptsToday: number }`
  - `function useLiveCounts(api: CountsApi): { counts: Counts | null; stale: boolean; lastOk: Date | null; refresh(): void }` — the cap is not a parameter; it is a prop on `Counters`.
  - `function Counters(props: { counts: Counts | null; dailyCap: number; stale: boolean; lastOk: Date | null; onRefresh(): void }): JSX.Element`

**Background you need:** `worker.ts` bounds the daily cap on `simulation_jobs.claimed_at >= UTC midnight`, counting attempts of any status, because a failed job has already spent its model calls. So the screen shows two numbers, not one: simulations added today, which is the brief's number, and attempts today against the cap, which is the budget. With 249 of 413 jobs having failed, these differ, and the difference is the most useful thing on the screen right now.

`PERSUADER_DAILY_RUN_CAP` is server-side. The page is a server component; read the cap there via `workerSettings().dailyCap` and pass it down as a prop. Do not add a `NEXT_PUBLIC_` variable for it.

- [ ] **Step 1: Write the failing test**

Create `tests/persuade/counters.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Counters } from '../../src/persuade/Counters'
import { startOfUtcDay } from '../../src/persuade/use-live-counts'

describe('the day boundary', () => {
  it('is UTC midnight, matching what the cap counts', () => {
    // worker.ts's attemptsToday does setUTCHours(0,0,0,0) on simulation_jobs.
    // A screen counting a local day would report a number the cap does not use.
    expect(startOfUtcDay(new Date('2026-09-22T03:00:00Z'))).toBe('2026-09-22T00:00:00.000Z')
  })
})

describe('the counters', () => {
  const counts = { total: 168, today: 0, attemptsToday: 12 }

  it('shows the cumulative total', () => {
    render(
      <Counters counts={counts} dailyCap={1000} lastOk={new Date()} onRefresh={() => {}} stale={false} />,
    )

    expect(screen.getByText('168')).toBeInTheDocument()
  })

  it('shows attempts against the cap as capacity, not as achievement', () => {
    render(
      <Counters counts={counts} dailyCap={1000} lastOk={new Date()} onRefresh={() => {}} stale={false} />,
    )

    expect(screen.getByText(/12 מתוך 1,000/)).toBeInTheDocument()
  })

  it('reports runs added and attempts made as separate numbers', () => {
    // 249 of 413 jobs have failed. Showing runs-added against a cap that bounds
    // attempts would understate the spend every time one does.
    render(
      <Counters counts={counts} dailyCap={1000} lastOk={new Date()} onRefresh={() => {}} stale={false} />,
    )

    expect(screen.getByText(/נוספו היום/)).toBeInTheDocument()
    expect(screen.getByText(/ניסיונות היום/)).toBeInTheDocument()
  })

  it('says so when the feed has gone stale rather than showing the numbers as current', () => {
    render(
      <Counters
        counts={counts}
        dailyCap={1000}
        lastOk={new Date('2026-09-22T09:00:00Z')}
        onRefresh={() => {}}
        stale
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(/לא מתעדכן/)
    expect(screen.getByRole('button', { name: /רענון/ })).toBeInTheDocument()
  })

  it('renders without numbers before the first read lands', () => {
    render(
      <Counters counts={null} dailyCap={1000} lastOk={null} onRefresh={() => {}} stale={false} />,
    )

    expect(screen.getByText(/טוען/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
pnpm vitest run tests/persuade/counters.test.tsx
```

Expected: FAIL, cannot resolve the modules.

- [ ] **Step 3: Write the hook**

Create `src/persuade/use-live-counts.ts`:

```ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The same boundary the cap uses.
 *
 * worker.ts's attemptsToday calls setUTCHours(0,0,0,0) on simulation_jobs. A
 * screen that counted a local day would show a number against a cap measured
 * over a different window, and the two would disagree for three hours a day.
 */
export function startOfUtcDay(now: Date = new Date()): string {
  const start = new Date(now)
  start.setUTCHours(0, 0, 0, 0)
  return start.toISOString()
}

export interface Counts {
  total: number
  today: number
  attemptsToday: number
}

interface CountsApi {
  countSimulations(): Promise<number>
  countSimulationsSince(iso: string): Promise<number>
  countAttemptsSince(iso: string): Promise<number>
}

/**
 * A poll, not Realtime.
 *
 * public.simulations is not in the supabase_realtime publication and nothing in
 * this codebase uses Realtime, so a subscription costs a migration in a second
 * repo and a new runtime dependency. The worker ticks every ten minutes and its
 * runs land in a burst, so fifteen seconds catches a burst within seconds of it
 * starting. The difference is not perceptible on this screen.
 */
const INTERVAL_MS = 15_000

export function useLiveCounts(api: CountsApi) {
  const [counts, setCounts] = useState<Counts | null>(null)
  const [lastOk, setLastOk] = useState<Date | null>(null)
  const [stale, setStale] = useState(false)
  const running = useRef(false)

  const refresh = useCallback(async () => {
    // Overlapping reads would let a slow response overwrite a newer one.
    if (running.current) return
    running.current = true
    try {
      const since = startOfUtcDay()
      const [total, today, attemptsToday] = await Promise.all([
        api.countSimulations(),
        api.countSimulationsSince(since),
        api.countAttemptsSince(since),
      ])
      setCounts({ total, today, attemptsToday })
      setLastOk(new Date())
      setStale(false)
    } catch {
      // The last good numbers stay on screen and are marked stale. Blanking
      // them would lose a true reading to report a transient failure.
      setStale(true)
    } finally {
      running.current = false
    }
  }, [api])

  useEffect(() => {
    void refresh()
    // Paused while the tab is hidden: a background tab polling every fifteen
    // seconds spends requests nobody is reading.
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const timer = setInterval(tick, INTERVAL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [refresh])

  return { counts, stale, lastOk, refresh: () => void refresh() }
}
```

- [ ] **Step 4: Write the component**

Create `src/persuade/Counters.tsx`:

```tsx
'use client'

import type { Counts } from './use-live-counts'

const he = new Intl.NumberFormat('he-IL')

const time = (at: Date) =>
  at.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

/**
 * Three measured numbers and one cap. No projection and no run rate: the
 * product's own rule is that measured overwrites invented, and "on track for"
 * is invented.
 */
export function Counters({
  counts,
  dailyCap,
  stale,
  lastOk,
  onRefresh,
}: {
  counts: Counts | null
  dailyCap: number
  stale: boolean
  lastOk: Date | null
  onRefresh: () => void
}) {
  if (!counts) {
    return (
      <p className="counters__loading" dir="rtl">
        טוען מונים…
      </p>
    )
  }

  return (
    <div className="counters" dir="rtl">
      <div className="counters__figure">
        <b>{he.format(counts.total)}</b>
        <span>סימולציות עד כה</span>
      </div>
      <div className="counters__figure">
        <b>{he.format(counts.today)}</b>
        <span>נוספו היום</span>
      </div>
      {/* Attempts, not runs: the cap bounds jobs claimed, whatever their
          outcome, because a failed job has already spent its model calls. */}
      <div className="counters__figure">
        <b>{`${he.format(counts.attemptsToday)} מתוך ${he.format(dailyCap)}`}</b>
        <span>ניסיונות היום, מתוך התקרה</span>
      </div>
      <p className="counters__state" role="status">
        {stale
          ? `לא מתעדכן. הקריאה האחרונה שהצליחה: ${lastOk ? time(lastOk) : 'לא הייתה'}`
          : `מתעדכן. עודכן ${lastOk ? time(lastOk) : ''}`}
      </p>
      <button className="counters__refresh" onClick={onRefresh} type="button">
        רענון
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Run the test**

```bash
pnpm vitest run tests/persuade/counters.test.tsx
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Add the styles**

Append to `src/persuade/persuade.css`. Use logical properties only:

```css
.counters {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem 1.5rem;
  align-items: baseline;
  margin-block: 1rem;
}

.counters__figure {
  display: flex;
  flex-direction: column;
}

.counters__figure b {
  font-size: 1.75rem;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.counters__figure span {
  font-size: 0.8rem;
  opacity: 0.75;
}

.counters__state {
  flex-basis: 100%;
  font-size: 0.8rem;
  opacity: 0.75;
  margin: 0;
}

.counters__refresh {
  padding-block: 0.25rem;
  padding-inline: 0.75rem;
}
```

- [ ] **Step 7: Commit**

```bash
git add src/persuade/use-live-counts.ts src/persuade/Counters.tsx src/persuade/persuade.css tests/persuade/counters.test.tsx
git commit -m "feat: count runs added and attempts made against the cap"
```

---

### Task 9: Assemble the screen

The last task: the drill-down, the selection in the URL, the link from the brain, and the boundary test extended over everything added.

**Files:**
- Modify: `app/[brandId]/tools/persuade/lab/lab-client.tsx` (full rewrite, code below)
- Modify: `app/[brandId]/tools/persuade/lab/page.tsx`
- Modify: `app/[brandId]/tools/brain/book-client.tsx`
- Modify: `tests/persuade/lab.test.tsx` (extend; it already exists and already tests this component)
- Modify: `tests/persuade/tenant-boundary.test.ts`
- Modify: `src/persuade/persuade.css`

**Interfaces:**
- Consumes: everything produced by Tasks 2 and 4 through 8.
- Produces: `LabClient` gains a required `dailyCap: number` prop. No module other tasks import.

**Background you need:** `tests/persuade/lab.test.tsx` already exists, already renders `LabClient`, and already mocks `next/navigation`, `supabase-browser`, `simulations-api` and `roles-api` with `vi.hoisted`. Follow its idiom rather than inventing a second one, and keep its two existing tests working. It mocks `useRouter` and `usePathname` but not `useSearchParams`, which the rewrite needs.

- [ ] **Step 1: Write the failing tests**

In `tests/persuade/lab.test.tsx`, extend the existing mock block. Add `useSearchParams` to the `next/navigation` mock, add the two new apis, and switch the simulations mock to the summary reader:

```tsx
const router = { replace: vi.fn() }
let search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/minene/tools/persuade/lab',
  useSearchParams: () => search,
}))

const sims = vi.hoisted(() => ({
  listSimulations: vi.fn(),
  listSimulationSummaries: vi.fn(),
  countSimulations: vi.fn(),
  countSimulationsSince: vi.fn(),
  countAttemptsSince: vi.fn(),
}))
const taxonomy = vi.hoisted(() => ({ listRoleNeeds: vi.fn() }))
vi.mock('../../src/persuade/taxonomy-api', async (o) => ({
  ...(await o<Record<string, unknown>>()),
  createTaxonomyApi: () => taxonomy,
}))
const labPlans = vi.hoisted(() => ({ getPlan: vi.fn() }))
vi.mock('../../src/persuade/lab-plans-api', async (o) => ({
  ...(await o<Record<string, unknown>>()),
  createLabPlansApi: () => labPlans,
}))
```

Extend `beforeEach` with the new defaults, and update `setup` to pass the cap:

```tsx
const NEEDS = [
  {
    industry: 'retail',
    roleSlug: 'ceo',
    roleLabel: 'מנכ"ל',
    roleOrder: 1,
    needKey: 'profitability',
    needLabel: 'רווחיות',
    needOrder: 1,
    metaNeed: 'money',
  },
  {
    industry: 'infrastructure',
    roleSlug: 'ceo',
    roleLabel: 'מנכ"ל',
    roleOrder: 1,
    needKey: 'uptime',
    needLabel: 'זמינות',
    needOrder: 1,
    metaNeed: 'control',
  },
]

const summary = (planId: string, outcome: string, score: unknown = null) =>
  ({
    id: `s-${planId}-${outcome}`,
    cell: { industry: 'retail', jobRoleId: null },
    run: { plan: { id: planId }, state: { outcome, blockers: [] }, score },
  }) as never

const setup = () => {
  render(<LabClient dailyCap={1000} personas={PERSONAS} plans={PLANS} />)
  return userEvent.setup()
}
```

```tsx
beforeEach(() => {
  vi.clearAllMocks()
  search = new URLSearchParams()
  sims.listSimulations.mockResolvedValue([])
  sims.listSimulationSummaries.mockResolvedValue([])
  sims.countSimulations.mockResolvedValue(0)
  sims.countSimulationsSince.mockResolvedValue(0)
  sims.countAttemptsSince.mockResolvedValue(0)
  taxonomy.listRoleNeeds.mockResolvedValue(NEEDS)
  labPlans.getPlan.mockResolvedValue(null)
  roles.listRoles.mockResolvedValue([{ id: 'r1', name: 'מנהלת חנות', sortOrder: 10 }])
  // ...the existing fetch stub stays exactly as it is
})
```

In the existing test `'reloads the matrix when a run lands, so the new cell appears'`, change both `sims.listSimulations` assertions to `sims.listSimulationSummaries`. Leave everything else in that test alone.

Then append the new tests:

```tsx
describe('the grid is drawn from the taxonomy', () => {
  it('shows an industry nobody has run', async () => {
    // infrastructure has never had a run. It is on screen because the grid is
    // built from role_needs, and for an instrument the hole is the finding.
    setup()

    expect(await screen.findByText('תשתיות')).toBeInTheDocument()
    expect(await screen.findByText('קמעונאות')).toBeInTheDocument()
  })

  it('says how many runs it could not place instead of dropping them', async () => {
    // Every run on record carries the briefings plan, which belongs to no cell.
    // Dropping them would show an empty grid beside a total of 168 with no hint
    // which number to believe.
    sims.listSimulationSummaries.mockResolvedValue([
      summary('briefings', 'agreed'),
      summary('briefings', 'refused'),
    ])
    setup()

    expect(await screen.findByText(/2 ריצות מחוץ למפה/)).toBeInTheDocument()
  })
})

describe('drilling down', () => {
  it('opens a role’s needs, with the meta-need beside each', async () => {
    const user = setup()
    await user.click(await screen.findByRole('gridcell', { name: /קמעונאות/ }))

    expect(router.replace).toHaveBeenCalledWith(
      expect.stringContaining('industry=retail'),
      expect.anything(),
    )
    expect(router.replace).toHaveBeenCalledWith(
      expect.stringContaining('role=ceo'),
      expect.anything(),
    )
  })

  it('lists the needs of the selected role', async () => {
    search = new URLSearchParams('industry=retail&role=ceo')
    setup()

    expect(await screen.findByRole('button', { name: /רווחיות/ })).toBeInTheDocument()
    // The other industry's need must not leak into this role's list.
    expect(screen.queryByRole('button', { name: /זמינות/ })).not.toBeInTheDocument()
  })

  it('shows the arguments handed over, and states the attribution limit', async () => {
    search = new URLSearchParams('industry=retail&role=ceo&need=profitability')
    labPlans.getPlan.mockResolvedValue({
      id: 'gen-retail-ceo-profitability',
      arguments: [{ id: 'a1', category: 'numbers', text: 'המספרים מראים', strength: 8, why: '' }],
    })
    sims.listSimulationSummaries.mockResolvedValue([
      summary('gen-retail-ceo-profitability', 'agreed', {
        winningCategory: 'numbers',
        winningArgument: 'המספרים מראים',
        persuaded: 'yes',
      }),
    ])
    setup()

    expect(await screen.findByText('המספרים מראים')).toBeInTheDocument()
    // The caveat is on screen, not left to be assumed: winningArgument is free
    // text and the category is the only link back that is true.
    expect(await screen.findByText(/לפי קטגוריה/)).toBeInTheDocument()
  })

  it('says a need has no plan yet, which is not the same as having no runs', async () => {
    search = new URLSearchParams('industry=retail&role=ceo&need=profitability')
    labPlans.getPlan.mockResolvedValue(null)
    setup()

    expect(await screen.findByText(/אין עדיין תוכנית/)).toBeInTheDocument()
  })
})

describe('the counters', () => {
  it('shows the cumulative total and the cap', async () => {
    sims.countSimulations.mockResolvedValue(168)
    sims.countAttemptsSince.mockResolvedValue(12)
    setup()

    expect(await screen.findByText('168')).toBeInTheDocument()
    expect(await screen.findByText(/12 מתוך 1,000/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to make sure they fail**

```bash
pnpm vitest run tests/persuade/lab.test.tsx
```

Expected: FAIL. `LabClient` does not accept `dailyCap`, still calls `listSimulations`, and still imports the deleted `matrixFrom`.

- [ ] **Step 3: Rewrite the client**

Replace `app/[brandId]/tools/persuade/lab/lab-client.tsx` entirely:

```tsx
'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createBrowserSupabase } from '../../../../../src/auth/supabase-browser'
import { createRolesApi, type RolesClient } from '../../../../../src/brain/roles-api'
import type { Role } from '../../../../../src/brain/types'
import { useApiErrorHandler } from '../../../../../src/brain/use-api-error'
import { blockersIn } from '../../../../../src/persuade/bank'
import { cellIndex, planKeyFor } from '../../../../../src/persuade/cell'
import { Counters } from '../../../../../src/persuade/Counters'
import { coverageOf, gridFrom, placeAll } from '../../../../../src/persuade/coverage'
import type { PersuasionPlan } from '../../../../../src/persuade/engine/types'
import { createLabPlansApi } from '../../../../../src/persuade/lab-plans-api'
import { BLOCKER_LABELS } from '../../../../../src/persuade/labels'
import type { StoredSimulation } from '../../../../../src/persuade/lib/simulations'
import { Matrix, type MatrixCell } from '../../../../../src/persuade/Matrix'
import { persuasionsFor } from '../../../../../src/persuade/persuasions'
import { type PersonaOption, RunControl } from '../../../../../src/persuade/RunControl'
import { createSimulationsApi } from '../../../../../src/persuade/simulations-api'
import { type NeedRow, taxonomyFrom } from '../../../../../src/persuade/taxonomy'
import { createTaxonomyApi } from '../../../../../src/persuade/taxonomy-api'
import { useLiveCounts } from '../../../../../src/persuade/use-live-counts'

interface LabClientProps {
  personas: PersonaOption[]
  plans: PersuasionPlan[]
  /** PERSUADER_DAILY_RUN_CAP, read on the server. It is not a public variable. */
  dailyCap: number
}

/**
 * One screen, not three.
 *
 * The grid is the navigation, the needs are what a cell contains, and the
 * persuasions are what a need accumulates. Splitting those into a simulator, a
 * measurement screen and a matrix would have made three surfaces that each show
 * a third of the same fact -- the mistake the brain's five screens made.
 *
 * What changed on 2026-09-22: the grid is drawn from role_needs rather than
 * from the runs. A sector nobody has run used to be absent from the screen,
 * which answers "what have we measured". This screen answers "where has the
 * sweep been", and for that question an empty cell is the whole point.
 */
export function LabClient({ personas, plans, dailyCap }: LabClientProps) {
  const client = useMemo(() => createBrowserSupabase(), [])
  const simulationsApi = useMemo(() => createSimulationsApi(client as never), [client])
  const taxonomyApi = useMemo(() => createTaxonomyApi(client as never), [client])
  const labPlansApi = useMemo(() => createLabPlansApi(client as never), [client])
  const rolesApi = useMemo(() => createRolesApi(client as unknown as RolesClient), [client])
  const handleError = useApiErrorHandler()

  const [simulations, setSimulations] = useState<StoredSimulation[]>([])
  const [needRows, setNeedRows] = useState<NeedRow[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [plan, setPlan] = useState<PersuasionPlan | null>(null)
  const [error, setError] = useState('')

  const { counts, stale, lastOk, refresh } = useLiveCounts(simulationsApi)

  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const industry = params.get('industry')
  const role = params.get('role')
  const need = params.get('need')

  /**
   * One state, not two. A filter and a drill-down each holding their own copy
   * of "which cell" would be two things to keep in agreement, and the URL is
   * the copy that also makes a cell a link.
   */
  const select = useCallback(
    (next: { industry?: string | null; role?: string | null; need?: string | null }) => {
      const query = new URLSearchParams(params.toString())
      for (const [key, value] of Object.entries(next)) {
        if (value) query.set(key, value)
        else query.delete(key)
      }
      router.replace(`${pathname}?${query.toString()}`, { scroll: false })
    },
    [params, pathname, router],
  )

  const load = useCallback(async () => {
    try {
      const [runs, needs, catalogue] = await Promise.all([
        // Summaries, not full rows: `turns` is a whole conversation and nothing
        // here reads one. At the cap this screen exists to show, that column is
        // the difference between a few megabytes and a few hundred.
        simulationsApi.listSimulationSummaries(),
        taxonomyApi.listRoleNeeds(),
        rolesApi.listRoles(),
      ])
      setSimulations(runs)
      setNeedRows(needs)
      setRoles(catalogue)
    } catch (failure) {
      if (handleError(failure)) setError('לא הצלחנו לטעון את הריצות')
    }
  }, [handleError, rolesApi, simulationsApi, taxonomyApi])

  useEffect(() => {
    void load()
  }, [load])

  const taxonomy = useMemo(() => taxonomyFrom(needRows), [needRows])
  const index = useMemo(() => cellIndex(needRows), [needRows])
  const placed = useMemo(() => placeAll(index, simulations), [index, simulations])
  const cells = useMemo(() => gridFrom(taxonomy, placed), [taxonomy, placed])

  const selectedRole = useMemo(
    () =>
      taxonomy
        .find((entry) => entry.industry === industry)
        ?.roles.find((entry) => entry.roleSlug === role) ?? null,
    [industry, role, taxonomy],
  )

  const selectedCell = useMemo(
    () => cells.find((cell) => cell.industry === industry && cell.roleSlug === role) ?? null,
    [cells, industry, role],
  )

  const needRuns = useMemo(
    () => (industry && role && need ? (placed.runsByCell.get(`${industry}/${role}/${need}`) ?? []) : []),
    [industry, need, placed, role],
  )

  // The plan is fetched per need rather than all 131 at once: the screen shows
  // one at a time, and each is a full plan with arguments and objections.
  useEffect(() => {
    if (!industry || !role || !need) {
      setPlan(null)
      return
    }
    let live = true
    void labPlansApi
      .getPlan(planKeyFor({ industry, roleSlug: role, needKey: need }))
      .then((found) => {
        if (live) setPlan(found)
      })
      .catch((failure) => {
        if (handleError(failure)) setError('לא הצלחנו לטעון את התוכנית')
      })
    return () => {
      live = false
    }
  }, [handleError, industry, labPlansApi, need, role])

  const persuasions = useMemo(() => persuasionsFor(plan, needRuns), [needRuns, plan])
  const blockers = useMemo(() => blockersIn(needRuns), [needRuns])

  const onSelectCell = (cell: MatrixCell) =>
    select({ industry: cell.industry, role: cell.roleSlug, need: null })

  return (
    <div className="brain-surface">
      <section aria-label="מעבדת השכנוע" className="knowledge-shell" dir="rtl">
        <header className="knowledge-header">
          <h2>מעבדת השכנוע</h2>
        </header>

        {error ? (
          <p className="knowledge-message" role="alert">
            {error}
          </p>
        ) : null}

        <Counters
          counts={counts}
          dailyCap={dailyCap}
          lastOk={lastOk}
          onRefresh={refresh}
          stale={stale}
        />

        {/* A run that places nowhere is named, never dropped. Every run on
            record carries the briefings plan, which predates the taxonomy. */}
        {placed.unplaced > 0 ? (
          <p className="knowledge-message">
            {`${placed.unplaced} ריצות מחוץ למפה: הן רצו על תוכנית שאינה שייכת לאף ענף, תפקיד וצורך.`}
          </p>
        ) : null}

        {/* Outside the "are there runs" branch, deliberately. A control inside
            it would make the first run the one thing this screen could not do. */}
        <RunControl onFinished={load} personas={personas} plans={plans} roles={roles} />

        {cells.length === 0 ? (
          <p className="knowledge-message">מפת הצרכים ריקה, ולכן אין ממה לבנות את המטריצה.</p>
        ) : (
          <>
            <Matrix cells={cells} onSelect={onSelectCell} selected={selectedCell} />

            {/* Each end is labelled where it sits rather than described by an
                arrow beside the ramp. "0% ← 100%" as one string forces the
                reader to work out which end the arrow means, and in RTL that is
                genuinely ambiguous. */}
            <div className="matrix-legend">
              <span>שיעור שכנוע</span>
              <span className="matrix-legend__scale">
                <span>0%</span>
                <span aria-hidden="true" className="matrix-legend__ramp">
                  <i className="cell" data-heat="1" />
                  <i className="cell" data-heat="2" />
                  <i className="cell" data-heat="3" />
                  <i className="cell" data-heat="4" />
                  <i className="cell" data-heat="5" />
                </span>
                <span>100%</span>
              </span>
              <span className="matrix-legend__none">
                <i aria-hidden="true" className="cell" data-heat="none" />
                אין ריצות — לא אפס אחוז
              </span>
            </div>
          </>
        )}

        {selectedRole && industry ? (
          <section aria-label={`צרכים: ${selectedRole.roleLabel}`}>
            <h3 className="knowledge-heading">
              {`${selectedCell?.industryLabel ?? industry} · ${selectedRole.roleLabel}`}
            </h3>
            <ul className="needs">
              {selectedRole.needs.map((entry) => {
                const coverage = coverageOf(
                  placed.runsByCell.get(`${industry}/${selectedRole.roleSlug}/${entry.needKey}`) ??
                    [],
                )
                return (
                  <li key={entry.needKey}>
                    <button
                      aria-pressed={need === entry.needKey}
                      className="needs__row"
                      onClick={() => select({ need: entry.needKey })}
                      type="button"
                    >
                      <span className="needs__label">{entry.needLabel}</span>
                      <span className="needs__meta">{entry.metaNeed}</span>
                      <span className="needs__coverage">
                        {coverage.persuasionRate === null
                          ? 'אין ריצות'
                          : `${coverage.runs} ריצות · ${coverage.persuasionRate}% שכנוע`}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}

        {need ? (
          <section aria-label="שכנועים לצורך">
            {plan === null ? (
              // A need with no generated plan is a real state, not an error:
              // there are 130 needs and generation is a separate pass over them.
              <p className="knowledge-message">אין עדיין תוכנית לצורך הזה.</p>
            ) : (
              <>
                <p className="knowledge-message">
                  הניצחונות נספרים לפי קטגוריה, לא לפי המשפט עצמו: מה שהשופט רשם כטיעון המנצח הוא
                  טקסט חופשי, והקטגוריה היא הקישור היחיד שאפשר לסמוך עליו.
                </p>

                <ul className="persuasions">
                  {persuasions.arguments.map((argument) => (
                    <li className="persuasions__row" key={argument.id}>
                      <span className="persuasions__category">{argument.categoryLabel}</span>
                      <span>{argument.text}</span>
                      <span className="persuasions__won">
                        {argument.categoryWins === 0
                          ? 'עוד לא ניצח'
                          : `ניצח ${argument.categoryWins}×`}
                      </span>
                    </li>
                  ))}
                </ul>

                {persuasions.unwrittenWins.length ? (
                  <p className="knowledge-message">
                    {`ניצחו כאן בלי להיות כתובים בתוכנית: ${persuasions.unwrittenWins
                      .map((win) => `${win.categoryLabel} (${win.wonCount}×)`)
                      .join(', ')}`}
                  </p>
                ) : null}

                {needRuns.length > 0 && persuasions.scoredRuns === 0 ? (
                  // Runs but no scores is a different fact from no runs, and
                  // from runs that lost. All three read differently here.
                  <p className="knowledge-message">
                    אף ריצה כאן לא נוקדה, ולכן אין עדיין טיעונים מנצחים.
                  </p>
                ) : null}

                {blockers.length ? (
                  <p className="knowledge-message">
                    {`החסם השכיח כאן: ${BLOCKER_LABELS[blockers[0]!.blocker]} — נתקלו בו ${blockers[0]!.encountered} פעמים, נשבר ב-${blockers[0]!.overcome}.`}
                  </p>
                ) : null}
              </>
            )}
          </section>
        ) : null}
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Pass the cap, and wrap in Suspense**

Replace the return in `app/[brandId]/tools/persuade/lab/page.tsx`:

```tsx
import { Suspense } from 'react'
import { workerSettings } from '../../../../../src/persuade/lib/worker-settings'
```

```tsx
  return (
    // useSearchParams needs a Suspense boundary above it, otherwise the whole
    // route opts out of static rendering with a build-time warning.
    <Suspense fallback={<p className="knowledge-message">טוען את המעבדה…</p>}>
      <LabClient dailyCap={workerSettings().dailyCap} personas={personas} plans={plans} />
    </Suspense>
  )
```

`PERSUADER_DAILY_RUN_CAP` is read on the server because it is not a `NEXT_PUBLIC_` variable and should not become one.

- [ ] **Step 5: Run the screen tests**

```bash
pnpm vitest run tests/persuade/lab.test.tsx
```

Expected: PASS, both original tests and all seven new ones.

- [ ] **Step 6: Add the styles**

Append to `src/persuade/persuade.css`. Logical properties only; no new colours, since the heat scale and surface tokens already in this file are the palette:

```css
.needs {
  list-style: none;
  margin-block: 1rem;
  padding: 0;
  display: grid;
  gap: 0.25rem;
}

.needs__row {
  inline-size: 100%;
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 0.75rem;
  align-items: baseline;
  padding-block: 0.5rem;
  padding-inline: 0.75rem;
  text-align: start;
  background: none;
  border: 1px solid transparent;
  border-radius: 0.375rem;
  cursor: pointer;
}

.needs__row:hover {
  border-color: currentColor;
}

.needs__row[aria-pressed='true'] {
  border-color: currentColor;
  font-weight: 600;
}

.needs__meta,
.needs__coverage {
  font-size: 0.8rem;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}

.persuasions {
  list-style: none;
  margin-block: 1rem;
  padding: 0;
  display: grid;
  gap: 0.25rem;
}

.persuasions__row {
  display: grid;
  grid-template-columns: minmax(6rem, auto) 1fr auto;
  gap: 0.75rem;
  align-items: baseline;
  padding-block: 0.5rem;
}

.persuasions__category {
  font-size: 0.8rem;
  opacity: 0.75;
}

.persuasions__won {
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 640px) {
  .needs__row,
  .persuasions__row {
    grid-template-columns: 1fr;
    gap: 0.25rem;
  }
}
```

- [ ] **Step 7: Link it from the brain**

In `app/[brandId]/tools/brain/book-client.tsx`, inside the existing
`knowledge-owner-tools` div (around line 217, beside the `הזנה` link), add:

```tsx
              <Link href={`/${brandId}/tools/persuade/lab`}>מעבדת השכנוע</Link>
```

That div is already rendered only when `isOwner`, and `Link` and `brandId` are already in scope there. Do not add a new card, nav pattern or gate for one link. `page.tsx` is deliberately not the place: it has no markup and no role gate, it hands `role` down to this component, and every owner-only control already lives here. This is what satisfies the brief's "בתוך המוח" without a second screen.

- [ ] **Step 8: Extend the tenant boundary test**

In `tests/persuade/tenant-boundary.test.ts`, inside the existing top-level `describe`, add:

```ts
  it('holds for the screen that reads the sweep back', () => {
    // These modules read the taxonomy and the runs, both industry-scoped rather
    // than tenant-scoped. The moment one of them reads a tenant's rules, one
    // business's knowledge appears on a grid every business can open.
    for (const path of [
      'src/persuade/cell.ts',
      'src/persuade/coverage.ts',
      'src/persuade/taxonomy.ts',
      'src/persuade/taxonomy-api.ts',
      'src/persuade/persuasions.ts',
      'src/persuade/lab-plans-api.ts',
      'src/persuade/use-live-counts.ts',
    ]) {
      const text = source(path)
      expect(text).not.toMatch(/ammunition/i)
      expect(text).not.toMatch(/tenantId|tenant_id/)
      expect(text).not.toMatch(/assignmentId|assignment_id/)
      expect(text).not.toMatch(/from\('(rules|documents|profiles)'\)/)
    }
  })
```

`roles` is deliberately absent from that last pattern: `lab-client.tsx` still reads `public.roles` for `RunControl`, and these seven modules do not, so the narrower list is the honest assertion.

- [ ] **Step 9: Verify everything**

```bash
pnpm ci
```

Expected: PASS. Biome, `tsc --noEmit` and the full vitest suite.

- [ ] **Step 10: Check it at three widths**

```bash
pnpm dev
```

Open `/[brandId]/tools/persuade/lab` at 375, 768 and 1440. Confirm no horizontal page scroll, that the matrix scrolls inside `.matrix-scroll` rather than the page, and that the counters and the needs rows wrap rather than overflow. Fix any overflow before committing.

- [ ] **Step 11: Commit**

```bash
git add -A app src tests
git commit -m "feat: drill from industry to the arguments that won under a need"
```

---

## Verification, end to end

After Task 9, before calling this done:

```bash
pnpm ci
```

Then confirm against the live database that the screen's claims are true:

- The grid shows 5 industries and 26 roles, almost all of them empty.
- The unplaced line reads 168, because every run on record carries the `briefings` plan.
- The cumulative counter reads 168 and today reads 0, until the loop runs again.

If the unplaced line reads anything other than the full 168, `placeRun` is matching something it should not. If an industry is missing, the taxonomy read is filtering when it should not. Either is a bug in this work, not a property of the data.

## What this plan does not do

- Restore model credits. Nothing here produces a run until that happens.
- Backfill `simulations.need`. The read path does not use the column.
- Add sentence-level win attribution, or the scoring prompt change it would need.
- Touch `eran-presueder`, which remains the older copy.
