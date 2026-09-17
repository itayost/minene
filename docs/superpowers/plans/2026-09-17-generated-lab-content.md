# Generated Lab Content Implementation Plan (plan 2 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate 80 lab plans (one per `role_needs` need) and 32 personas (two per role) with the planner model, validate them, and store them so the self-refilling simulation feed runs across 3 industries and 16 roles instead of 1 plan and 4 retail personas.

**Architecture:** A one-off script, `pnpm lab:generate`, reads eran-task's `role_needs` (no tenant column), generates personas first and then plans through `generateObject`, runs every item through shared validation checks (the ones `validate:lab` already enforces, moved into one module), and upserts passing items with `source = 'generated'`. Pure units (keys, requester, prompts, checks) are separated from the model calls and from the database edge so each is testable with scripted models and a fake client. The plan schema moves out of `prepare.ts` so the generator reuses it without importing the ammunition path.

**Tech Stack:** TypeScript strict, AI SDK v7 (`generateObject`, `MockLanguageModelV3`), zod 4, `@supabase/supabase-js`, Vitest, Biome, `tsx` scripts, Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-09-17-simulation-scale-and-training-design.md`, section 2 (Variety).

## Global Constraints

- Repos: code in `minene` on branch `feat/generated-lab-content` (already created from `main` at `e0cdc78`); migration in `eran-task` on a new branch `feat/lab-content-source`.
- A simulation input must never read tenant data. The generator reads `role_needs`, `persuasion_personas` and `persuasion_lab_plans` only. No `ammunition`, `tenant_id`/`tenantId`, `assignment_id`/`assignmentId`, and no reads of `rules`, `roles`, `documents` or `profiles`, in `lab-generator.ts` or `generate-lab-content.ts` (enforced by `tests/persuade/tenant-boundary.test.ts`).
- Plan target: the role that owns the need. Requester: the role with `role_order - 1` in the same industry, else `הנהלת החברה`.
- Keys: `plan_key = gen-<industry>-<role_slug>-<need_key>`, `persona_key = gen-<industry>-<role_slug>-<1|2>`; both must match `^[a-z0-9-]+$`.
- Persona index 1 has `resistance = 2`, index 2 has `resistance = 4`.
- `onBehalfOf` = `{ name: <requester title>, title: <requester title>, mandate: <requester title> ביקש לקדם את "<need label>" ואישר לפנות בשמו }`. Never an invented person's name.
- Plan `title` = `<need label>: <topic>`, truncated to 120 characters. `job_role_name` (and persona `role`) = the role label; `job_role_name` is at most 40 characters.
- A persona name must not belong to another persona and must not appear (standalone Hebrew word match) in any stored plan. A plan must not mention any persona's name.
- Generated rows: `is_active = true`, `source = 'generated'`, `generated_at` set. Existing keys are skipped unless `--force`.
- One item failing (model error, validation, write) rejects that item only; the run continues; the script exits non-zero if anything was rejected.
- minene style: no semicolons, single quotes, 2-space indent, Biome; comments explain why; Hebrew user-facing errors; no emojis.
- Gate before every commit in minene: `pnpm lint:fix` then `pnpm run ci` (never `pnpm ci`, which is a reserved pnpm builtin).
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Anything that writes to the linked Supabase project, calls a paid model, pushes, opens or merges a PR, requires explicit user approval in the session.

## File Map

**eran-task**
- Create `supabase/migrations/20260917120000_lab_content_source.sql`: `source` and `generated_at` on `persuasion_personas` and `persuasion_lab_plans`.
- Create `supabase/verify/20260917120000_lab_content_source.sql`.

**minene**
- Create `src/persuade/engine/plan-schema.ts`: `argumentSchema`, `planSchema`, `normalizeEscalation` (moved out of `prepare.ts`).
- Modify `src/persuade/engine/prepare.ts`: import them.
- Create `src/persuade/lib/lab-content-checks.ts`: `mentionsName`, `planProblems`, `personaProblems`.
- Rewrite `scripts/validate-lab-content.ts` to use the checks.
- Create `src/persuade/lib/lab-generator.ts`: types, keys, requester, prompts, `generatePlan`, `generatePersona`.
- Create `src/persuade/lib/generate-lab-content.ts`: `generateLabContent` (reads, generates, validates, writes).
- Create `scripts/generate-lab-content.ts`; modify `package.json` (`lab:generate`), `CLAUDE.md`, `tests/persuade/tenant-boundary.test.ts`.
- Tests: `tests/persuade/plan-schema.test.ts`, `tests/persuade/lab-content-checks.test.ts`, `tests/persuade/lab-generator.test.ts`, `tests/persuade/generate-lab-content.test.ts`.

---

### Task 0: Branches and baseline

**Files:** none

- [ ] **Step 1: minene**

```bash
cd /Users/itayostraich/Documents/GitHub/minene
git branch --show-current   # expect: feat/generated-lab-content
pnpm lint:fix && pnpm run ci
```
Expected: exit 0, `Test Files 82 passed`, `Tests 786 passed` (or more if main moved). Stop and report on any failure.

- [ ] **Step 2: eran-task**

```bash
cd /Users/itayostraich/Documents/GitHub/eran-task
git switch main && git pull --ff-only
git switch -c feat/lab-content-source
```

---

### Task 1: Migration and verification

**Files:**
- Create: `eran-task/supabase/migrations/20260917120000_lab_content_source.sql`
- Create: `eran-task/supabase/verify/20260917120000_lab_content_source.sql`

**Interfaces:**
- Produces (database): `persuasion_personas.source` and `persuasion_lab_plans.source` (`text not null default 'manual'`, check in `manual | generated`), `generated_at timestamptz null` on both, and a check that a `generated` row has `generated_at`.

- [ ] **Step 1: Write the migration**

```sql
-- Generated lab content, told apart from hand-written.
--
-- minene's `pnpm lab:generate` writes about 80 plans and 32 personas from
-- role_needs. They are inputs to synthetic runs, so they go live without a
-- person approving each one. The price of that is being able to take a bad
-- batch out in one statement, which needs the batch to be identifiable:
--
--   update public.persuasion_lab_plans set is_active = false
--   where source = 'generated' and generated_at > '<when>';

alter table public.persuasion_personas
  add column source text not null default 'manual'
    check (source in ('manual', 'generated')),
  add column generated_at timestamptz null;

alter table public.persuasion_personas
  add constraint persuasion_personas_generated_has_time
    check (source = 'manual' or generated_at is not null);

alter table public.persuasion_lab_plans
  add column source text not null default 'manual'
    check (source in ('manual', 'generated')),
  add column generated_at timestamptz null;

alter table public.persuasion_lab_plans
  add constraint persuasion_lab_plans_generated_has_time
    check (source = 'manual' or generated_at is not null);

comment on column public.persuasion_personas.source is
  'manual: written by a person. generated: written by minene lab:generate from role_needs.';
comment on column public.persuasion_lab_plans.source is
  'manual: written by a person. generated: written by minene lab:generate from role_needs.';
```

- [ ] **Step 2: Write the verification script**

```sql
do $$
begin
  if exists (select 1 from public.persuasion_personas where source <> 'manual')
     or exists (select 1 from public.persuasion_lab_plans where source <> 'manual') then
    raise exception 'existing rows should default to manual';
  end if;

  begin
    insert into public.persuasion_personas
      (persona_key, name, role, resistance, reliability, situation, hidden_truth, style, agrees_when, source)
    values ('verify-generated', 'בדיקה', 'בדיקה', 2, 3, 's', 'h', 'st', 'a', 'generated');
    raise exception 'a generated persona without generated_at was accepted';
  exception when check_violation then
    null;
  end;

  insert into public.persuasion_personas
    (persona_key, name, role, resistance, reliability, situation, hidden_truth, style, agrees_when, source, generated_at)
  values ('verify-generated', 'בדיקה', 'בדיקה', 2, 3, 's', 'h', 'st', 'a', 'generated', now());

  begin
    insert into public.persuasion_lab_plans (plan_key, title, plan, source)
    values ('verify-generated', 'בדיקה', '{}'::jsonb, 'generated');
    raise exception 'a generated plan without generated_at was accepted';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.persuasion_lab_plans (plan_key, title, plan, source, generated_at)
    values ('verify-other', 'בדיקה', '{}'::jsonb, 'imported', now());
    raise exception 'an unknown source was accepted';
  exception when check_violation then
    null;
  end;

  raise notice 'lab_content_source verification passed';
end;
$$;
```

- [ ] **Step 3: Commit (eran-task, do not push)**

```bash
git add supabase/migrations/20260917120000_lab_content_source.sql supabase/verify/20260917120000_lab_content_source.sql
git commit -m "feat: tell generated lab content apart from hand-written

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

The rolled-back verification against the linked project runs in Task 7, with approval.

---

### Task 2: Move the plan schema out of stage 0

**Files:**
- Create: `src/persuade/engine/plan-schema.ts`
- Modify: `src/persuade/engine/prepare.ts` (lines 1-66 and the `escalation:` mapping inside `preparePlan`)
- Test: `tests/persuade/plan-schema.test.ts`

**Interfaces:**
- Produces: `argumentSchema`, `planSchema` (zod objects, unchanged), `type GeneratedPlan = z.infer<typeof planSchema>`, `normalizeEscalation(steps: readonly { rung: number; message: string }[]): EscalationStep[]`.

- [ ] **Step 1: Write the failing test**

`tests/persuade/plan-schema.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { normalizeEscalation, planSchema } from '../../src/persuade/engine/plan-schema'

describe('normalizeEscalation', () => {
  test('clamps and rounds rungs into 1-5 and keeps the messages', () => {
    expect(
      normalizeEscalation([
        { rung: 0, message: 'a' },
        { rung: 2.6, message: 'b' },
        { rung: 9, message: 'c' },
      ]),
    ).toEqual([
      { rung: 1, message: 'a' },
      { rung: 3, message: 'b' },
      { rung: 5, message: 'c' },
    ])
  })
})

describe('planSchema', () => {
  test('refuses a ladder that is not five rungs', () => {
    const result = planSchema.shape.escalation.safeParse([
      { rung: 1, message: 'a' },
      { rung: 2, message: 'b' },
    ])
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/persuade/plan-schema.test.ts`
Expected: FAIL, cannot resolve `../../src/persuade/engine/plan-schema`.

- [ ] **Step 3: Create `plan-schema.ts` by moving the schemas**

Create `src/persuade/engine/plan-schema.ts` with this header, then MOVE (cut from `prepare.ts`, paste here, unchanged) the two declarations `const argumentSchema = z.object({ ... })` and `const planSchema = z.object({ ... })`, currently `prepare.ts` lines 13-66, adding `export` to both. Keep their comments. Then append the type and function below.

```ts
import { z } from 'zod'
import type { EscalationStep, Rung } from './types'

/**
 * The shape of a persuasion plan as a model is asked to produce it.
 *
 * Shared by stage 0 (prepare.ts), which builds a plan from a business's
 * knowledge, and by the lab content generator, which builds library plans from
 * role_needs. Split out so the generator does not import the module that reads
 * a tenant's ammunition just to reuse a schema.
 */

// <argumentSchema and planSchema moved here from prepare.ts, each now `export const`>

export type GeneratedPlan = z.infer<typeof planSchema>

/**
 * A model asked for rungs 1-5 still occasionally answers 0 or 5.5. Clamped
 * rather than rejected: the ladder's order is what matters, and the validation
 * that follows refuses a ladder that is not exactly 1, 2, 3, 4, 5.
 */
export function normalizeEscalation(
  steps: readonly { rung: number; message: string }[],
): EscalationStep[] {
  return steps.map((step) => ({
    rung: Math.min(Math.max(Math.round(step.rung), 1), 5) as Rung,
    message: step.message,
  }))
}
```

Remove the placeholder comment line once the two schemas are pasted in its place.

- [ ] **Step 4: Point `prepare.ts` at it**

In `src/persuade/engine/prepare.ts`:
- Delete `import { z } from 'zod'` (no `z.` use remains in the file after the move; `tsc` and Biome will confirm).
- Add `import { normalizeEscalation, planSchema } from './plan-schema'`.
- In `preparePlan`, replace

```ts
    escalation: object.escalation.map((e) => ({
      rung: Math.min(Math.max(Math.round(e.rung), 1), 5) as 1 | 2 | 3 | 4 | 5,
      message: e.message,
    })),
```

with

```ts
    escalation: normalizeEscalation(object.escalation),
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/persuade/plan-schema.test.ts tests/persuade/prepare.test.ts tests/persuade/plans.test.ts tests/persuade/brain2spark-seam.test.ts`
Expected: all PASS.

- [ ] **Step 6: Gate and commit**

```bash
pnpm lint:fix && pnpm run ci
git add src/persuade/engine/plan-schema.ts src/persuade/engine/prepare.ts tests/persuade/plan-schema.test.ts
git commit -m "refactor: move the plan schema out of stage 0 so the lab can share it

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Shared lab content checks

**Files:**
- Create: `src/persuade/lib/lab-content-checks.ts`
- Rewrite: `scripts/validate-lab-content.ts`
- Test: `tests/persuade/lab-content-checks.test.ts`

**Interfaces:**
- Produces:
  - `mentionsName(text: string, name: string): boolean`
  - `planProblems(plan: PersuasionPlan, personaNames: readonly string[]): string[]` (a fresh array; empty means valid)
  - `personaProblems(persona: Pick<TargetPersona, 'name' | 'role' | 'situation' | 'hiddenTruth' | 'style' | 'agreesWhen'>): string[]`

- [ ] **Step 1: Write the failing test**

`tests/persuade/lab-content-checks.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  mentionsName,
  personaProblems,
  planProblems,
} from '../../src/persuade/lib/lab-content-checks'
import { TEST_PERSONA, TEST_PLAN } from './helpers'

describe('mentionsName', () => {
  test('matches a standalone Hebrew name and not the same letters inside a word', () => {
    expect(mentionsName('דיברתי עם עדי אתמול', 'עדי')).toBe(true)
    expect(mentionsName('ועדיין לא', 'עדי')).toBe(false)
  })

  test('treats regex characters in a name literally', () => {
    expect(mentionsName('שלום (דנה)', '(דנה)')).toBe(true)
    expect(mentionsName('שלום דנה', 'דנ.')).toBe(false)
  })
})

describe('planProblems', () => {
  test('a complete plan has none', () => {
    expect(planProblems(TEST_PLAN, [])).toEqual([])
  })

  test('a plan that mentions a persona is refused', () => {
    // TEST_PLAN is made on behalf of אושר.
    expect(planProblems(TEST_PLAN, ['אושר'])).toEqual(['התוכנית מזכירה בשמה את הדמות "אושר"'])
  })

  test('an ask that cannot be photographed is refused', () => {
    const plan = { ...TEST_PLAN, ask: { ...TEST_PLAN.ask, when: '', trialPeriod: '' } }
    expect(planProblems(plan, [])).toEqual(['הבקשה לא ניתנת לצילום — חסר מתי, לכמה זמן מנסים'])
  })

  test('a ladder that is not exactly five rungs in order is refused', () => {
    const plan = { ...TEST_PLAN, escalation: TEST_PLAN.escalation.slice(0, 4) }
    expect(planProblems(plan, [])).toEqual(['סולם ההסלמה אינו חמש מדרגות (1,2,3,4)'])
  })

  test('no topic and no arguments are refused', () => {
    const plan = { ...TEST_PLAN, topic: ' ', arguments: [] }
    expect(planProblems(plan, [])).toEqual(['אין נושא', 'אין טיעונים'])
  })
})

describe('personaProblems', () => {
  test('a complete persona has none', () => {
    expect(personaProblems(TEST_PERSONA)).toEqual([])
  })

  test('empty required fields are refused, each named', () => {
    expect(personaProblems({ ...TEST_PERSONA, hiddenTruth: '', agreesWhen: ' ' })).toEqual([
      'אין אמת נסתרת',
      'לא נאמר מתי מסכימים',
    ])
  })

  test('a name longer than the column allows is refused', () => {
    expect(personaProblems({ ...TEST_PERSONA, name: 'א'.repeat(61) })).toEqual([
      'השם ארוך מ-60 תווים',
    ])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/persuade/lab-content-checks.test.ts`
Expected: FAIL, cannot resolve `../../src/persuade/lib/lab-content-checks`.

- [ ] **Step 3: Implement**

`src/persuade/lib/lab-content-checks.ts`:

```ts
import { isAskPhotographable } from '../engine/rules'
import type { PersuasionPlan, TargetPersona } from '../engine/types'

/**
 * What makes a lab plan or persona usable, in one place.
 *
 * These were inline in scripts/validate-lab-content.ts, which checks what is
 * already stored. The generator needs the same rules before it stores anything,
 * and two copies of a validation rule are two rules the day one of them changes.
 */

const NAME_MAX = 60
const ROLE_MAX = 120
const LADDER = JSON.stringify([1, 2, 3, 4, 5])

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Word boundaries matter: "ועדיין" contains "עדי" and is not a name. */
export function mentionsName(text: string, name: string): boolean {
  return new RegExp(`(?<![א-ת])${escapeRegExp(name)}(?![א-ת])`).test(text)
}

export function planProblems(plan: PersuasionPlan, personaNames: readonly string[]): string[] {
  const problems: string[] = []

  const gate = isAskPhotographable(plan)
  if (!gate.ok) problems.push(`הבקשה לא ניתנת לצילום — חסר ${gate.missing.join(', ')}`)

  const rungs = (plan.escalation ?? []).map((step) => step.rung)
  if (JSON.stringify(rungs) !== LADDER) {
    problems.push(`סולם ההסלמה אינו חמש מדרגות (${rungs.join(',') || 'ריק'})`)
  }

  if (!plan.topic?.trim()) problems.push('אין נושא')
  if ((plan.arguments ?? []).length === 0) problems.push('אין טיעונים')

  // A plan naming a persona makes every simulation against a different persona
  // incoherent, and the failure is silent: the bot addresses the wrong person.
  const blob = JSON.stringify(plan)
  for (const name of personaNames) {
    if (name.trim() && mentionsName(blob, name)) {
      problems.push(`התוכנית מזכירה בשמה את הדמות "${name}"`)
    }
  }

  return problems
}

export function personaProblems(
  persona: Pick<TargetPersona, 'name' | 'role' | 'situation' | 'hiddenTruth' | 'style' | 'agreesWhen'>,
): string[] {
  const problems: string[] = []
  if (!persona.name?.trim()) problems.push('אין שם')
  else if (persona.name.trim().length > NAME_MAX) problems.push(`השם ארוך מ-${NAME_MAX} תווים`)
  if (!persona.role?.trim()) problems.push('אין תפקיד')
  else if (persona.role.trim().length > ROLE_MAX) problems.push(`התפקיד ארוך מ-${ROLE_MAX} תווים`)
  if (!persona.situation?.trim()) problems.push('אין מצב')
  if (!persona.hiddenTruth?.trim()) problems.push('אין אמת נסתרת')
  if (!persona.style?.trim()) problems.push('אין סגנון דיבור')
  if (!persona.agreesWhen?.trim()) problems.push('לא נאמר מתי מסכימים')
  return problems
}
```

- [ ] **Step 4: Rewrite `scripts/validate-lab-content.ts` to use them**

Replace the whole file with:

```ts
/**
 * Checks the lab's personas and plans against the invariants that used to be
 * unit tests over `content/*.json`.
 *
 * They stopped being testable that way when the content moved into the
 * database: a unit test cannot reach a row, and a test that skips itself when
 * no database is configured reports green while checking nothing. So they run
 * here, and the rules themselves live in src/persuade/lib/lab-content-checks.ts,
 * where the generator uses them before it writes anything.
 *
 *   pnpm validate:lab
 */
import { createClient } from '@supabase/supabase-js'
import type { PersuasionPlan } from '../src/persuade/engine/types'
import { personaProblems, planProblems } from '../src/persuade/lib/lab-content-checks'
import { env } from './lib/db'

interface PersonaRow {
  persona_key: string
  name: string
  role: string
  situation: string
  hidden_truth: string
  style: string
  agrees_when: string
}

interface PlanRow {
  plan_key: string
  plan: PersuasionPlan
}

async function main(): Promise<void> {
  const { url, key } = env()
  const db = createClient(url, key, { auth: { persistSession: false } })
  const problems: string[] = []

  const { data: personaData, error: personaError } = await db
    .from('persuasion_personas')
    .select('persona_key,name,role,situation,hidden_truth,style,agrees_when')
    .eq('is_active', true)
  if (personaError) throw new Error(`קריאת הדמויות נכשלה: ${personaError.message}`)

  const { data: planData, error: planError } = await db
    .from('persuasion_lab_plans')
    .select('plan_key,plan')
    .eq('is_active', true)
  if (planError) throw new Error(`קריאת התוכניות נכשלה: ${planError.message}`)

  const personas = (personaData ?? []) as PersonaRow[]
  const plans = (planData ?? []) as PlanRow[]

  if (personas.length === 0) problems.push('אין אף דמות פעילה')
  if (plans.length === 0) problems.push('אין אף תוכנית פעילה')

  for (const row of personas) {
    const found = personaProblems({
      name: row.name,
      role: row.role,
      situation: row.situation,
      hiddenTruth: row.hidden_truth,
      style: row.style,
      agreesWhen: row.agrees_when,
    })
    for (const problem of found) problems.push(`${row.persona_key}: ${problem}`)
  }

  const names = personas.map((row) => row.name)
  for (const row of plans) {
    for (const problem of planProblems(row.plan, names)) problems.push(`${row.plan_key}: ${problem}`)
  }

  const keys = plans.map((row) => row.plan_key)
  if (new Set(keys).size !== keys.length) problems.push('יש מפתחות תוכנית כפולים')

  if (problems.length > 0) {
    console.error('תוכן המעבדה לא תקין:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }

  console.log(`תוכן המעבדה תקין: ${personas.length} דמויות, ${plans.length} תוכניות.`)
}

await main()
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/persuade/lab-content-checks.test.ts`
Expected: all PASS.

- [ ] **Step 6: Gate and commit**

```bash
pnpm lint:fix && pnpm run ci
git add src/persuade/lib/lab-content-checks.ts scripts/validate-lab-content.ts tests/persuade/lab-content-checks.test.ts
git commit -m "refactor: one set of lab content checks for validation and generation

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The generator (keys, prompts, model calls)

**Files:**
- Create: `src/persuade/lib/lab-generator.ts`
- Test: `tests/persuade/lab-generator.test.ts`

**Interfaces:**
- Consumes: `planSchema`, `normalizeEscalation` (Task 2); `model`, `callOptions` from `src/persuade/lib/model.ts`; `RUNG_LABELS` from `src/persuade/engine/knowledge.ts`.
- Produces:
  - `interface RoleRef { industry: string; roleSlug: string; roleLabel: string; roleOrder: number }`
  - `interface RoleNeed extends RoleRef { needKey: string; needLabel: string; metaNeed: string }`
  - `planKeyFor(need: RoleNeed): string`, `personaKeyFor(role: RoleRef, index: 1 | 2): string`
  - `const COMPANY_MANAGEMENT = 'הנהלת החברה'`
  - `requesterFor(need: RoleNeed, needs: readonly RoleNeed[]): string`
  - `planPrompt(need: RoleNeed, requester: string): { system: string; prompt: string }`
  - `personaPrompt(role: RoleRef, index: 1 | 2, avoidNames: readonly string[]): { system: string; prompt: string }`
  - `generatePlan(need: RoleNeed, requester: string): Promise<PersuasionPlan>`
  - `generatePersona(role: RoleRef, index: 1 | 2, avoidNames: readonly string[]): Promise<TargetPersona>`

- [ ] **Step 1: Write the failing test**

`tests/persuade/lab-generator.test.ts`:

```ts
/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, test } from 'vitest'
import {
  COMPANY_MANAGEMENT,
  generatePersona,
  generatePlan,
  personaKeyFor,
  personaPrompt,
  planKeyFor,
  planPrompt,
  type RoleNeed,
  requesterFor,
} from '../../src/persuade/lib/lab-generator'
import { setModelOverrides } from '../../src/persuade/lib/model'
import { jsonModel, recordingJsonModel } from './helpers'

afterEach(() => setModelOverrides({}))

const need = (overrides: Partial<RoleNeed> = {}): RoleNeed => ({
  industry: 'retail',
  roleSlug: 'store-manager',
  roleLabel: 'מנהל חנות',
  roleOrder: 4,
  needKey: 'training-motivation',
  needLabel: 'הדרכה ומוטיבציה',
  metaNeed: 'people',
  ...overrides,
})

const argument = (id: string) => ({
  id,
  category: 'personal_benefit',
  text: 'זה חוסך לך זמן בסוף השבוע',
  strength: 7,
  why: 'עמוס',
  sourceRuleNumber: 12,
})

const PLAN_PAYLOAD = {
  topic: 'תדריך בוקר קצר',
  ask: {
    what: 'תדריך של חמש דקות על מוצר אחד',
    withWhom: 'העובדים במשמרת הבוקר',
    durationMinutes: 5,
    frequency: 'כל יום עבודה',
    when: 'לפני הפתיחה',
    script: ['בוחרים מוצר', 'אומרים מה מיוחד בו'],
    trialPeriod: 'שבועיים',
    oneLiner: 'כל בוקר חמש דקות על מוצר אחד',
  },
  currentStateQuestions: ['איך מדריכים היום?', 'כמה פעמים בשבוע?'],
  arguments: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map(argument),
  objections: [
    { objection: 'אין זמן', response: 'חמש דקות' },
    { objection: 'הם יודעים', response: 'נבדוק' },
    { objection: 'לא עכשיו', response: 'שבועיים בלבד' },
  ],
  escalation: [
    { rung: 1, message: 'זה בשבילך' },
    { rung: 2, message: 'חמש דקות' },
    { rung: 3, message: 'זה חלק מהתפקיד' },
    { rung: 4, message: 'נבדוק' },
    { rung: 5, message: 'גבול' },
  ],
  stopPoint: 'אחרי ארבע אינטראקציות',
  successCriteria: 'תדריך בעשרה ימים מתוך עשרה',
}

const PERSONA_PAYLOAD = {
  name: 'נועה',
  reliability: 3,
  situation: 'שבוע של ספירת מלאי',
  hiddenTruth: 'עושה תדריך פעם בשבוע',
  motivatedBy: ['הצוות', 'שקט'],
  style: 'קצרה וענייניית',
  agreesWhen: 'הבקשה קטנה ומוכרת בעומס',
}

describe('keys', () => {
  test('are stable and match the database pattern', () => {
    expect(planKeyFor(need())).toBe('gen-retail-store-manager-training-motivation')
    expect(personaKeyFor(need(), 2)).toBe('gen-retail-store-manager-2')
    expect(planKeyFor(need())).toMatch(/^[a-z0-9-]+$/)
  })
})

describe('requesterFor', () => {
  const needs = [
    need({ roleSlug: 'ceo', roleLabel: 'מנכ"ל', roleOrder: 1 }),
    need({ roleSlug: 'area-manager', roleLabel: 'מנהל אזור', roleOrder: 3 }),
    need(),
    need({ industry: 'bank', roleSlug: 'banker', roleLabel: 'בנקאי', roleOrder: 3 }),
  ]

  test('is the role listed one above, in the same industry', () => {
    expect(requesterFor(need(), needs)).toBe('מנהל אזור')
  })

  test('is company management when nothing is listed above', () => {
    expect(requesterFor(needs[0] as RoleNeed, needs)).toBe(COMPANY_MANAGEMENT)
  })

  test('never crosses industries', () => {
    expect(requesterFor(need({ industry: 'bank', roleOrder: 4 }), needs)).toBe('בנקאי')
    expect(requesterFor(need({ industry: 'healthcare', roleOrder: 4 }), needs)).toBe(COMPANY_MANAGEMENT)
  })
})

describe('prompts', () => {
  test('the plan prompt names the need, the role and the requester', () => {
    const { prompt } = planPrompt(need(), 'מנהל אזור')
    expect(prompt).toContain('הדרכה ומוטיבציה')
    expect(prompt).toContain('מנהל חנות')
    expect(prompt).toContain('מנהל אזור')
  })

  test('the persona prompt lists the names that are taken', () => {
    const { prompt } = personaPrompt(need(), 1, ['אושר', 'עדי'])
    expect(prompt).toContain('אושר, עדי')
  })
})

describe('generatePlan', () => {
  test('keys the plan, speaks for the requester and never cites a rule', async () => {
    setModelOverrides({ planner: jsonModel([PLAN_PAYLOAD]) })

    const plan = await generatePlan(need(), 'מנהל אזור')

    expect(plan.id).toBe('gen-retail-store-manager-training-motivation')
    expect(plan.onBehalfOf).toEqual({
      name: 'מנהל אזור',
      title: 'מנהל אזור',
      mandate: 'מנהל אזור ביקש לקדם את "הדרכה ומוטיבציה" ואישר לפנות בשמו',
    })
    expect(plan.arguments.every((a) => a.sourceRuleNumber === null)).toBe(true)
    expect(plan.escalation.map((e) => e.rung)).toEqual([1, 2, 3, 4, 5])
    expect(plan.topic).toBe('תדריך בוקר קצר')
  })
})

describe('generatePersona', () => {
  test('the first persona is the easier one and the second the harder', async () => {
    setModelOverrides({ planner: jsonModel([PERSONA_PAYLOAD]) })

    const first = await generatePersona(need(), 1, [])
    const second = await generatePersona(need(), 2, [])

    expect(first).toMatchObject({ id: 'gen-retail-store-manager-1', resistance: 2, role: 'מנהל חנות' })
    expect(second).toMatchObject({ id: 'gen-retail-store-manager-2', resistance: 4 })
    expect(first.name).toBe('נועה')
  })

  test('the model is told which names it may not use', async () => {
    const { model, prompts } = recordingJsonModel([PERSONA_PAYLOAD])
    setModelOverrides({ planner: model })

    await generatePersona(need(), 1, ['אושר'])

    expect(prompts()[0]).toContain('אושר')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/persuade/lab-generator.test.ts`
Expected: FAIL, cannot resolve `../../src/persuade/lib/lab-generator`.

- [ ] **Step 3: Implement**

`src/persuade/lib/lab-generator.ts`:

```ts
import { generateObject } from 'ai'
import { z } from 'zod'
import { RUNG_LABELS } from '../engine/knowledge'
import { normalizeEscalation, planSchema } from '../engine/plan-schema'
import type { Argument, PersuasionPlan, TargetPersona } from '../engine/types'
import { callOptions, model } from './model'

/**
 * Writes the lab's library plans and personas from role_needs.
 *
 * role_needs describes roles, not people or businesses, which is what makes it
 * a safe source: nothing generated here can carry one business's knowledge into
 * the matrix every business reads. This file takes its inputs as arguments and
 * reads nothing itself.
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

export const COMPANY_MANAGEMENT = 'הנהלת החברה'

export const planKeyFor = (need: RoleNeed): string =>
  `gen-${need.industry}-${need.roleSlug}-${need.needKey}`

export const personaKeyFor = (role: RoleRef, index: 1 | 2): string =>
  `gen-${role.industry}-${role.roleSlug}-${index}`

/**
 * Who asks. role_order is a listing order, not a reporting tree, so "one above"
 * is a stand-in for seniority rather than a claim about who manages whom. It is
 * never a person's name: a named requester would be a name some persona could
 * later be given.
 */
export function requesterFor(need: RoleNeed, needs: readonly RoleNeed[]): string {
  const above = needs.find(
    (other) => other.industry === need.industry && other.roleOrder === need.roleOrder - 1,
  )
  return above?.roleLabel ?? COMPANY_MANAGEMENT
}

const ladder = () =>
  Object.entries(RUNG_LABELS)
    .map(([rung, label]) => `${rung}. ${label}`)
    .join('\n')

export function planPrompt(need: RoleNeed, requester: string): { system: string; prompt: string } {
  return {
    system: `אתה מתכנן שיחות שכנוע בעבודה. אתה כותב תוכנית לשיחה קצרה שבה פונים לאדם בתפקיד מסוים ומבקשים ממנו פעולה אחת קטנה וקבועה.

חוקים:
- הבקשה ניתנת לצילום: מה בדיוק עושים, עם מי, כמה דקות, באיזו תדירות, מתי, מה אומרים או עושים בפועל, ולכמה זמן מנסים.
- הבקשה קטנה: עד 15 דקות בכל פעם.
- אל תמציא שם לאדם שפונים אליו ואל תכתוב אף שם של אדם בתוכנית. פנה בלשון ניטרלית.
- הטיעונים מתחילים מהתועלת האישית של מי שפונים אליו, לא מהארגון.
- כל טיעון עד 20 מילים. עברית פשוטה.
- sourceRuleNumber הוא null בכל טיעון.
- סולם ההסלמה הוא חמש מדרגות, לפי הסדר:
${ladder()}`,
    prompt: `ענף: ${need.industry}
התפקיד של מי שפונים אליו: ${need.roleLabel}
הצורך שהבקשה משרתת: ${need.needLabel} (${need.metaNeed})
מי מבקש: ${requester}

כתוב תוכנית שבה ${requester} מבקש מאדם בתפקיד ${need.roleLabel} פעולה אחת שמקדמת את "${need.needLabel}".`,
  }
}

export async function generatePlan(need: RoleNeed, requester: string): Promise<PersuasionPlan> {
  const { system, prompt } = planPrompt(need, requester)
  const { object } = await generateObject({
    model: model('planner'),
    schema: planSchema,
    system,
    prompt,
    ...callOptions('planner'),
  })

  return {
    ...object,
    id: planKeyFor(need),
    onBehalfOf: {
      name: requester,
      title: requester,
      mandate: `${requester} ביקש לקדם את "${need.needLabel}" ואישר לפנות בשמו`,
    },
    // A library plan is not built from any business's rules, whatever the
    // model wrote in the field.
    arguments: object.arguments.map((argument) => ({ ...argument, sourceRuleNumber: null })) as Argument[],
    escalation: normalizeEscalation(object.escalation),
  } as PersuasionPlan
}

export const personaSchema = z.object({
  name: z.string().describe('שם פרטי עברי אחד, בלי שם משפחה'),
  reliability: z.number().int().min(1).max(5).describe('כמה הוא עומד במה שהוא מסכים לו, 1 עד 5'),
  situation: z.string().describe('משפט או שניים על מה שעובר עליו השבוע בעבודה'),
  hiddenTruth: z.string().describe('משהו אמיתי על ההרגלים שלו שהוא לא יגיד מיוזמתו'),
  motivatedBy: z.array(z.string()).min(2).max(4),
  style: z.string().describe('איך הוא מדבר, בכמה מילים'),
  agreesWhen: z.string().describe('באילו תנאים הוא מסכים לבקשה'),
})

export function personaPrompt(
  role: RoleRef,
  index: 1 | 2,
  avoidNames: readonly string[],
): { system: string; prompt: string } {
  return {
    system:
      'אתה כותב דמות של אדם בעבודה לסימולציית שיחה. הדמות מציאותית ולא קריקטורה. עברית פשוטה.',
    prompt: `ענף: ${role.industry}
תפקיד: ${role.roleLabel}
אופי: ${index === 1 ? 'פתוח יחסית, עסוק אבל מוכן לשמוע.' : 'חשדן ועייף מבקשות, צריך סיבה טובה.'}
שמות תפוסים שאסור להשתמש בהם: ${avoidNames.length > 0 ? avoidNames.join(', ') : 'אין'}`,
  }
}

export async function generatePersona(
  role: RoleRef,
  index: 1 | 2,
  avoidNames: readonly string[],
): Promise<TargetPersona> {
  const { system, prompt } = personaPrompt(role, index, avoidNames)
  const { object } = await generateObject({
    model: model('planner'),
    schema: personaSchema,
    system,
    prompt,
    ...callOptions('planner'),
  })

  return {
    id: personaKeyFor(role, index),
    name: object.name.trim(),
    role: role.roleLabel,
    // Worlds replace resistance in every feed run; the split only shows in a
    // run started by hand without one.
    resistance: index === 1 ? 2 : 4,
    reliability: object.reliability as TargetPersona['reliability'],
    situation: object.situation,
    hiddenTruth: object.hiddenTruth,
    motivatedBy: object.motivatedBy,
    style: object.style,
    agreesWhen: object.agreesWhen,
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/persuade/lab-generator.test.ts`
Expected: all PASS.

- [ ] **Step 5: Gate and commit**

```bash
pnpm lint:fix && pnpm run ci
git add src/persuade/lib/lab-generator.ts tests/persuade/lab-generator.test.ts
git commit -m "feat: write lab plans and personas from role_needs with the planner model

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Generate, validate, store

**Files:**
- Create: `src/persuade/lib/generate-lab-content.ts`
- Test: `tests/persuade/generate-lab-content.test.ts`

**Interfaces:**
- Consumes: Task 3 (`mentionsName`, `personaProblems`, `planProblems`); Task 4 (`RoleNeed`, `RoleRef`, `generatePlan`, `generatePersona`, `planKeyFor`, `personaKeyFor`, `requesterFor`); `runPool` from `src/persuade/lib/pool.ts`.
- Produces:
  - `interface GenerateOptions { industry?: string; force: boolean; concurrency?: number }`
  - `interface Rejection { key: string; problems: string[] }`
  - `interface GenerateReport { written: string[]; skipped: string[]; rejected: Rejection[] }`
  - `interface GeneratorDeps { generatePlan: (need: RoleNeed, requester: string) => Promise<PersuasionPlan>; generatePersona: (role: RoleRef, index: 1 | 2, avoidNames: readonly string[]) => Promise<TargetPersona>; now: () => Date }`
  - `generateLabContent(client: SupabaseClient, options: GenerateOptions, deps?: GeneratorDeps): Promise<GenerateReport>`

- [ ] **Step 1: Write the failing test**

`tests/persuade/generate-lab-content.test.ts`:

```ts
/**
 * @vitest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, test } from 'vitest'
import type { PersuasionPlan, TargetPersona } from '../../src/persuade/engine/types'
import {
  type GeneratorDeps,
  generateLabContent,
} from '../../src/persuade/lib/generate-lab-content'
import type { RoleNeed, RoleRef } from '../../src/persuade/lib/lab-generator'
import { TEST_PERSONA, TEST_PLAN } from './helpers'

type Row = Record<string, unknown>

/** Stores rows and answers exactly the reads and upserts the generator makes. */
function fakeClient(seed: { needs: Row[]; personas?: Row[]; plans?: Row[]; failKey?: string }) {
  const tables: Record<string, Row[]> = {
    role_needs: seed.needs,
    persuasion_personas: seed.personas ?? [],
    persuasion_lab_plans: seed.plans ?? [],
  }
  const touched = new Set<string>()
  const upserts: { table: string; row: Row; onConflict: string }[] = []

  const client = {
    from(table: string) {
      touched.add(table)
      return {
        select() {
          return { order: async () => ({ data: tables[table] ?? [], error: null }) }
        },
        async upsert(row: Row, options: { onConflict: string }) {
          upserts.push({ table, row, onConflict: options.onConflict })
          if (row[options.onConflict] === seed.failKey) return { error: { message: 'disk full' } }
          const current = tables[table] ?? []
          const at = current.findIndex((r) => r[options.onConflict] === row[options.onConflict])
          tables[table] = at >= 0 ? current.map((r, i) => (i === at ? row : r)) : [...current, row]
          return { error: null }
        },
      }
    },
  } as unknown as SupabaseClient

  return { client, touched, upserts }
}

const needRow = (roleSlug: string, roleOrder: number, needKey: string, industry = 'retail'): Row => ({
  industry,
  role_slug: roleSlug,
  role_label: roleSlug === 'ceo' ? 'מנכ"ל' : 'מנהל חנות',
  role_order: roleOrder,
  need_key: needKey,
  need_label: `צורך ${needKey}`,
  meta_need: 'people',
})

const NOW = new Date('2026-09-17T12:00:00.000Z')

/** Scripted generators: plans are TEST_PLAN re-keyed, personas get the next name from a list. */
function deps(names: string[] = ['נועה', 'רון', 'מיכל', 'יונתן'], overrides: Partial<GeneratorDeps> = {}) {
  const calls = { plans: [] as { key: string; requester: string }[], personas: [] as { key: string; avoid: readonly string[] }[] }
  let next = 0
  const value: GeneratorDeps = {
    generatePlan: async (need: RoleNeed, requester: string): Promise<PersuasionPlan> => {
      calls.plans.push({ key: `gen-${need.industry}-${need.roleSlug}-${need.needKey}`, requester })
      return {
        ...TEST_PLAN,
        id: `gen-${need.industry}-${need.roleSlug}-${need.needKey}`,
        onBehalfOf: { name: requester, title: requester, mandate: 'x' },
      }
    },
    generatePersona: async (role: RoleRef, index: 1 | 2, avoid: readonly string[]): Promise<TargetPersona> => {
      calls.personas.push({ key: `gen-${role.industry}-${role.roleSlug}-${index}`, avoid })
      const name = names[next] ?? `שם${next}`
      next += 1
      return { ...TEST_PERSONA, id: `gen-${role.industry}-${role.roleSlug}-${index}`, name, role: role.roleLabel }
    },
    now: () => NOW,
    ...overrides,
  }
  return { value, calls }
}

describe('generateLabContent', () => {
  test('writes two personas per role and one plan per need, marked as generated', async () => {
    const { client, upserts } = fakeClient({
      needs: [needRow('ceo', 1, 'growth'), needRow('store-manager', 4, 'training'), needRow('store-manager', 4, 'service')],
    })
    const { value, calls } = deps()

    const report = await generateLabContent(client, { force: false }, value)

    expect(report.rejected).toEqual([])
    expect(report.skipped).toEqual([])
    expect([...report.written].sort()).toEqual([
      'gen-retail-ceo-1',
      'gen-retail-ceo-2',
      'gen-retail-ceo-growth',
      'gen-retail-store-manager-1',
      'gen-retail-store-manager-2',
      'gen-retail-store-manager-service',
      'gen-retail-store-manager-training',
    ])

    const persona = upserts.find((u) => u.row.persona_key === 'gen-retail-store-manager-1')
    expect(persona?.onConflict).toBe('persona_key')
    expect(persona?.row).toMatchObject({
      industry: 'retail',
      job_role_name: 'מנהל חנות',
      role: 'מנהל חנות',
      is_active: true,
      source: 'generated',
      generated_at: NOW.toISOString(),
      hidden_truth: TEST_PERSONA.hiddenTruth,
      agrees_when: TEST_PERSONA.agreesWhen,
      motivated_by: TEST_PERSONA.motivatedBy,
    })

    const plan = upserts.find((u) => u.row.plan_key === 'gen-retail-store-manager-training')
    expect(plan?.onConflict).toBe('plan_key')
    expect(plan?.row).toMatchObject({
      industry: 'retail',
      job_role_name: 'מנהל חנות',
      title: `צורך training: ${TEST_PLAN.topic}`,
      is_active: true,
      source: 'generated',
      generated_at: NOW.toISOString(),
    })

    // The store manager (order 4) has no role at order 3 in this data.
    expect(calls.plans.find((c) => c.key === 'gen-retail-store-manager-training')?.requester).toBe('הנהלת החברה')
  })

  test('reads role_needs and the two lab tables, and nothing else', async () => {
    const { client, touched } = fakeClient({ needs: [needRow('ceo', 1, 'growth')] })
    await generateLabContent(client, { force: false }, deps().value)
    expect([...touched].sort()).toEqual(['persuasion_lab_plans', 'persuasion_personas', 'role_needs'])
  })

  test('filters to one industry when asked', async () => {
    const { client } = fakeClient({
      needs: [needRow('ceo', 1, 'growth'), needRow('banker', 3, 'loans', 'bank')],
    })
    const report = await generateLabContent(client, { industry: 'bank', force: false }, deps().value)
    expect(report.written.every((key) => key.startsWith('gen-bank-'))).toBe(true)
    expect(report.written).toHaveLength(3)
  })

  test('skips keys that already exist unless forced', async () => {
    const seed = {
      needs: [needRow('ceo', 1, 'growth')],
      personas: [
        { persona_key: 'gen-retail-ceo-1', name: 'דנה' },
        { persona_key: 'gen-retail-ceo-2', name: 'גיל' },
      ],
      plans: [{ plan_key: 'gen-retail-ceo-growth', plan: TEST_PLAN }],
    }

    const skipping = fakeClient(seed)
    const first = await generateLabContent(skipping.client, { force: false }, deps().value)
    expect(first.written).toEqual([])
    expect([...first.skipped].sort()).toEqual(['gen-retail-ceo-1', 'gen-retail-ceo-2', 'gen-retail-ceo-growth'])
    expect(skipping.upserts).toHaveLength(0)

    const forcing = fakeClient(seed)
    const second = await generateLabContent(forcing.client, { force: true }, deps().value)
    expect(second.skipped).toEqual([])
    expect(second.written).toHaveLength(3)
  })

  test('a regenerated persona may keep its own old name', async () => {
    const { client } = fakeClient({
      needs: [needRow('ceo', 1, 'growth')],
      personas: [{ persona_key: 'gen-retail-ceo-1', name: 'נועה' }],
    })
    const report = await generateLabContent(client, { force: true }, deps(['נועה', 'רון']).value)
    expect(report.rejected).toEqual([])
  })

  test('rejects a persona whose name another persona has, or a stored plan mentions', async () => {
    const { client } = fakeClient({
      needs: [needRow('ceo', 1, 'growth')],
      personas: [{ persona_key: 'adi', name: 'עדי' }],
      // TEST_PLAN is made on behalf of אושר.
      plans: [{ plan_key: 'briefings', plan: TEST_PLAN }],
    })
    const report = await generateLabContent(client, { force: false }, deps(['עדי', 'אושר']).value)

    expect(report.rejected).toEqual([
      { key: 'gen-retail-ceo-1', problems: ['השם "עדי" כבר שייך לדמות אחרת'] },
      { key: 'gen-retail-ceo-2', problems: ['השם "אושר" מופיע בתוכנית קיימת'] },
    ])
  })

  test('rejects a plan that mentions a persona, including one written in this run', async () => {
    const { client } = fakeClient({ needs: [needRow('ceo', 1, 'growth')] })
    // The plan names its requester אושר, and the first persona is called אושר.
    const scripted = deps(['אושר', 'רון'], {
      generatePlan: async (need) => ({ ...TEST_PLAN, id: `gen-${need.industry}-${need.roleSlug}-${need.needKey}` }),
    })
    const report = await generateLabContent(client, { force: false }, scripted.value)
    expect(report.rejected).toEqual([
      { key: 'gen-retail-ceo-growth', problems: ['התוכנית מזכירה בשמה את הדמות "אושר"'] },
    ])
  })

  test('a model error or a failed write rejects that item and the run continues', async () => {
    const { client } = fakeClient({
      needs: [needRow('ceo', 1, 'growth'), needRow('ceo', 1, 'people')],
      failKey: 'gen-retail-ceo-people',
    })
    const scripted = deps(undefined, {
      generatePersona: async (role, index) => {
        if (index === 2) throw new Error('rate limited')
        return { ...TEST_PERSONA, id: `gen-${role.industry}-${role.roleSlug}-${index}`, name: 'נועה' }
      },
    })

    const report = await generateLabContent(client, { force: false }, scripted.value)

    expect(report.written.sort()).toEqual(['gen-retail-ceo-1', 'gen-retail-ceo-growth'])
    expect(report.rejected).toEqual([
      { key: 'gen-retail-ceo-2', problems: ['rate limited'] },
      { key: 'gen-retail-ceo-people', problems: ['שמירה נכשלה: disk full'] },
    ])
  })

  test('refuses to run when there are no needs to generate from', async () => {
    const { client } = fakeClient({ needs: [] })
    await expect(generateLabContent(client, { force: false }, deps().value)).rejects.toThrow('role_needs')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/persuade/generate-lab-content.test.ts`
Expected: FAIL, cannot resolve `../../src/persuade/lib/generate-lab-content`.

- [ ] **Step 3: Implement**

`src/persuade/lib/generate-lab-content.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PersuasionPlan, TargetPersona } from '../engine/types'
import { mentionsName, personaProblems, planProblems } from './lab-content-checks'
import {
  generatePersona,
  generatePlan,
  personaKeyFor,
  planKeyFor,
  type RoleNeed,
  type RoleRef,
  requesterFor,
} from './lab-generator'
import { runPool } from './pool'

/**
 * `pnpm lab:generate`: role_needs in, validated personas and plans out.
 *
 * Personas are written before plans, one at a time, so every plan is checked
 * against every persona name that will exist when it runs, and so no two new
 * personas share a name. Plans are independent of each other and run a few at
 * a time.
 *
 * Reads role_needs and the two lab tables. It never reads rules, roles,
 * documents or profiles, which belong to a business; the tenant boundary test
 * holds this file to that.
 */

const KEY_PATTERN = /^[a-z0-9-]+$/
const TITLE_MAX = 120
const JOB_ROLE_MAX = 40

export interface GenerateOptions {
  industry?: string
  force: boolean
  concurrency?: number
}

export interface Rejection {
  key: string
  problems: string[]
}

export interface GenerateReport {
  written: string[]
  skipped: string[]
  rejected: Rejection[]
}

export interface GeneratorDeps {
  generatePlan: (need: RoleNeed, requester: string) => Promise<PersuasionPlan>
  generatePersona: (role: RoleRef, index: 1 | 2, avoidNames: readonly string[]) => Promise<TargetPersona>
  now: () => Date
}

const DEFAULT_DEPS: GeneratorDeps = { generatePlan, generatePersona, now: () => new Date() }

interface RoleNeedRow {
  industry: string
  role_slug: string
  role_label: string
  role_order: number
  need_key: string
  need_label: string
  meta_need: string
}

const describe = (cause: unknown): string => (cause instanceof Error ? cause.message : 'שגיאה לא ידועה')

async function readRoleNeeds(client: SupabaseClient, industry: string | undefined): Promise<RoleNeed[]> {
  const { data, error } = await client
    .from('role_needs')
    .select('industry,role_slug,role_label,role_order,need_key,need_label,meta_need')
    .order('role_order')
  if (error) throw new Error(`קריאת role_needs נכשלה: ${error.message}`)

  // Filtered here rather than in the query: 80 rows, and one query shape is one
  // thing to fake in a test.
  return ((data ?? []) as RoleNeedRow[])
    .filter((row) => industry === undefined || row.industry === industry)
    .map((row) => ({
      industry: row.industry,
      roleSlug: row.role_slug,
      roleLabel: row.role_label,
      roleOrder: row.role_order,
      needKey: row.need_key,
      needLabel: row.need_label,
      metaNeed: row.meta_need,
    }))
    .sort(
      (a, b) =>
        a.industry.localeCompare(b.industry) || a.roleOrder - b.roleOrder || a.needKey.localeCompare(b.needKey),
    )
}

async function readPersonaNames(client: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await client.from('persuasion_personas').select('persona_key,name').order('persona_key')
  if (error) throw new Error(`קריאת הדמויות נכשלה: ${error.message}`)
  return new Map(((data ?? []) as { persona_key: string; name: string }[]).map((row) => [row.persona_key, row.name]))
}

async function readPlans(client: SupabaseClient): Promise<Map<string, PersuasionPlan>> {
  const { data, error } = await client.from('persuasion_lab_plans').select('plan_key,plan').order('plan_key')
  if (error) throw new Error(`קריאת התוכניות נכשלה: ${error.message}`)
  return new Map(((data ?? []) as { plan_key: string; plan: PersuasionPlan }[]).map((row) => [row.plan_key, row.plan]))
}

function rolesOf(needs: readonly RoleNeed[]): RoleRef[] {
  const seen = new Map<string, RoleRef>()
  for (const need of needs) {
    const id = `${need.industry}:${need.roleSlug}`
    if (!seen.has(id)) {
      seen.set(id, {
        industry: need.industry,
        roleSlug: need.roleSlug,
        roleLabel: need.roleLabel,
        roleOrder: need.roleOrder,
      })
    }
  }
  return [...seen.values()]
}

function keyAndRoleProblems(key: string, roleLabel: string): string[] {
  const problems: string[] = []
  if (!KEY_PATTERN.test(key)) problems.push(`מפתח לא תקין: ${key}`)
  if (roleLabel.trim().length > JOB_ROLE_MAX) problems.push(`שם התפקיד ארוך מ-${JOB_ROLE_MAX} תווים`)
  return problems
}

async function generatePersonas(
  client: SupabaseClient,
  roles: readonly RoleRef[],
  options: GenerateOptions,
  deps: GeneratorDeps,
): Promise<GenerateReport> {
  const [names, plans] = await Promise.all([readPersonaNames(client), readPlans(client)])
  const planBlobs = [...plans.values()].map((plan) => JSON.stringify(plan))
  const written: string[] = []
  const skipped: string[] = []
  const rejected: Rejection[] = []

  for (const role of roles) {
    for (const index of [1, 2] as const) {
      const key = personaKeyFor(role, index)
      if (names.has(key) && !options.force) {
        skipped.push(key)
        continue
      }

      // Every name but this key's own, so a regenerated persona may keep its name.
      const taken = [...names.entries()].filter(([other]) => other !== key).map(([, name]) => name)

      try {
        const persona = await deps.generatePersona(role, index, taken)
        const problems = [...personaProblems(persona), ...keyAndRoleProblems(key, role.roleLabel)]
        if (taken.includes(persona.name)) problems.push(`השם "${persona.name}" כבר שייך לדמות אחרת`)
        if (planBlobs.some((blob) => mentionsName(blob, persona.name))) {
          problems.push(`השם "${persona.name}" מופיע בתוכנית קיימת`)
        }
        if (problems.length > 0) {
          rejected.push({ key, problems })
          continue
        }

        const { error } = await client.from('persuasion_personas').upsert(
          {
            persona_key: key,
            industry: role.industry,
            job_role_name: role.roleLabel,
            name: persona.name,
            role: role.roleLabel,
            resistance: persona.resistance,
            reliability: persona.reliability,
            situation: persona.situation,
            hidden_truth: persona.hiddenTruth,
            motivated_by: persona.motivatedBy,
            style: persona.style,
            agrees_when: persona.agreesWhen,
            is_active: true,
            source: 'generated',
            generated_at: deps.now().toISOString(),
          },
          { onConflict: 'persona_key' },
        )
        if (error) {
          rejected.push({ key, problems: [`שמירה נכשלה: ${error.message}`] })
          continue
        }

        names.set(key, persona.name)
        written.push(key)
      } catch (cause) {
        rejected.push({ key, problems: [describe(cause)] })
      }
    }
  }

  return { written, skipped, rejected }
}

async function generatePlans(
  client: SupabaseClient,
  needs: readonly RoleNeed[],
  options: GenerateOptions,
  deps: GeneratorDeps,
): Promise<GenerateReport> {
  // Read after the personas are written, so this run's names are checked too.
  const [names, plans] = await Promise.all([readPersonaNames(client), readPlans(client)])
  const personaNames = [...names.values()]

  const todo = needs.filter((need) => options.force || !plans.has(planKeyFor(need)))
  const skipped = needs.filter((need) => !todo.includes(need)).map(planKeyFor)

  const outcomes = await runPool(todo, options.concurrency ?? 4, async (need): Promise<Rejection> => {
    const key = planKeyFor(need)
    try {
      const plan = await deps.generatePlan(need, requesterFor(need, needs))
      const problems = [...planProblems(plan, personaNames), ...keyAndRoleProblems(key, need.roleLabel)]
      if (problems.length > 0) return { key, problems }

      const { error } = await client.from('persuasion_lab_plans').upsert(
        {
          plan_key: key,
          industry: need.industry,
          job_role_name: need.roleLabel,
          title: `${need.needLabel}: ${plan.topic}`.slice(0, TITLE_MAX),
          plan,
          is_active: true,
          source: 'generated',
          generated_at: deps.now().toISOString(),
        },
        { onConflict: 'plan_key' },
      )
      return error ? { key, problems: [`שמירה נכשלה: ${error.message}`] } : { key, problems: [] }
    } catch (cause) {
      return { key, problems: [describe(cause)] }
    }
  })

  return {
    written: outcomes.filter((outcome) => outcome.problems.length === 0).map((outcome) => outcome.key),
    skipped,
    rejected: outcomes.filter((outcome) => outcome.problems.length > 0),
  }
}

export async function generateLabContent(
  client: SupabaseClient,
  options: GenerateOptions,
  deps: GeneratorDeps = DEFAULT_DEPS,
): Promise<GenerateReport> {
  const needs = await readRoleNeeds(client, options.industry)
  if (needs.length === 0) {
    throw new Error(
      options.industry ? `אין צרכים ב-role_needs לענף "${options.industry}"` : 'אין צרכים ב-role_needs',
    )
  }

  const personas = await generatePersonas(client, rolesOf(needs), options, deps)
  const plans = await generatePlans(client, needs, options, deps)

  return {
    written: [...personas.written, ...plans.written],
    skipped: [...personas.skipped, ...plans.skipped],
    rejected: [...personas.rejected, ...plans.rejected],
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/persuade/generate-lab-content.test.ts`
Expected: all PASS.

- [ ] **Step 5: Gate and commit**

```bash
pnpm lint:fix && pnpm run ci
git add src/persuade/lib/generate-lab-content.ts tests/persuade/generate-lab-content.test.ts
git commit -m "feat: generate, validate and store lab content, one rejection at a time

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Script, boundary test, docs

**Files:**
- Create: `scripts/generate-lab-content.ts`
- Modify: `package.json` (scripts), `tests/persuade/tenant-boundary.test.ts`, `CLAUDE.md` (the "The simulation loop" section)

- [ ] **Step 1: Extend the tenant boundary test (it should pass already; it guards the future)**

In `tests/persuade/tenant-boundary.test.ts`, inside `it('holds for the loop that runs simulations unattended', ...)`, after the `feed.ts` assertions, add:

```ts
    // Generated lab content becomes the loop's inputs, so its source is held to
    // the same boundary: role_needs describes roles, never a business.
    for (const path of ['src/persuade/lib/lab-generator.ts', 'src/persuade/lib/generate-lab-content.ts']) {
      const text = source(path)
      expect(text).not.toMatch(/ammunition/i)
      expect(text).not.toMatch(/tenantId|tenant_id/)
      expect(text).not.toMatch(/assignmentId|assignment_id/)
      expect(text).not.toMatch(/from\('(rules|roles|documents|profiles)'\)/)
    }
```

Run: `pnpm vitest run tests/persuade/tenant-boundary.test.ts`
Expected: PASS.

- [ ] **Step 2: Write the script**

`scripts/generate-lab-content.ts`:

```ts
/**
 * Writes the lab's generated personas and plans from role_needs.
 *
 *   pnpm lab:generate [--industry=retail] [--force]
 *
 * Calls the planner model about 112 times for all three industries and writes
 * to the linked project, so run it deliberately. Existing keys are skipped
 * unless --force. Exits non-zero when anything was rejected, with the reasons.
 */
import { createClient } from '@supabase/supabase-js'
import { env } from './lib/db'

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]

async function main(): Promise<void> {
  // Credentials first, then the modules that read model settings from the
  // environment: model.ts resolves model ids when it is imported, so a static
  // import would miss anything env() just loaded from .env.local.
  const { url, key } = env()
  const { assertModelAccessConfigured } = await import('../src/persuade/lib/model')
  const { generateLabContent } = await import('../src/persuade/lib/generate-lab-content')
  assertModelAccessConfigured()

  const db = createClient(url, key, { auth: { persistSession: false } })
  const report = await generateLabContent(db, {
    industry: arg('industry'),
    force: process.argv.includes('--force'),
  })

  console.log(
    `נכתבו ${report.written.length}, דולגו ${report.skipped.length}, נדחו ${report.rejected.length}.`,
  )
  for (const rejection of report.rejected) {
    console.error(`  - ${rejection.key}: ${rejection.problems.join(' · ')}`)
  }
  if (report.rejected.length > 0) process.exitCode = 1
}

await main()
```

- [ ] **Step 3: Add the package script**

In `package.json` `scripts`, directly after the `"validate:lab"` line, add:

```json
    "lab:generate": "tsx scripts/generate-lab-content.ts",
```

- [ ] **Step 4: Document it**

In `CLAUDE.md`, in `### The simulation loop`, add this bullet after the `**The feed**` bullet:

```markdown
- **Generated content** comes from `pnpm lab:generate [--industry=retail]
  [--force]`, which writes two personas per role and one plan per need from
  eran-task's `role_needs` (`src/persuade/lib/generate-lab-content.ts`). Every
  item passes the same checks as `pnpm validate:lab` before it is written, and
  is stored with `source = 'generated'` and `generated_at`, so a bad batch is
  switched off with one update. A plan targets the role that owns the need and
  is made on behalf of the role listed above it, never a named person. Adding or
  changing active content restarts the feed's walk.
```

- [ ] **Step 5: Gate and commit**

```bash
pnpm lint:fix && pnpm run ci
git add scripts/generate-lab-content.ts package.json tests/persuade/tenant-boundary.test.ts CLAUDE.md
git commit -m "feat: pnpm lab:generate, held to the simulation tenant boundary

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Rollout (every step requires user approval)

**Files:** none

- [ ] **Step 1: Verify the migration in a rolled-back transaction**

```bash
cd /Users/itayostraich/Documents/GitHub/eran-task
out=/private/tmp/claude-501/verify_lab_content_source.sql
{ echo 'begin;'; cat supabase/migrations/20260917120000_lab_content_source.sql; cat supabase/verify/20260917120000_lab_content_source.sql; echo 'rollback;'; } > "$out"
supabase db query --linked -f "$out"
supabase db query --linked "select count(*) from information_schema.columns where table_schema='public' and table_name in ('persuasion_personas','persuasion_lab_plans') and column_name in ('source','generated_at')"
```
Expected: no error from the first command; the count is `0` (rolled back). Also run a negative control once: the migration followed by `do $$ begin raise exception 'negative control'; end $$;` inside `begin; ... rollback;` must return that error.

- [ ] **Step 2: Push both branches, open PRs.** The minene PR must say it depends on the eran-task migration: `lab:generate` writes `source` and `generated_at`, which do not exist until it is applied. Nothing in the running app reads the new columns, so merging minene first breaks nothing; only the script needs the migration.

- [ ] **Step 3: Merge eran-task, `supabase migration list --linked` (only `20260917120000` pending), `supabase db push --linked`.**

- [ ] **Step 4: Merge minene.**

- [ ] **Step 5: Generate retail first**

```bash
cd /Users/itayostraich/Documents/GitHub/minene
git switch main && git pull --ff-only
pnpm lab:generate --industry=retail
pnpm validate:lab
```
Expected: about 10 personas and 25 plans written, rejections listed with reasons, `validate:lab` passes. Show the user two generated plans (`ask.oneLiner`, `topic`, first two arguments) and two personas before continuing.

- [ ] **Step 6: Generate bank and healthcare**, then `pnpm validate:lab` again.

- [ ] **Step 7: Confirm the feed picked it up**

```bash
cd /Users/itayostraich/Documents/GitHub/eran-task
supabase db query --linked "select next_index, pass, inputs_version, refilled_at from public.simulation_feed"
supabase db query --linked "select plan_key, count(*) from public.simulation_jobs where created_at > now() - interval '1 hour' group by plan_key order by 2 desc limit 10"
```
Expected: after the next refill, `inputs_version` differs from `dc3828e86243756d` and new jobs carry `gen-` plan keys. Refill only happens when fewer than 50 jobs are pending, so this can take a few hours while the 192 already queued drain.
