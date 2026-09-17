# Simulation Throughput Implementation Plan (plan 1 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take minene's simulation worker from an idle hourly loop capped at 200 runs a day to a self-refilling loop that can sustain 1,000 runs a day, records token usage per run, and stops itself when runs are failing.

**Architecture:** The worker keeps its shape: a cron hits `/api/persuade/worker`, which calls `tick()`. `tick()` gains four collaborators, each in its own file with a pure core and a thin database edge: a bounded concurrency pool, a failure-rate circuit breaker, a queue refill that walks (persona, plan) pairs times world cells with a compare-and-set cursor in Postgres, and a per-run usage meter carried through `AsyncLocalStorage` so no engine signature changes. Schema changes are one eran-task migration.

**Tech Stack:** Next.js 16 route handlers, TypeScript strict, AI SDK v7 (`ai`), `@supabase/supabase-js`, Vitest with `MockLanguageModelV3`, Biome, Supabase Postgres (PL/pgSQL).

**Spec:** `docs/superpowers/specs/2026-09-17-simulation-scale-and-training-design.md`, section 1 (Throughput). Section 2's pairing rule is implemented here in its minimal form (industry + target role, null role pairs with every persona in the industry) because the refill cannot enumerate without it. Plans 2-4 (generated content, technique weights, real-conversation training) are written after this one lands.

## Global Constraints

- Repos: code in `minene` on branch `feat/simulation-scale-and-training`; migration in `eran-task` on a new branch `feat/simulation-feed`.
- `eran-presueder` is not touched.
- TypeScript strict; `noUncheckedIndexedAccess` is on, so indexed reads need a cast or a guard, as the existing code does.
- minene style: no semicolons, single quotes, 2-space indent, Biome (`pnpm lint`). Comments explain why, not what, matching the surrounding files.
- User-facing error strings are Hebrew, matching existing `throw new Error('...')` calls.
- No emojis anywhere.
- A simulation must never read tenant data: no `ammunition`, `tenant_id`/`tenantId`, `assignment_id`/`assignmentId` in `simulation.ts`, `worker.ts`, or the new `feed.ts` (enforced by `tests/persuade/tenant-boundary.test.ts`).
- The world is handed only to `targetReply`. `tests/persuade/world-isolation.test.ts` asserts the literal text `targetReply(persona, plan, turns, world)` in `simulation.ts`; do not change that call.
- Cap check is fail-closed: if today's count cannot be read, the tick throws.
- Defaults: cap `1000`, batch `8`, concurrency `4`, low water `50`, refill chunk `200`, breaker window `60` minutes, breaker minimum `20` samples, breaker trips when failed/total `> 0.8`.
- Cron: `*/10 * * * *`.
- Migrations: `supabase migration list --linked` before `supabase db push --linked`, run from `eran-task`. Pushing to the linked project requires explicit approval from the user in the session, every time.
- Full gate before any commit that ends a task: `pnpm lint:fix` then `pnpm ci` (Biome, `tsc --noEmit`, Vitest) in minene. `biome ci` fails on formatting, and the code blocks in this plan are not guaranteed to match Biome's line width, so always format first. Wherever a step below says `pnpm ci`, run `pnpm lint:fix` immediately before it.

## File Map

**eran-task**
- Create `supabase/migrations/20260917100000_simulation_feed.sql`: `simulation_feed` table + seed row, `commit_simulation_feed_chunk` function, `simulation_jobs.pass`, `simulations.pass`, `simulations.usage`, index `simulation_jobs (status, updated_at)`.
- Create `supabase/verify/20260917100000_simulation_feed.sql`: assertions for the function, run inside a rolled-back transaction.

**minene**
- Create `src/persuade/engine/usage.ts`: usage meter and `AsyncLocalStorage` scope.
- Modify `src/persuade/engine/turn.ts:125`, `src/persuade/engine/target.ts:18-25`, `src/persuade/engine/score.ts` (the `generateObject` call): record usage.
- Create `src/persuade/lib/pool.ts`: bounded concurrency.
- Create `src/persuade/lib/breaker.ts`: failure-rate verdict + recent outcomes read.
- Create `src/persuade/lib/worker-settings.ts`: env parsing.
- Create `src/persuade/lib/feed.ts`: pairing, enumeration, refill.
- Modify `src/persuade/lib/experiments.ts:46-58`: `QueuedJob.pass?`.
- Rewrite `src/persuade/lib/worker.ts`: `tick` with injected collaborators, `runJob` with meter and pass.
- Modify `vercel.json`, `.env.example:61`, `CLAUDE.md` (simulation loop section), `src/persuade/lib/simulations.ts:114` (comment only).
- Tests: `tests/persuade/usage.test.ts`, `tests/persuade/pool.test.ts`, `tests/persuade/breaker.test.ts`, `tests/persuade/worker-settings.test.ts`, `tests/persuade/feed-plan.test.ts`, `tests/persuade/feed-refill.test.ts`, `tests/persuade/worker.test.ts`; extend `tests/persuade/tenant-boundary.test.ts`.

---

### Task 0: Branches and baseline

**Files:** none

- [ ] **Step 1: Confirm minene branch and a green baseline**

```bash
cd /Users/itayostraich/Documents/GitHub/minene
git branch --show-current   # expect: feat/simulation-scale-and-training
pnpm ci
```
Expected: Biome clean, tsc clean, `Test Files 38 passed`, `Tests 351 passed` (or more if main moved). If anything fails before you change code, stop and report it.

- [ ] **Step 2: Create the eran-task branch**

```bash
cd /Users/itayostraich/Documents/GitHub/eran-task
git status -sb        # expect: ## main...origin/main, clean
git pull --ff-only
git switch -c feat/simulation-feed
```

---

### Task 1: Migration and its verification

**Files:**
- Create: `eran-task/supabase/migrations/20260917100000_simulation_feed.sql`
- Create: `eran-task/supabase/verify/20260917100000_simulation_feed.sql`

**Interfaces:**
- Produces (database):
  - `public.simulation_feed(id smallint pk check id=1, next_index int not null, pass int not null, inputs_version text null, refilled_at timestamptz null)`, one row `(1, 0, 0, null, null)`.
  - `public.commit_simulation_feed_chunk(p_expected_index int, p_expected_pass int, p_expected_version text, p_new_index int, p_new_pass int, p_new_version text, p_jobs jsonb) returns boolean`, `service_role` only.
  - `public.simulation_jobs.pass int null`, `public.simulations.pass int null`, `public.simulations.usage jsonb null`.

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260917100000_simulation_feed.sql`:

```sql
-- The loop that keeps the simulation queue full.
--
-- The worker has been idle since 2026-08-29 because nothing queues work: every
-- job is `done` and the only way to add more is a person calling queueSweep by
-- hand. At 1,000 runs a day the queue has to refill itself, and it has to do it
-- from several overlapping cron ticks without queueing the same cells twice.
--
-- The enumeration (pairs x world cells, golden-stride order) lives in minene's
-- TypeScript, and supabase-js cannot hold a transaction open across calls. So
-- this is a compare-and-set: the caller says which position it planned from and
-- hands over the jobs; the function locks the row, refuses if the position has
-- moved, and otherwise inserts the jobs and advances the position in the same
-- transaction. A failed insert therefore never advances past cells nobody
-- queued.

create table public.simulation_feed (
  id smallint primary key check (id = 1),
  -- Not `cursor`: that is a PL/pgSQL keyword, and a column named after one is a
  -- parse error waiting inside the function below.
  next_index int not null default 0 check (next_index >= 0),
  pass int not null default 0 check (pass >= 0),
  -- A hash of the (persona, plan) pairs and the world count the index refers
  -- to. When it changes, the index means nothing any more and restarts at 0.
  inputs_version text null,
  refilled_at timestamptz null
);

insert into public.simulation_feed (id) values (1);

comment on table public.simulation_feed is
  'Where the self-refilling simulation queue is up to. One row. Advanced only by '
  'commit_simulation_feed_chunk, never written directly.';

alter table public.simulation_feed enable row level security;
revoke all on public.simulation_feed from anon, authenticated;
grant select on public.simulation_feed to service_role;

-- Which pass over the enumeration queued a job. Null on jobs queued by hand or
-- before this migration, which is the truth about them.
alter table public.simulation_jobs add column pass int null check (pass is null or pass >= 0);
alter table public.simulations add column pass int null check (pass is null or pass >= 0);

-- Tokens per role for one run: {"persuader":{"input":n,"output":n},"target":...,"judge":...}.
-- Null on rows written before this migration: unknown, not zero.
alter table public.simulations add column usage jsonb null;

comment on column public.simulations.usage is
  'Token counts by model role for this run. Null means not recorded, not free.';

-- The circuit breaker reads finished jobs by recency.
create index simulation_jobs_status_updated_idx
  on public.simulation_jobs (status, updated_at);

create or replace function public.commit_simulation_feed_chunk(
  p_expected_index int,
  p_expected_pass int,
  p_expected_version text,
  p_new_index int,
  p_new_pass int,
  p_new_version text,
  p_jobs jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.simulation_feed;
begin
  select * into f from public.simulation_feed where id = 1 for update;
  if not found then
    raise exception 'simulation_feed has no row';
  end if;

  -- Another tick refilled first. Writing nothing is the correct outcome, not an
  -- error: the queue is full, which is what this tick wanted.
  if f.next_index <> p_expected_index
     or f.pass <> p_expected_pass
     or f.inputs_version is distinct from p_expected_version then
    return false;
  end if;

  insert into public.simulation_jobs (
    experiment, variant, persona_key, plan_key, industry, segment,
    job_role_id, need, rules, world, pass
  )
  select
    x.experiment, x.variant, x.persona_key, x.plan_key, x.industry, x.segment,
    x.job_role_id, x.need, x.rules, x.world, x.pass
  from jsonb_populate_recordset(null::public.simulation_jobs, p_jobs) as x;

  update public.simulation_feed
  set next_index = p_new_index,
      pass = p_new_pass,
      inputs_version = p_new_version,
      refilled_at = now()
  where id = 1;

  return true;
end;
$$;

revoke all on function public.commit_simulation_feed_chunk(int, int, text, int, int, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_simulation_feed_chunk(int, int, text, int, int, text, jsonb)
  to service_role;

comment on function public.commit_simulation_feed_chunk is
  'Compare-and-set refill: inserts p_jobs and advances simulation_feed only if '
  'the feed is still at the expected position. service_role only: queued jobs '
  'spend model budget.';
```

- [ ] **Step 2: Write the verification script**

`supabase/verify/20260917100000_simulation_feed.sql`. It is concatenated after the migration inside `begin; ... rollback;`, so it runs against the fresh seed row and leaves nothing behind.

```sql
do $$
declare
  ok boolean;
  n int;
  job jsonb := '[{"persona_key":"verify-persona","plan_key":"verify-plan","industry":"retail","rules":{},"need":"no_value","pass":0}]';
begin
  -- A stale expectation writes nothing.
  select public.commit_simulation_feed_chunk(5, 0, null, 6, 0, 'v1', job) into ok;
  if ok then raise exception 'stale index should return false'; end if;

  select count(*) into n from public.simulation_jobs where persona_key = 'verify-persona';
  if n <> 0 then raise exception 'stale index inserted % jobs', n; end if;

  if (select next_index from public.simulation_feed where id = 1) <> 0 then
    raise exception 'stale index moved the feed';
  end if;

  -- A version mismatch writes nothing either.
  select public.commit_simulation_feed_chunk(0, 0, 'other', 1, 0, 'v1', job) into ok;
  if ok then raise exception 'stale version should return false'; end if;

  -- A matching expectation inserts and advances together.
  select public.commit_simulation_feed_chunk(0, 0, null, 1, 0, 'v1', job) into ok;
  if not ok then raise exception 'matching expectation should return true'; end if;

  select count(*) into n from public.simulation_jobs
  where persona_key = 'verify-persona' and pass = 0 and status = 'pending';
  if n <> 1 then raise exception 'expected 1 pending job, found %', n; end if;

  if (select next_index from public.simulation_feed where id = 1) <> 1
     or (select inputs_version from public.simulation_feed where id = 1) <> 'v1' then
    raise exception 'feed did not advance';
  end if;

  -- The same expectation again is now stale.
  select public.commit_simulation_feed_chunk(0, 0, null, 2, 0, 'v1', job) into ok;
  if ok then raise exception 'replayed commit should return false'; end if;

  raise notice 'simulation_feed verification passed';
end;
$$;
```

- [ ] **Step 3: Run the verification (requires user approval)**

This executes against the linked project inside a transaction that is always rolled back. Ask the user before running it. If Docker is running locally, prefer `supabase start` + `supabase db reset` and run the verify file with `supabase db query --local -f` instead, which needs no approval.

```bash
cd /Users/itayostraich/Documents/GitHub/eran-task
out=/private/tmp/claude-501/verify_simulation_feed.sql
{ echo 'begin;'; cat supabase/migrations/20260917100000_simulation_feed.sql; cat supabase/verify/20260917100000_simulation_feed.sql; echo 'rollback;'; } > "$out"
supabase db query --linked -f "$out"
```
If the CLI reports that the project is not linked, add `--project-ref zibpqbrfvxmkqnwmiboo` to this command and the one below; do not run `supabase link` in this task.
Expected: no error (the notice may not be echoed). Any `raise exception` text in the output is a failure: fix the migration and rerun. If the endpoint rejects multi-statement input, stop and report; do not split the file and run the pieces separately, because that would apply the migration for real.

Then confirm nothing leaked:

```bash
supabase db query --linked "select to_regclass('public.simulation_feed') as feed_table"
```
Expected: `feed_table` is `null`.

- [ ] **Step 4: Commit (eran-task)**

```bash
git add supabase/migrations/20260917100000_simulation_feed.sql supabase/verify/20260917100000_simulation_feed.sql
git commit -m "feat: a simulation queue that refills itself

simulation_feed and a compare-and-set commit so overlapping cron ticks
cannot queue the same cells twice; pass and usage on runs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Do not push the migration yet. That happens in Task 9, after the code that uses it is merged.

---

### Task 2: Usage meter

**Files:**
- Create: `src/persuade/engine/usage.ts`
- Modify: `src/persuade/engine/turn.ts` (inside `persuaderTurn`)
- Modify: `src/persuade/engine/target.ts` (inside `targetReply`)
- Modify: `src/persuade/engine/score.ts` (inside `scoreRun`)
- Test: `tests/persuade/usage.test.ts`

**Interfaces:**
- Produces:
  - `type UsageRole = 'persuader' | 'target' | 'judge'`
  - `interface TokenCount { input: number; output: number }`
  - `type UsageTotals = Record<UsageRole, TokenCount>`
  - `interface UsageMeter { record(role: UsageRole, usage: ReportedUsage | undefined): void; totals(): UsageTotals }`
  - `interface ReportedUsage { inputTokens?: number | undefined; outputTokens?: number | undefined }`
  - `createUsageMeter(): UsageMeter`
  - `withUsageMeter<T>(meter: UsageMeter, work: () => Promise<T>): Promise<T>`
  - `recordUsage(role: UsageRole, usage: ReportedUsage | undefined): void` (no-op outside a meter scope)

- [ ] **Step 1: Write the failing test**

`tests/persuade/usage.test.ts`:

```ts
/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, test } from 'vitest'
import { scoreRun } from '../../src/persuade/engine/score'
import { runSimulation } from '../../src/persuade/engine/simulation'
import type { Run } from '../../src/persuade/engine/types'
import {
  createUsageMeter,
  recordUsage,
  withUsageMeter,
} from '../../src/persuade/engine/usage'
import { setModelOverrides } from '../../src/persuade/lib/model'
import { jsonModel, scriptedAgreement, TEST_PERSONA, TEST_PLAN } from './helpers'

afterEach(() => setModelOverrides({}))

const SCORE = {
  persuaded: 'yes',
  winningArgument: null,
  winningCategory: null,
  mainObjection: null,
  whatBrokeIt: null,
  whatFailed: null,
  grade: 80,
  notes: 'בסדר',
}

describe('usage meter', () => {
  test('sums every model call in a run, judge included', async () => {
    // Every scripted call reports 10 input and 10 output tokens.
    setModelOverrides({ ...scriptedAgreement(), judge: jsonModel([SCORE]) })
    const meter = createUsageMeter()

    await withUsageMeter(meter, async () => {
      let run: Run | null = null
      for await (const event of runSimulation({ plan: TEST_PLAN, persona: TEST_PERSONA })) {
        if (event.type === 'done') run = event.run
      }
      if (!run) throw new Error('no run')
      await scoreRun(run.plan, run.turns, run.state, run.violations)
    })

    // scriptedAgreement ends after one persuader turn and one reply.
    expect(meter.totals()).toEqual({
      persuader: { input: 10, output: 10 },
      target: { input: 10, output: 10 },
      judge: { input: 10, output: 10 },
    })
  })

  test('keeps concurrent runs apart', async () => {
    const a = createUsageMeter()
    const b = createUsageMeter()
    const tickThenRecord = async (tokens: number) => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      recordUsage('persuader', { inputTokens: tokens, outputTokens: tokens })
    }

    await Promise.all([
      withUsageMeter(a, () => tickThenRecord(1)),
      withUsageMeter(b, () => tickThenRecord(5)),
    ])

    expect(a.totals().persuader).toEqual({ input: 1, output: 1 })
    expect(b.totals().persuader).toEqual({ input: 5, output: 5 })
  })

  test('recording outside a meter is a no-op, so the chat route is unaffected', () => {
    expect(() => recordUsage('target', { inputTokens: 3, outputTokens: 3 })).not.toThrow()
  })

  test('treats missing counts as zero rather than NaN', () => {
    const meter = createUsageMeter()
    meter.record('judge', { inputTokens: undefined, outputTokens: 4 })
    meter.record('judge', undefined)
    expect(meter.totals().judge).toEqual({ input: 0, output: 4 })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/persuade/usage.test.ts`
Expected: FAIL, `Failed to resolve import "../../src/persuade/engine/usage"`.

- [ ] **Step 3: Implement the meter**

`src/persuade/engine/usage.ts`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Tokens spent by one run, by role.
 *
 * Carried in AsyncLocalStorage rather than threaded through every signature,
 * for two reasons. The worker runs several simulations concurrently in one
 * process, so a module-level counter would mix them. And persuaderTurn,
 * targetReply and scoreRun are guarded by source-text tests
 * (world-isolation, tenant-boundary) that pin their call sites: adding a meter
 * parameter would mean loosening a security assertion to count tokens.
 *
 * Outside a scope, recording is a no-op, so the chat route pays nothing.
 */

export type UsageRole = 'persuader' | 'target' | 'judge'

export interface TokenCount {
  input: number
  output: number
}

export type UsageTotals = Record<UsageRole, TokenCount>

/** The subset of the AI SDK's LanguageModelUsage this reads. Counts can be absent. */
export interface ReportedUsage {
  inputTokens?: number | undefined
  outputTokens?: number | undefined
}

export interface UsageMeter {
  record(role: UsageRole, usage: ReportedUsage | undefined): void
  totals(): UsageTotals
}

const zero = (): TokenCount => ({ input: 0, output: 0 })

export function createUsageMeter(): UsageMeter {
  let totals: UsageTotals = { persuader: zero(), target: zero(), judge: zero() }

  return {
    record(role, usage) {
      const current = totals[role]
      totals = {
        ...totals,
        [role]: {
          input: current.input + (usage?.inputTokens ?? 0),
          output: current.output + (usage?.outputTokens ?? 0),
        },
      }
    },
    totals: () => totals,
  }
}

const scope = new AsyncLocalStorage<UsageMeter>()

export function withUsageMeter<T>(meter: UsageMeter, work: () => Promise<T>): Promise<T> {
  return scope.run(meter, work)
}

export function recordUsage(role: UsageRole, usage: ReportedUsage | undefined): void {
  scope.getStore()?.record(role, usage)
}
```

- [ ] **Step 4: Record usage at the three call sites**

In `src/persuade/engine/turn.ts`, add the import beside the others:

```ts
import { recordUsage } from './usage'
```

and change the body of `persuaderTurn` from:

```ts
  const { object } = await generateObject(call)
  return gradeTurn(object, plan, turns, workingState, rules)
```

to:

```ts
  const { object, usage } = await generateObject(call)
  recordUsage('persuader', usage)
  return gradeTurn(object, plan, turns, workingState, rules)
```

In `src/persuade/engine/target.ts`, add `import { recordUsage } from './usage'` and change:

```ts
  const { text } = await generateText({
    model: model('target'),
    system: targetSystemPrompt(persona, plan, world),
    messages: historyForTarget(turns),
    ...callOptions('target'),
  })
  return text.trim()
```

to:

```ts
  const { text, usage } = await generateText({
    model: model('target'),
    system: targetSystemPrompt(persona, plan, world),
    messages: historyForTarget(turns),
    ...callOptions('target'),
  })
  recordUsage('target', usage)
  return text.trim()
```

In `src/persuade/engine/score.ts`, add `import { recordUsage } from './usage'`, change `const { object } = await generateObject({` to `const { object, usage } = await generateObject({`, and immediately before `return { ...object, interactionsUsed: state.interaction }` add:

```ts
  recordUsage('judge', usage)
```

- [ ] **Step 5: Run the new test and the engine tests**

Run: `pnpm vitest run tests/persuade/usage.test.ts tests/persuade/simulation.test.ts tests/persuade/turn.test.ts tests/persuade/world-isolation.test.ts tests/persuade/tenant-boundary.test.ts`
Expected: all PASS.

- [ ] **Step 6: Full gate and commit**

```bash
pnpm ci
git add src/persuade/engine/usage.ts src/persuade/engine/turn.ts src/persuade/engine/target.ts src/persuade/engine/score.ts tests/persuade/usage.test.ts
git commit -m "feat: count the tokens each simulation spends, by role

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Bounded pool, breaker, and worker settings

Three small pure units the tick needs. Grouped because each is a few lines and none is useful without the tick; each still gets its own test file.

**Files:**
- Create: `src/persuade/lib/pool.ts`
- Create: `src/persuade/lib/breaker.ts`
- Create: `src/persuade/lib/worker-settings.ts`
- Test: `tests/persuade/pool.test.ts`, `tests/persuade/breaker.test.ts`, `tests/persuade/worker-settings.test.ts`

**Interfaces:**
- Produces:
  - `runPool<T, R>(items: readonly T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]>` (results in input order; `work` must not throw, and if it does the pool rejects)
  - `interface BreakerSettings { windowMinutes: number; minSamples: number; failRatio: number }`
  - `const DEFAULT_BREAKER: BreakerSettings` = `{ windowMinutes: 60, minSamples: 20, failRatio: 0.8 }`
  - `type BreakerVerdict = { open: false } | { open: true; failed: number; total: number }`
  - `breakerVerdict(statuses: readonly string[], settings: BreakerSettings): BreakerVerdict`
  - `readRecentOutcomes(client: SupabaseClient, settings?: BreakerSettings, now?: Date): Promise<string[]>`
  - `interface WorkerSettings { dailyCap: number; batch: number; concurrency: number; lowWater: number; refillChunk: number }`
  - `workerSettings(env?: Record<string, string | undefined>): WorkerSettings` (throws on a non-positive-integer value)

- [ ] **Step 1: Write the failing tests**

`tests/persuade/pool.test.ts`:

```ts
/**
 * @vitest-environment node
 */
import { describe, expect, test } from 'vitest'
import { runPool } from '../../src/persuade/lib/pool'

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('runPool', () => {
  test('never runs more than the concurrency at once', async () => {
    let active = 0
    let peak = 0
    await runPool([1, 2, 3, 4, 5, 6, 7, 8], 4, async () => {
      active += 1
      peak = Math.max(peak, active)
      await pause(5)
      active -= 1
    })
    expect(peak).toBe(4)
  })

  test('returns results in input order, whatever order they finish in', async () => {
    const results = await runPool([30, 10, 20], 3, async (ms) => {
      await pause(ms)
      return ms
    })
    expect(results).toEqual([30, 10, 20])
  })

  test('handles an empty batch and a concurrency larger than the batch', async () => {
    expect(await runPool([], 4, async () => 1)).toEqual([])
    expect(await runPool([1], 10, async (n) => n * 2)).toEqual([2])
  })
})
```

`tests/persuade/breaker.test.ts`:

```ts
/**
 * @vitest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, test } from 'vitest'
import { breakerVerdict, DEFAULT_BREAKER, readRecentOutcomes } from '../../src/persuade/lib/breaker'

const statuses = (failed: number, done: number) => [
  ...Array.from({ length: failed }, () => 'failed'),
  ...Array.from({ length: done }, () => 'done'),
]

describe('breakerVerdict', () => {
  test('trips when more than 80% of at least 20 finished jobs failed', () => {
    expect(breakerVerdict(statuses(17, 3), DEFAULT_BREAKER)).toEqual({ open: true, failed: 17, total: 20 })
  })

  test('does not trip at exactly 80%', () => {
    expect(breakerVerdict(statuses(16, 4), DEFAULT_BREAKER)).toEqual({ open: false })
  })

  test('does not trip below the minimum sample, however bad it looks', () => {
    expect(breakerVerdict(statuses(19, 0), DEFAULT_BREAKER)).toEqual({ open: false })
  })
})

describe('readRecentOutcomes', () => {
  test('reads finished jobs inside the window and fails closed on error', async () => {
    const calls: unknown[] = []
    const ok = {
      from: () => ({
        select: () => ({
          in: (_c: string, values: string[]) => ({
            gte: (_col: string, since: string) => ({
              limit: async () => {
                calls.push({ values, since })
                return { data: [{ status: 'done' }, { status: 'failed' }], error: null }
              },
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    const now = new Date('2026-09-17T12:00:00.000Z')
    expect(await readRecentOutcomes(ok, DEFAULT_BREAKER, now)).toEqual(['done', 'failed'])
    expect(calls).toEqual([{ values: ['done', 'failed'], since: '2026-09-17T11:00:00.000Z' }])

    const broken = {
      from: () => ({
        select: () => ({
          in: () => ({ gte: () => ({ limit: async () => ({ data: null, error: { message: 'down' } }) }) }),
        }),
      }),
    } as unknown as SupabaseClient
    await expect(readRecentOutcomes(broken, DEFAULT_BREAKER, now)).rejects.toThrow('down')
  })
})
```

`tests/persuade/worker-settings.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { workerSettings } from '../../src/persuade/lib/worker-settings'

describe('workerSettings', () => {
  test('defaults when nothing is set', () => {
    expect(workerSettings({})).toEqual({
      dailyCap: 1000,
      batch: 8,
      concurrency: 4,
      lowWater: 50,
      refillChunk: 200,
    })
  })

  test('reads each variable', () => {
    expect(
      workerSettings({
        PERSUADER_DAILY_RUN_CAP: '200',
        PERSUADER_TICK_BATCH: '6',
        PERSUADER_TICK_CONCURRENCY: '2',
        PERSUADER_QUEUE_LOW_WATER: '10',
        PERSUADER_REFILL_CHUNK: '40',
      }),
    ).toEqual({ dailyCap: 200, batch: 6, concurrency: 2, lowWater: 10, refillChunk: 40 })
  })

  test('refuses a value that is not a positive integer rather than guessing', () => {
    expect(() => workerSettings({ PERSUADER_DAILY_RUN_CAP: 'lots' })).toThrow('PERSUADER_DAILY_RUN_CAP')
    expect(() => workerSettings({ PERSUADER_TICK_CONCURRENCY: '0' })).toThrow('PERSUADER_TICK_CONCURRENCY')
    expect(() => workerSettings({ PERSUADER_TICK_BATCH: '2.5' })).toThrow('PERSUADER_TICK_BATCH')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/persuade/pool.test.ts tests/persuade/breaker.test.ts tests/persuade/worker-settings.test.ts`
Expected: FAIL, three unresolved imports.

- [ ] **Step 3: Implement**

`src/persuade/lib/pool.ts`:

```ts
/**
 * Runs `work` over `items`, at most `concurrency` at a time.
 *
 * Not Promise.all over the batch: eight simulations at once is eight
 * simultaneous persuader calls, and the provider's rate limit is the thing that
 * actually decides how many can run. The number is an env var so it can be
 * turned down without a deploy.
 *
 * `work` is expected to settle its own failures. A rejection here rejects the
 * whole pool, which in the worker would leave the rest of the batch `running`
 * until the stale-claim window re-offers it.
 */
export async function runPool<T, R>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0

  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await work(items[index] as T)
    }
  }

  const lanes = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: lanes }, lane))
  return results
}
```

`src/persuade/lib/breaker.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Stops the loop when runs are failing, before it spends a day's cap on them.
 *
 * At 1,000 runs a day a broken deploy, a revoked key or an exhausted quota
 * fails every job, and a failed job can still have paid for ten model calls
 * before the judge threw. The cap bounds the damage to a day; this bounds it to
 * about an hour.
 *
 * It closes on its own: as the window moves past the failures, the verdict
 * reads the successes that came before and after them.
 */

export interface BreakerSettings {
  windowMinutes: number
  minSamples: number
  failRatio: number
}

export const DEFAULT_BREAKER: BreakerSettings = {
  windowMinutes: 60,
  minSamples: 20,
  failRatio: 0.8,
}

export type BreakerVerdict = { open: false } | { open: true; failed: number; total: number }

export function breakerVerdict(statuses: readonly string[], settings: BreakerSettings): BreakerVerdict {
  const total = statuses.length
  if (total < settings.minSamples) return { open: false }
  const failed = statuses.filter((status) => status === 'failed').length
  return failed / total > settings.failRatio ? { open: true, failed, total } : { open: false }
}

/** Statuses of jobs that finished inside the window. Throws rather than reporting an empty window. */
export async function readRecentOutcomes(
  client: SupabaseClient,
  settings: BreakerSettings = DEFAULT_BREAKER,
  now: Date = new Date(),
): Promise<string[]> {
  const since = new Date(now.getTime() - settings.windowMinutes * 60_000).toISOString()
  const { data, error } = await client
    .from('simulation_jobs')
    .select('status')
    .in('status', ['done', 'failed'])
    .gte('updated_at', since)
    .limit(1000)

  // An unreadable window is not an empty one. Failing closed costs one tick.
  if (error) throw new Error(`בדיקת המפסק נכשלה: ${error.message}`)
  return ((data ?? []) as { status: string }[]).map((row) => row.status)
}
```

`src/persuade/lib/worker-settings.ts`:

```ts
/**
 * The worker's knobs, read once per tick.
 *
 * A value that is set but unreadable throws instead of falling back to the
 * default. The default cap is 1,000; a typo in PERSUADER_DAILY_RUN_CAP that
 * silently meant 1,000 would be the most expensive kind of typo.
 */

export interface WorkerSettings {
  dailyCap: number
  batch: number
  concurrency: number
  lowWater: number
  refillChunk: number
}

const DEFAULTS: Record<string, number> = {
  PERSUADER_DAILY_RUN_CAP: 1000,
  PERSUADER_TICK_BATCH: 8,
  PERSUADER_TICK_CONCURRENCY: 4,
  PERSUADER_QUEUE_LOW_WATER: 50,
  PERSUADER_REFILL_CHUNK: 200,
}

function positiveInt(env: Record<string, string | undefined>, name: string): number {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return DEFAULTS[name] as number
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} חייב להיות מספר שלם חיובי, התקבל "${raw}"`)
  }
  return value
}

export function workerSettings(env: Record<string, string | undefined> = process.env): WorkerSettings {
  return {
    dailyCap: positiveInt(env, 'PERSUADER_DAILY_RUN_CAP'),
    batch: positiveInt(env, 'PERSUADER_TICK_BATCH'),
    concurrency: positiveInt(env, 'PERSUADER_TICK_CONCURRENCY'),
    lowWater: positiveInt(env, 'PERSUADER_QUEUE_LOW_WATER'),
    refillChunk: positiveInt(env, 'PERSUADER_REFILL_CHUNK'),
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/persuade/pool.test.ts tests/persuade/breaker.test.ts tests/persuade/worker-settings.test.ts`
Expected: all PASS.

- [ ] **Step 5: Full gate and commit**

```bash
pnpm ci
git add src/persuade/lib/pool.ts src/persuade/lib/breaker.ts src/persuade/lib/worker-settings.ts tests/persuade/pool.test.ts tests/persuade/breaker.test.ts tests/persuade/worker-settings.test.ts
git commit -m "feat: bounded pool, failure breaker and settings for the worker

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Feed enumeration (pure)

**Files:**
- Create: `src/persuade/lib/feed.ts` (pure part only in this task)
- Modify: `src/persuade/lib/experiments.ts` (`QueuedJob`)
- Test: `tests/persuade/feed-plan.test.ts`

**Interfaces:**
- Consumes: `goldenStride(n: number): number` and `QueuedJob` from `src/persuade/lib/experiments.ts`; `worldCells(): WorldCell[]`, `buildWorld(cell: WorldCell): WorldState` from `src/persuade/engine/world.ts`; `DEFAULT_RULES` from `src/persuade/engine/rules.ts`.
- Produces:
  - `interface FeedInput { key: string; industry: string; jobRoleName: string | null }`
  - `interface FeedPair { personaKey: string; planKey: string; industry: string }`
  - `interface FeedPosition { pairIndex: number; worldIndex: number; pass: number }`
  - `interface FeedChunk { positions: FeedPosition[]; nextIndex: number; pass: number }`
  - `pairInputs(personas: readonly FeedInput[], plans: readonly FeedInput[]): { pairs: FeedPair[]; unpairedPersonas: string[] }`
  - `inputsVersion(pairs: readonly FeedPair[], worldCount: number): string` (16 hex chars)
  - `planChunk(from: { nextIndex: number; pass: number }, pairCount: number, worldCount: number, take: number): FeedChunk`
  - `jobsForChunk(chunk: FeedChunk, pairs: readonly FeedPair[], cells?: readonly WorldCell[]): QueuedJob[]`
  - `QueuedJob` gains `pass?: number | null`.

- [ ] **Step 1: Write the failing test**

`tests/persuade/feed-plan.test.ts`:

```ts
/**
 * @vitest-environment node
 */
import { describe, expect, test } from 'vitest'
import { DEFAULT_RULES } from '../../src/persuade/engine/rules'
import { worldCells } from '../../src/persuade/engine/world'
import {
  type FeedInput,
  inputsVersion,
  jobsForChunk,
  pairInputs,
  planChunk,
} from '../../src/persuade/lib/feed'

const persona = (key: string, industry: string, jobRoleName: string | null): FeedInput => ({
  key,
  industry,
  jobRoleName,
})

describe('pairInputs', () => {
  test('a plan with a target role meets only personas in that role and industry', () => {
    const { pairs, unpairedPersonas } = pairInputs(
      [
        persona('a', 'retail', 'מנהל חנות'),
        persona('b', 'retail', 'עובד / מוכר'),
        persona('c', 'bank', 'מנהל חנות'),
      ],
      [persona('plan-1', 'retail', 'מנהל חנות')],
    )
    expect(pairs).toEqual([{ personaKey: 'a', planKey: 'plan-1', industry: 'retail' }])
    expect(unpairedPersonas).toEqual(['b', 'c'])
  })

  test('a plan with no target role meets every persona in its industry', () => {
    // This is the manual `briefings` plan, and why the feed has work before
    // any content is generated.
    const { pairs } = pairInputs(
      [persona('yossi', 'retail', 'עובד מכירות ותיק'), persona('adi', 'retail', 'מנהלת'), persona('x', 'bank', null)],
      [persona('briefings', 'retail', null)],
    )
    expect(pairs.map((p) => p.personaKey)).toEqual(['adi', 'yossi'])
  })

  test('pair order does not depend on the order rows came back in', () => {
    const personas = [persona('b', 'retail', null), persona('a', 'retail', null)]
    const plans = [persona('p2', 'retail', null), persona('p1', 'retail', null)]
    expect(pairInputs(personas, plans).pairs).toEqual(
      pairInputs([...personas].reverse(), [...plans].reverse()).pairs,
    )
  })
})

describe('inputsVersion', () => {
  test('is stable under reordering and changes when pairs or the world count change', () => {
    const one = [
      { personaKey: 'a', planKey: 'p', industry: 'retail' },
      { personaKey: 'b', planKey: 'p', industry: 'retail' },
    ]
    expect(inputsVersion(one, 324)).toBe(inputsVersion([...one].reverse(), 324))
    expect(inputsVersion(one, 324)).toMatch(/^[0-9a-f]{16}$/)
    expect(inputsVersion(one, 324)).not.toBe(inputsVersion(one.slice(0, 1), 324))
    expect(inputsVersion(one, 324)).not.toBe(inputsVersion(one, 648))
  })
})

describe('planChunk', () => {
  test('walks every pair within a world before moving to the next world', () => {
    const chunk = planChunk({ nextIndex: 0, pass: 0 }, 2, 324, 3)
    expect(chunk.positions.map((p) => [p.pairIndex, p.worldIndex])).toEqual([
      [0, 0],
      [1, 0],
      [0, chunk.positions[2]?.worldIndex],
    ])
    expect(chunk.positions[2]?.worldIndex).not.toBe(0)
    expect(chunk.nextIndex).toBe(3)
    expect(chunk.pass).toBe(0)
  })

  test('resumes from the stored index', () => {
    const first = planChunk({ nextIndex: 0, pass: 0 }, 2, 324, 10)
    const second = planChunk({ nextIndex: first.nextIndex, pass: first.pass }, 2, 324, 10)
    const both = planChunk({ nextIndex: 0, pass: 0 }, 2, 324, 20)
    expect([...first.positions, ...second.positions]).toEqual(both.positions)
  })

  test('wraps at the end and counts the pass', () => {
    const total = 2 * 324
    const chunk = planChunk({ nextIndex: total - 1, pass: 3 }, 2, 324, 2)
    expect(chunk.positions.map((p) => p.pass)).toEqual([3, 4])
    expect(chunk.nextIndex).toBe(1)
    expect(chunk.pass).toBe(4)
  })

  test('one full pass visits every (pair, world) exactly once', () => {
    const chunk = planChunk({ nextIndex: 0, pass: 0 }, 2, 324, 2 * 324)
    const seen = new Set(chunk.positions.map((p) => `${p.pairIndex}:${p.worldIndex}`))
    expect(seen.size).toBe(648)
    expect(chunk.nextIndex).toBe(0)
    expect(chunk.pass).toBe(1)
  })

  test('never takes more than one pass in a single chunk', () => {
    expect(planChunk({ nextIndex: 0, pass: 0 }, 1, 324, 10_000).positions).toHaveLength(324)
  })

  test('an empty space yields nothing', () => {
    expect(planChunk({ nextIndex: 0, pass: 2 }, 0, 324, 50)).toEqual({ positions: [], nextIndex: 0, pass: 2 })
  })
})

describe('jobsForChunk', () => {
  test('builds queue rows with the world, its reason and the pass', () => {
    const pairs = [{ personaKey: 'adi', planKey: 'briefings', industry: 'retail' }]
    const cells = worldCells()
    const chunk = planChunk({ nextIndex: 0, pass: 1 }, 1, cells.length, 1)
    const [job] = jobsForChunk(chunk, pairs, cells)

    expect(job).toMatchObject({
      experiment: null,
      variant: null,
      persona_key: 'adi',
      plan_key: 'briefings',
      industry: 'retail',
      segment: null,
      job_role_id: null,
      need: cells[0]?.reason,
      rules: DEFAULT_RULES,
      pass: 1,
    })
    expect(job?.world).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/persuade/feed-plan.test.ts`
Expected: FAIL, `Failed to resolve import "../../src/persuade/lib/feed"`.

- [ ] **Step 3: Add `pass` to `QueuedJob`**

In `src/persuade/lib/experiments.ts`, inside `export interface QueuedJob { ... }`, after `world: WorldState | null`, add:

```ts
  /**
   * Which pass over the feed's enumeration queued this job. Absent on jobs
   * queued by an experiment or a hand sweep, which are not part of a pass.
   */
  pass?: number | null
```

- [ ] **Step 4: Implement the pure part of the feed**

`src/persuade/lib/feed.ts`:

```ts
import { createHash } from 'node:crypto'
import { DEFAULT_RULES } from '../engine/rules'
import { buildWorld, type WorldCell, worldCells } from '../engine/world'
import { goldenStride, type QueuedJob } from './experiments'

/**
 * What the self-refilling queue runs next.
 *
 * The space is (persona, plan) pairs times world cells. A position in it is a
 * single integer, so "where the feed is up to" is one number in one row and a
 * compare-and-set in Postgres can guard it.
 *
 * Within one world the pairs are consecutive; across worlds the order follows
 * the same golden-ratio stride planSweep uses, so a short stretch of the feed
 * spreads over every axis instead of marching down the innermost one.
 *
 * Reads no tenant data. The inputs are the lab's own personas and plans, and
 * tests/persuade/tenant-boundary.test.ts holds this file to that.
 */

export interface FeedInput {
  key: string
  industry: string
  /** The role a persona plays, or the role a plan asks of. Null on a plan means any role. */
  jobRoleName: string | null
}

export interface FeedPair {
  personaKey: string
  planKey: string
  industry: string
}

export interface FeedPosition {
  pairIndex: number
  worldIndex: number
  pass: number
}

export interface FeedChunk {
  positions: FeedPosition[]
  nextIndex: number
  pass: number
}

const byKey = (a: FeedInput, b: FeedInput) => a.key.localeCompare(b.key)

/**
 * A persona meets a plan only when the plan could be asked of them.
 *
 * A bank manager asked to run a retail morning briefing measures nothing about
 * persuasion. A plan with no target role (the hand-written `briefings`) is
 * general and meets everyone in its industry.
 */
export function pairInputs(
  personas: readonly FeedInput[],
  plans: readonly FeedInput[],
): { pairs: FeedPair[]; unpairedPersonas: string[] } {
  const sortedPersonas = [...personas].sort(byKey)
  const pairs = [...plans].sort(byKey).flatMap((plan) =>
    sortedPersonas
      .filter(
        (persona) =>
          persona.industry === plan.industry &&
          (plan.jobRoleName === null || persona.jobRoleName === plan.jobRoleName),
      )
      .map((persona) => ({ personaKey: persona.key, planKey: plan.key, industry: plan.industry })),
  )

  const paired = new Set(pairs.map((pair) => pair.personaKey))
  return {
    pairs,
    unpairedPersonas: sortedPersonas.filter((p) => !paired.has(p.key)).map((p) => p.key),
  }
}

/**
 * What a stored index refers to. Includes the world count because adding a
 * world axis changes the space without changing a single persona or plan.
 */
export function inputsVersion(pairs: readonly FeedPair[], worldCount: number): string {
  const canonical = pairs
    .map((pair) => `${pair.industry}:${pair.planKey}:${pair.personaKey}`)
    .sort()
    .join('\n')
  return createHash('sha256').update(`${worldCount}\n${canonical}`).digest('hex').slice(0, 16)
}

export function planChunk(
  from: { nextIndex: number; pass: number },
  pairCount: number,
  worldCount: number,
  take: number,
): FeedChunk {
  const total = pairCount * worldCount
  if (total === 0) return { positions: [], nextIndex: 0, pass: from.pass }

  const stride = goldenStride(worldCount)
  // Capped at one pass: a chunk larger than the space would queue the same
  // cell twice in one insert, which is a repeat nobody asked for yet.
  const count = Math.min(Math.max(0, take), total)

  const positions = Array.from({ length: count }, (_, offset): FeedPosition => {
    const absolute = from.nextIndex + offset
    const index = absolute % total
    return {
      pairIndex: index % pairCount,
      worldIndex: (Math.floor(index / pairCount) * stride) % worldCount,
      pass: from.pass + Math.floor(absolute / total),
    }
  })

  const end = from.nextIndex + count
  return { positions, nextIndex: end % total, pass: from.pass + Math.floor(end / total) }
}

export function jobsForChunk(
  chunk: FeedChunk,
  pairs: readonly FeedPair[],
  cells: readonly WorldCell[] = worldCells(),
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
      need: cell.reason,
      rules: DEFAULT_RULES,
      world: buildWorld(cell),
      pass: position.pass,
    }
  })
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/persuade/feed-plan.test.ts tests/persuade/experiments.test.ts`
Expected: all PASS.

- [ ] **Step 6: Full gate and commit**

```bash
pnpm ci
git add src/persuade/lib/feed.ts src/persuade/lib/experiments.ts tests/persuade/feed-plan.test.ts
git commit -m "feat: enumerate persona-plan pairs across worlds for the feed

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Feed refill (database edge)

**Files:**
- Modify: `src/persuade/lib/feed.ts` (append)
- Modify: `tests/persuade/tenant-boundary.test.ts` (extend the worker case)
- Test: `tests/persuade/feed-refill.test.ts`

**Interfaces:**
- Consumes: everything Task 4 produced; RPC `commit_simulation_feed_chunk` from Task 1.
- Produces:
  - `interface RefillSettings { lowWater: number; refillChunk: number }` (structurally satisfied by `WorkerSettings`)
  - `type FeedReport =`
    `| { status: 'enough'; pending: number }`
    `| { status: 'no-pairs'; pending: number; unpairedPersonas: string[] }`
    `| { status: 'queued'; pending: number; queued: number; nextIndex: number; pass: number; unpairedPersonas: string[] }`
    `| { status: 'lost-race'; pending: number }`
  - `refillFeed(client: SupabaseClient, settings: RefillSettings): Promise<FeedReport>`

- [ ] **Step 1: Write the failing test**

`tests/persuade/feed-refill.test.ts`:

```ts
/**
 * @vitest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, test } from 'vitest'
import { worldCells } from '../../src/persuade/engine/world'
import { inputsVersion, pairInputs, refillFeed } from '../../src/persuade/lib/feed'

interface Row {
  [key: string]: unknown
}

interface FakeState {
  pending: number
  personas: Row[]
  plans: Row[]
  feed: { next_index: number; pass: number; inputs_version: string | null } | null
  commitResult: boolean
}

/** Answers exactly the reads refillFeed makes, and records the commit it sends. */
function fakeClient(state: FakeState) {
  const commits: Record<string, unknown>[] = []
  const client = {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              if (table === 'simulation_jobs') return Promise.resolve({ count: state.pending, error: null })
              if (table === 'persuasion_personas') return Promise.resolve({ data: state.personas, error: null })
              if (table === 'persuasion_lab_plans') return Promise.resolve({ data: state.plans, error: null })
              return { maybeSingle: async () => ({ data: state.feed, error: null }) }
            },
          }
        },
      }
    },
    async rpc(_fn: string, args: Record<string, unknown>) {
      commits.push(args)
      return { data: state.commitResult, error: null }
    },
  } as unknown as SupabaseClient
  return { client, commits }
}

const PERSONAS = [
  { persona_key: 'adi', industry: 'retail', job_role_name: 'מנהלת חנות' },
  { persona_key: 'rona', industry: 'retail', job_role_name: 'מנהלת משמרת' },
  { persona_key: 'bank-1', industry: 'bank', job_role_name: 'בנקאי' },
]
const PLANS = [{ plan_key: 'briefings', industry: 'retail', job_role_name: null }]
const SETTINGS = { lowWater: 50, refillChunk: 5 }

const retailPairs = () =>
  pairInputs(
    [
      { key: 'adi', industry: 'retail', jobRoleName: 'מנהלת חנות' },
      { key: 'rona', industry: 'retail', jobRoleName: 'מנהלת משמרת' },
    ],
    [{ key: 'briefings', industry: 'retail', jobRoleName: null }],
  ).pairs

describe('refillFeed', () => {
  test('does nothing while the queue is above the low-water mark', async () => {
    const { client, commits } = fakeClient({
      pending: 50,
      personas: PERSONAS,
      plans: PLANS,
      feed: { next_index: 0, pass: 0, inputs_version: null },
      commitResult: true,
    })
    expect(await refillFeed(client, SETTINGS)).toEqual({ status: 'enough', pending: 50 })
    expect(commits).toHaveLength(0)
  })

  test('first refill plans from zero and reports personas with no plan', async () => {
    const { client, commits } = fakeClient({
      pending: 0,
      personas: PERSONAS,
      plans: PLANS,
      feed: { next_index: 0, pass: 0, inputs_version: null },
      commitResult: true,
    })

    const report = await refillFeed(client, SETTINGS)

    expect(report).toEqual({
      status: 'queued',
      pending: 0,
      queued: 5,
      nextIndex: 5,
      pass: 0,
      unpairedPersonas: ['bank-1'],
    })
    const [commit] = commits
    expect(commit).toMatchObject({
      p_expected_index: 0,
      p_expected_pass: 0,
      p_expected_version: null,
      p_new_index: 5,
      p_new_pass: 0,
      p_new_version: inputsVersion(retailPairs(), worldCells().length),
    })
    const jobs = commit?.p_jobs as { persona_key: string; pass: number }[]
    expect(jobs).toHaveLength(5)
    expect(new Set(jobs.map((j) => j.persona_key))).toEqual(new Set(['adi', 'rona']))
    expect(jobs.every((j) => j.pass === 0)).toBe(true)
  })

  test('resumes from the stored index when the inputs have not changed', async () => {
    const version = inputsVersion(retailPairs(), worldCells().length)
    const { client, commits } = fakeClient({
      pending: 3,
      personas: PERSONAS,
      plans: PLANS,
      feed: { next_index: 10, pass: 2, inputs_version: version },
      commitResult: true,
    })

    await refillFeed(client, SETTINGS)

    expect(commits[0]).toMatchObject({
      p_expected_index: 10,
      p_expected_pass: 2,
      p_expected_version: version,
      p_new_index: 15,
      p_new_pass: 2,
      p_new_version: version,
    })
  })

  test('restarts at zero when the inputs changed, but still expects the stored position', async () => {
    const { client, commits } = fakeClient({
      pending: 0,
      personas: PERSONAS,
      plans: PLANS,
      feed: { next_index: 99, pass: 3, inputs_version: 'old' },
      commitResult: true,
    })

    await refillFeed(client, SETTINGS)

    expect(commits[0]).toMatchObject({
      p_expected_index: 99,
      p_expected_pass: 3,
      p_expected_version: 'old',
      p_new_index: 5,
      p_new_pass: 0,
    })
  })

  test('reports a lost race when another tick committed first', async () => {
    const { client } = fakeClient({
      pending: 0,
      personas: PERSONAS,
      plans: PLANS,
      feed: { next_index: 0, pass: 0, inputs_version: null },
      commitResult: false,
    })
    expect(await refillFeed(client, SETTINGS)).toEqual({ status: 'lost-race', pending: 0 })
  })

  test('reports no pairs instead of committing an empty chunk', async () => {
    const { client, commits } = fakeClient({
      pending: 0,
      personas: [PERSONAS[2] as Row],
      plans: PLANS,
      feed: { next_index: 0, pass: 0, inputs_version: null },
      commitResult: true,
    })
    expect(await refillFeed(client, SETTINGS)).toEqual({
      status: 'no-pairs',
      pending: 0,
      unpairedPersonas: ['bank-1'],
    })
    expect(commits).toHaveLength(0)
  })

  test('throws when the feed row is missing, which means the migration is not applied', async () => {
    const { client } = fakeClient({
      pending: 0,
      personas: PERSONAS,
      plans: PLANS,
      feed: null,
      commitResult: true,
    })
    await expect(refillFeed(client, SETTINGS)).rejects.toThrow('simulation_feed')
  })
})
```

- [ ] **Step 2: Extend the tenant boundary test**

In `tests/persuade/tenant-boundary.test.ts`, inside `it('holds for the loop that runs simulations unattended', ...)`, after the three `expect(worker)...` lines, add:

```ts
    // The feed decides what the loop runs next, so it is part of the same loop.
    const feed = source('src/persuade/lib/feed.ts')
    expect(feed).not.toMatch(/ammunition/i)
    expect(feed).not.toMatch(/tenantId|tenant_id/)
    expect(feed).not.toMatch(/assignmentId|assignment_id/)
```

- [ ] **Step 3: Run them to see the refill test fail**

Run: `pnpm vitest run tests/persuade/feed-refill.test.ts tests/persuade/tenant-boundary.test.ts`
Expected: `feed-refill` FAIL with `refillFeed is not a function` (or an import error); `tenant-boundary` PASS.

- [ ] **Step 4: Implement the refill**

Append to `src/persuade/lib/feed.ts`, and add `import type { SupabaseClient } from '@supabase/supabase-js'` at the top of the file with the other imports:

```ts
export interface RefillSettings {
  lowWater: number
  refillChunk: number
}

export type FeedReport =
  | { status: 'enough'; pending: number }
  | { status: 'no-pairs'; pending: number; unpairedPersonas: string[] }
  | {
      status: 'queued'
      pending: number
      queued: number
      nextIndex: number
      pass: number
      unpairedPersonas: string[]
    }
  | { status: 'lost-race'; pending: number }

async function countPending(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .from('simulation_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (error) throw new Error(`ספירת התור נכשלה: ${error.message}`)
  return count ?? 0
}

async function readInputs(
  client: SupabaseClient,
  table: 'persuasion_personas' | 'persuasion_lab_plans',
  keyColumn: 'persona_key' | 'plan_key',
): Promise<FeedInput[]> {
  const { data, error } = await client
    .from(table)
    .select(`${keyColumn},industry,job_role_name`)
    .eq('is_active', true)
  if (error) throw new Error(`קריאת ${table} נכשלה: ${error.message}`)
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    key: String(row[keyColumn]),
    industry: String(row.industry),
    jobRoleName: (row.job_role_name as string | null | undefined) ?? null,
  }))
}

interface FeedRow {
  next_index: number
  pass: number
  inputs_version: string | null
}

async function readFeed(client: SupabaseClient): Promise<FeedRow> {
  const { data, error } = await client
    .from('simulation_feed')
    .select('next_index,pass,inputs_version')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(`קריאת simulation_feed נכשלה: ${error.message}`)
  if (!data) throw new Error('אין שורה ב-simulation_feed. המיגרציה לא הוחלה.')
  return data as FeedRow
}

/**
 * Tops the queue up when it runs low. Safe to call from overlapping ticks.
 *
 * The commit expects the position that was READ, even when the inputs changed
 * and planning restarted from zero: the guard is about what is stored, and two
 * ticks that both saw the old version must not both reset it.
 */
export async function refillFeed(client: SupabaseClient, settings: RefillSettings): Promise<FeedReport> {
  const pending = await countPending(client)
  if (pending >= settings.lowWater) return { status: 'enough', pending }

  const [personas, plans] = await Promise.all([
    readInputs(client, 'persuasion_personas', 'persona_key'),
    readInputs(client, 'persuasion_lab_plans', 'plan_key'),
  ])
  const { pairs, unpairedPersonas } = pairInputs(personas, plans)
  if (pairs.length === 0) return { status: 'no-pairs', pending, unpairedPersonas }

  const cells = worldCells()
  const stored = await readFeed(client)
  const version = inputsVersion(pairs, cells.length)
  const from = stored.inputs_version === version ? { nextIndex: stored.next_index, pass: stored.pass } : { nextIndex: 0, pass: 0 }

  const chunk = planChunk(from, pairs.length, cells.length, settings.refillChunk)
  const jobs = jobsForChunk(chunk, pairs, cells)

  const { data, error } = await client.rpc('commit_simulation_feed_chunk', {
    p_expected_index: stored.next_index,
    p_expected_pass: stored.pass,
    p_expected_version: stored.inputs_version,
    p_new_index: chunk.nextIndex,
    p_new_pass: chunk.pass,
    p_new_version: version,
    p_jobs: jobs,
  })
  if (error) throw new Error(`מילוי התור נכשל: ${error.message}`)
  if (data !== true) return { status: 'lost-race', pending }

  return {
    status: 'queued',
    pending,
    queued: jobs.length,
    nextIndex: chunk.nextIndex,
    pass: chunk.pass,
    unpairedPersonas,
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/persuade/feed-refill.test.ts tests/persuade/feed-plan.test.ts tests/persuade/tenant-boundary.test.ts`
Expected: all PASS.

- [ ] **Step 6: Full gate and commit**

```bash
pnpm ci
git add src/persuade/lib/feed.ts tests/persuade/feed-refill.test.ts tests/persuade/tenant-boundary.test.ts
git commit -m "feat: refill the simulation queue with a compare-and-set commit

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The tick

**Files:**
- Modify: `src/persuade/lib/worker.ts` (full replacement below)
- Test: `tests/persuade/worker.test.ts`

**Interfaces:**
- Consumes: `runPool` (Task 3), `breakerVerdict`, `readRecentOutcomes`, `DEFAULT_BREAKER` (Task 3), `workerSettings`, `WorkerSettings` (Task 3), `refillFeed`, `FeedReport` (Task 5), `createUsageMeter`, `withUsageMeter` (Task 2).
- Produces:
  - `interface JobRow` gains `pass: number | null`.
  - `interface TickDeps { settings: WorkerSettings; readOutcomes: (client: SupabaseClient) => Promise<string[]>; refill: (client: SupabaseClient, settings: WorkerSettings) => Promise<FeedReport>; runJob: (client: SupabaseClient, job: JobRow) => Promise<string> }`
  - `interface WorkerReport { claimed: number; completed: number; failed: number; stopped?: string; feed?: FeedReport | { status: 'error'; message: string } }`
  - `tick(client: SupabaseClient, deps?: Partial<TickDeps>): Promise<WorkerReport>` (route call `tick(supabase())` is unchanged)
  - `runJob(client: SupabaseClient, job: JobRow): Promise<string>` writes `usage` and `pass`.

- [ ] **Step 1: Write the failing test**

`tests/persuade/worker.test.ts`:

```ts
/**
 * @vitest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, test } from 'vitest'
import { DEFAULT_RULES } from '../../src/persuade/engine/rules'
import type { FeedReport } from '../../src/persuade/lib/feed'
import { type JobRow, type TickDeps, tick } from '../../src/persuade/lib/worker'
import type { WorkerSettings } from '../../src/persuade/lib/worker-settings'

const SETTINGS: WorkerSettings = { dailyCap: 1000, batch: 8, concurrency: 4, lowWater: 50, refillChunk: 200 }

const job = (id: string): JobRow => ({
  id,
  experiment: null,
  variant: null,
  persona_key: 'adi',
  plan_key: 'briefings',
  industry: 'retail',
  segment: null,
  job_role_id: null,
  need: null,
  rules: DEFAULT_RULES,
  world: null,
  attempts: 1,
  pass: 0,
})

/** Today's count, the claim RPC, and the per-job status updates: the three things tick touches directly. */
function fakeClient(today: number, claimable: JobRow[]) {
  const updates: { id: string; status: unknown; error: unknown }[] = []
  const claims: { p_limit: number }[] = []
  const client = {
    from: () => ({
      select: () => ({ gte: async () => ({ count: today, error: null }) }),
      update: (patch: Record<string, unknown>) => ({
        eq: async (_column: string, id: string) => {
          updates.push({ id, status: patch.status, error: patch.error })
          return { error: null }
        },
      }),
    }),
    rpc: async (_fn: string, args: { p_limit: number }) => {
      claims.push(args)
      return { data: claimable.slice(0, args.p_limit), error: null }
    },
  } as unknown as SupabaseClient
  return { client, updates, claims }
}

const quiet: FeedReport = { status: 'enough', pending: 100 }

const deps = (overrides: Partial<TickDeps> = {}): Partial<TickDeps> => ({
  settings: SETTINGS,
  readOutcomes: async () => [],
  refill: async () => quiet,
  runJob: async (_client, row) => `sim-${row.id}`,
  ...overrides,
})

describe('tick', () => {
  test('runs a claimed batch at most `concurrency` at a time', async () => {
    const { client, updates } = fakeClient(0, Array.from({ length: 8 }, (_, i) => job(`j${i}`)))
    let active = 0
    let peak = 0

    const report = await tick(
      client,
      deps({
        runJob: async (_c, row) => {
          active += 1
          peak = Math.max(peak, active)
          await new Promise((resolve) => setTimeout(resolve, 5))
          active -= 1
          return `sim-${row.id}`
        },
      }),
    )

    expect(peak).toBe(4)
    expect(report).toEqual({ claimed: 8, completed: 8, failed: 0, feed: quiet })
    expect(updates.filter((u) => u.status === 'done')).toHaveLength(8)
  })

  test('claims no more than the room left under the cap', async () => {
    const { client, claims } = fakeClient(997, Array.from({ length: 8 }, (_, i) => job(`j${i}`)))
    const report = await tick(client, deps())
    expect(claims).toEqual([{ p_limit: 3, p_stale_minutes: 30 }])
    expect(report.claimed).toBe(3)
  })

  test('stops at the cap without refilling or claiming', async () => {
    const { client, claims } = fakeClient(1000, [job('j0')])
    let refilled = false
    const report = await tick(client, deps({ refill: async () => { refilled = true; return quiet } }))
    expect(report).toEqual({ claimed: 0, completed: 0, failed: 0, stopped: 'תקרה יומית: 1000/1000' })
    expect(claims).toHaveLength(0)
    expect(refilled).toBe(false)
  })

  test('the breaker stops the tick before it claims anything', async () => {
    const { client, claims } = fakeClient(0, [job('j0')])
    const report = await tick(
      client,
      deps({ readOutcomes: async () => Array.from({ length: 20 }, () => 'failed') }),
    )
    expect(report).toEqual({
      claimed: 0,
      completed: 0,
      failed: 0,
      stopped: 'מפסק: 20/20 נכשלו בשעה האחרונה',
    })
    expect(claims).toHaveLength(0)
  })

  test('a failed refill is reported and the tick still drains the queue', async () => {
    const { client } = fakeClient(0, [job('j0')])
    const report = await tick(
      client,
      deps({
        refill: async () => {
          throw new Error('rpc down')
        },
      }),
    )
    expect(report).toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      feed: { status: 'error', message: 'rpc down' },
    })
  })

  test('one failing job is marked failed and does not stop the others', async () => {
    const { client, updates } = fakeClient(0, [job('ok'), job('bad'), job('ok2')])
    const report = await tick(
      client,
      deps({
        runJob: async (_c, row) => {
          if (row.id === 'bad') throw new Error('judge refused')
          return `sim-${row.id}`
        },
      }),
    )
    expect(report).toMatchObject({ claimed: 3, completed: 2, failed: 1 })
    expect(updates.find((u) => u.id === 'bad')).toEqual({ id: 'bad', status: 'failed', error: 'judge refused' })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/persuade/worker.test.ts`
Expected: FAIL. `TickDeps` does not exist, and `tick` ignores the injected collaborators (the first test's peak is 1).

- [ ] **Step 3: Replace `src/persuade/lib/worker.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RuleConfig } from '../engine/rules'
import { scoreRun } from '../engine/score'
import { runSimulation } from '../engine/simulation'
import type { Run } from '../engine/types'
import { createUsageMeter, withUsageMeter } from '../engine/usage'
import { isWorldState, personaInWorld, type WorldState } from '../engine/world'
import { breakerVerdict, DEFAULT_BREAKER, readRecentOutcomes } from './breaker'
import { getPersona, getPlan } from './content'
import { type FeedReport, refillFeed } from './feed'
import { modelId } from './model'
import { runPool } from './pool'
import { type WorkerSettings, workerSettings } from './worker-settings'

/**
 * The loop that runs simulations without anybody clicking anything.
 *
 * Deliberately holds no tenant and no assignment. A simulation is an invented
 * scenario against a synthetic persona, and that is the whole reason the matrix
 * built on top of it can be read across businesses -- tests/persuade/
 * tenant-boundary.test.ts enforces it on the engine and now on this file too.
 */

/**
 * One run is up to eleven model calls: five persuader turns, five persona
 * replies and the scorer. A loop with no ceiling is a bill with no ceiling, and
 * this project has already had one enforcement mechanism switched off for
 * exactly that reason -- brain-backend's CI, paused to stay inside an Actions
 * budget. A cap that stops the loop is the difference between a lab and a leak.
 * The cap itself now lives in worker-settings.ts, read per tick, so it can be
 * lowered in Vercel without a deploy.
 */
export const CALLS_PER_RUN = 11

export interface JobRow {
  id: string
  experiment: string | null
  variant: string | null
  persona_key: string
  plan_key: string
  industry: string
  segment: string | null
  job_role_id: string | null
  need: string | null
  rules: RuleConfig
  world: WorldState | null
  attempts: number
  /** Which pass of the feed queued this job. Null when queued by hand or by an experiment. */
  pass: number | null
}

export interface WorkerReport {
  claimed: number
  completed: number
  failed: number
  /** Set when the cap or the breaker stopped the batch, so a quiet worker is never ambiguous. */
  stopped?: string
  /** What the refill did this tick. An error here does not stop the tick from draining what is queued. */
  feed?: FeedReport | { status: 'error'; message: string }
}

/** The tick's collaborators. Injected so the tick can be tested without a database or a model. */
export interface TickDeps {
  settings: WorkerSettings
  readOutcomes: (client: SupabaseClient) => Promise<string[]>
  refill: (client: SupabaseClient, settings: WorkerSettings) => Promise<FeedReport>
  runJob: (client: SupabaseClient, job: JobRow) => Promise<string>
}

/** Runs completed today, which is what the cap is measured against. */
async function runsToday(client: SupabaseClient): Promise<number> {
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const { count, error } = await client
    .from('simulations')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since.toISOString())

  // A cap that cannot be read is a cap that is not enforced. Failing closed
  // costs a batch; failing open costs money until somebody notices.
  if (error) throw new Error(`בדיקת התקרה היומית נכשלה: ${error.message}`)
  return count ?? 0
}

/** Runs one claimed job and records its outcome on the queue row. Never throws. */
async function settle(
  client: SupabaseClient,
  job: JobRow,
  run: TickDeps['runJob'],
): Promise<'done' | 'failed'> {
  try {
    const simulationId = await run(client, job)
    await client
      .from('simulation_jobs')
      .update({
        status: 'done',
        simulation_id: simulationId,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
    return 'done'
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'שגיאה לא ידועה'
    await client
      .from('simulation_jobs')
      .update({ status: 'failed', error: message, updated_at: new Date().toISOString() })
      .eq('id', job.id)
    return 'failed'
  }
}

/**
 * One tick: check the cap and the breaker, top the queue up, claim a batch, run
 * it with bounded concurrency, record what happened.
 *
 * A failed job is marked and left rather than retried in place. The claim
 * function re-offers a stale `running` row after thirty minutes and increments
 * `attempts` each time, so a job that fails for a real reason stops being
 * retried by a person looking at `attempts`, not by a silent loop.
 *
 * Throughput: a tick every ten minutes, eight jobs, four at a time. Runs take
 * about 42 seconds (three took 125s against production), so a tick is roughly
 * two minutes inside maxDuration = 800, and 144 ticks a day can reach 1,152 --
 * above the cap, so the cap is what governs.
 */
export async function tick(client: SupabaseClient, overrides: Partial<TickDeps> = {}): Promise<WorkerReport> {
  const deps: TickDeps = {
    settings: overrides.settings ?? workerSettings(),
    readOutcomes: overrides.readOutcomes ?? ((c) => readRecentOutcomes(c, DEFAULT_BREAKER)),
    refill: overrides.refill ?? ((c, s) => refillFeed(c, s)),
    runJob: overrides.runJob ?? runJob,
  }
  const { settings } = deps

  const today = await runsToday(client)
  if (today >= settings.dailyCap) {
    return { claimed: 0, completed: 0, failed: 0, stopped: `תקרה יומית: ${today}/${settings.dailyCap}` }
  }

  const verdict = breakerVerdict(await deps.readOutcomes(client), DEFAULT_BREAKER)
  if (verdict.open) {
    return {
      claimed: 0,
      completed: 0,
      failed: 0,
      stopped: `מפסק: ${verdict.failed}/${verdict.total} נכשלו בשעה האחרונה`,
    }
  }

  // Refill before claiming, and never let a refill failure stop the claim: a
  // broken refill with a full queue should still run the queue.
  const feed: WorkerReport['feed'] = await deps.refill(client, settings).catch((cause: unknown) => ({
    status: 'error' as const,
    message: cause instanceof Error ? cause.message : 'שגיאה לא ידועה',
  }))

  const room = Math.min(settings.batch, settings.dailyCap - today)
  const { data, error } = await client.rpc('claim_simulation_jobs', {
    p_limit: room,
    p_stale_minutes: 30,
  })
  if (error) throw new Error(`נטילת עבודות נכשלה: ${error.message}`)

  const jobs = (data ?? []) as JobRow[]
  const outcomes = await runPool(jobs, settings.concurrency, (job) => settle(client, job, deps.runJob))

  return {
    claimed: jobs.length,
    completed: outcomes.filter((o) => o === 'done').length,
    failed: outcomes.filter((o) => o === 'failed').length,
    feed,
  }
}

/** One simulation, scored and stored. Returns the simulation id. */
export async function runJob(client: SupabaseClient, job: JobRow): Promise<string> {
  const [loaded, plan] = await Promise.all([getPersona(job.persona_key), getPlan(job.plan_key)])
  // The world owns the circumstance, the secret and the win condition; the
  // persona keeps its name, role and voice. Without a world the persona
  // supplies all of it, which is how a hand-started run still behaves.
  if (job.world !== null && !isWorldState(job.world)) {
    throw new Error('העולם ששמור על העבודה אינו תקין')
  }
  const persona = job.world ? personaInWorld(loaded, job.world) : loaded

  // One meter per job. Jobs run concurrently in this process, and the meter's
  // AsyncLocalStorage scope is what keeps their token counts apart.
  const meter = createUsageMeter()
  const { run, score } = await withUsageMeter(meter, async () => {
    let finished: Run | null = null
    for await (const event of runSimulation({ plan, persona, rules: job.rules, world: job.world })) {
      if (event.type === 'done') finished = event.run
    }
    if (!finished) throw new Error('הסימולציה הסתיימה בלי תוצאה')
    const judged = await scoreRun(finished.plan, finished.turns, finished.state, finished.violations)
    return { run: finished, score: judged }
  })

  const { data, error } = await client
    .from('simulations')
    .insert({
      industry: job.industry,
      job_role_id: job.job_role_id,
      need: job.need,
      // Out of the world and onto its own column. The migration backfilled
      // existing rows and nothing wrote it going forward, so every new run
      // landed with the reason inside the jsonb and the column null -- the
      // report slices on the column.
      reason: job.world?.reason ?? null,
      // Copied out of the plan rather than left in the jsonb: grouping runs by
      // subject should not mean digging through a blob, and the plan frozen
      // into this run can drift from the library plan behind it afterwards.
      topic: plan.topic,
      segment: job.segment ?? null,
      persona_id: persona.id,
      plan: run.plan,
      turns: run.turns,
      state: run.state,
      outcome: run.state.outcome,
      score,
      // The two columns that make the run comparable afterwards. Without them a
      // finished run is just a conversation nobody can attribute to a setting.
      rules: job.rules,
      experiment: job.experiment,
      variant: job.variant,
      // Stored so the run is readable as evidence: a win means little without
      // the world it was won in.
      world: job.world,
      // A run is the output of a config AND the models that executed it.
      // Without this, swapping PERSUADER_MODEL makes every comparison spanning
      // the swap measure the model rather than the setting -- and still render
      // as a clean difference between two arms.
      models: {
        persuader: modelId('persuader'),
        target: modelId('target'),
        judge: modelId('judge'),
      },
      // What this run cost, so the cap can become a budget once the real
      // number is known rather than guessed.
      usage: meter.totals(),
      pass: job.pass ?? null,
    })
    .select('id')
    .single()

  if (error) throw new Error(`שמירת הסימולציה נכשלה: ${error.message}`)
  return (data as { id: string }).id
}
```

- [ ] **Step 4: Run the worker test and everything around it**

Run: `pnpm vitest run tests/persuade`
Expected: all PASS, including `tenant-boundary` and `world-isolation`.

- [ ] **Step 5: Full gate and commit**

```bash
pnpm ci
git add src/persuade/lib/worker.ts tests/persuade/worker.test.ts
git commit -m "feat: a tick that refills, runs four at a time and stops on failures

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Schedule and documentation

**Files:**
- Modify: `vercel.json`
- Modify: `.env.example:61`
- Modify: `CLAUDE.md` (the "The simulation loop" section)
- Modify: `src/persuade/lib/simulations.ts:114` (comment wording only)

- [ ] **Step 1: Change the cron**

`vercel.json` becomes:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "crons": [
    {
      "path": "/api/persuade/worker",
      "schedule": "*/10 * * * *"
    }
  ]
}
```

- [ ] **Step 2: Document the variables**

In `.env.example`, replace the line `# PERSUADER_DAILY_RUN_CAP=200` with:

```
# PERSUADER_DAILY_RUN_CAP=1000   # runs per UTC day; start production at 200 and raise after reading usage
# PERSUADER_TICK_BATCH=8         # jobs claimed per tick
# PERSUADER_TICK_CONCURRENCY=4   # jobs run at once; lower this first if the provider rate-limits
# PERSUADER_QUEUE_LOW_WATER=50   # refill when fewer pending jobs than this
# PERSUADER_REFILL_CHUNK=200     # jobs queued per refill
```

- [ ] **Step 3: Update CLAUDE.md**

Replace the body of `### The simulation loop` (from "`vercel.json` runs" through the `queueExperiment` bullet) with:

```markdown
`vercel.json` runs `/api/persuade/worker` every ten minutes. Each tick checks
the daily cap and the failure breaker, tops the queue up from the feed, claims a
batch from `public.simulation_jobs`, runs it four at a time, scores each run and
stores it with the `RuleConfig`, the models, the token usage and the feed pass
that produced it.

- **It needs `CRON_SECRET` set in Vercel.** Without it the route refuses every
  request, including the cron's. That is deliberate: the endpoint spends money.
- **`PERSUADER_DAILY_RUN_CAP` stops the loop**, default 1,000 runs a UTC day.
  One run is up to eleven model calls. `PERSUADER_TICK_BATCH`,
  `PERSUADER_TICK_CONCURRENCY`, `PERSUADER_QUEUE_LOW_WATER` and
  `PERSUADER_REFILL_CHUNK` are read per tick; an unreadable value throws rather
  than falling back.
- **The breaker** skips a tick when at least 20 jobs finished in the last hour
  and more than 80% failed. It closes on its own as the window moves.
- **The feed** (`src/persuade/lib/feed.ts`, table `public.simulation_feed`)
  walks active (persona, plan) pairs times world cells and commits each chunk
  with a compare-and-set, so overlapping ticks cannot queue the same cells. A
  plan with a null `job_role_name` pairs with every persona in its industry.
  Changing the active personas or plans restarts the walk.
- Queue a one-off experiment with `queueExperiment` in
  `src/persuade/lib/experiments.ts`. It refuses an experiment whose arms differ
  in more than one setting, because that is an expensive way to learn nothing.
```

- [ ] **Step 4: Fix the stale comment**

In `src/persuade/lib/simulations.ts` around line 114, the comment reads "`PERSUADER_DAILY_RUN_CAP` runs a day, so a fixed cap is not a distant". Read the surrounding comment, and if it states or implies 200, change the number to match the new default of 1,000 without changing its argument. If it names no number, leave it.

- [ ] **Step 5: Full gate and commit**

```bash
pnpm ci
git add vercel.json .env.example CLAUDE.md src/persuade/lib/simulations.ts
git commit -m "chore: run the worker every ten minutes and document the loop's knobs

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Review before rollout

**Files:** none

- [ ] **Step 1: Code review**

Run the `/code-review` skill on the minene branch diff against `fix/report-paging-and-offplan-bias` and on the eran-task branch. Fix CRITICAL and HIGH findings with a test each, re-run `pnpm ci`, commit.

- [ ] **Step 2: Push both branches and open PRs (requires user approval)**

Ask the user before pushing. Then:

```bash
cd /Users/itayostraich/Documents/GitHub/eran-task && git push -u origin feat/simulation-feed
cd /Users/itayostraich/Documents/GitHub/minene && git push -u origin feat/simulation-scale-and-training
```

Open a PR for each with `gh pr create`. The minene PR body must state that it depends on the eran-task migration and on `fix/report-paging-and-offplan-bias`, and that merging deploys a cron that calls a function which does not exist until the migration is applied (the refill then reports `status: 'error'` and the tick still drains the queue, so it degrades rather than breaks).

---

### Task 9: Rollout (every step requires user approval)

**Files:** none

- [ ] **Step 1: Apply the migration**

After the eran-task PR is merged:

```bash
cd /Users/itayostraich/Documents/GitHub/eran-task
git switch main && git pull --ff-only
supabase link --project-ref zibpqbrfvxmkqnwmiboo
supabase migration list --linked
```
Expected: `20260917100000_simulation_feed` is the only local-but-not-remote migration. If anything else is pending, stop and report it.

```bash
supabase db push --linked
supabase db query --linked "select next_index, pass, inputs_version from public.simulation_feed"
```
Expected: one row, `0, 0, null`.

- [ ] **Step 2: Set the cap to 200 before the code deploys**

The code default is now 1,000 and production has no `PERSUADER_DAILY_RUN_CAP` set, so it must be set first.

```bash
cd /Users/itayostraich/Documents/GitHub/minene
printf '200' | vercel env add PERSUADER_DAILY_RUN_CAP production
vercel env ls | grep PERSUADER_DAILY_RUN_CAP
```

- [ ] **Step 3: Merge the minene PR** (merging `fix/report-paging-and-offplan-bias` first if it is still open), and confirm the production deployment is Ready.

- [ ] **Step 4: Trigger one tick by hand and read the report**

Retrieve `CRON_SECRET` from Vercel without printing it into the conversation, then:

```bash
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" https://<production-domain>/api/persuade/worker
```
Expected JSON: `feed.status` is `queued` with `queued: 200` on the first call, `claimed: 8`, `completed + failed = 8`. Report the JSON to the user with the secret removed.

- [ ] **Step 5: After 24 hours, read the real cost per run**

```bash
supabase db query --linked "
select count(*) runs,
       round(avg((usage->'persuader'->>'input')::int + (usage->'target'->>'input')::int + (usage->'judge'->>'input')::int)) avg_input,
       round(avg((usage->'persuader'->>'output')::int + (usage->'target'->>'output')::int + (usage->'judge'->>'output')::int)) avg_output,
       count(*) filter (where outcome = 'agreed') agreed
from public.simulations
where usage is not null and created_at > now() - interval '24 hours'"
```
Report runs, average input and output tokens, and the agreed share to the user, with a cost estimate from the current model prices. Raising `PERSUADER_DAILY_RUN_CAP` to 1,000 is the user's decision, made on that number.
