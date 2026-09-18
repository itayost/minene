# Response Law Training Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the lab and the engine the product spec's response law: a simulated counterpart can go quiet, an unanswered message climbs the escalation ladder, three of them end the run as `no_response`, "yes, yes, tomorrow" stops counting as agreement, and every run is judged on whether it got a valid response.

**Architecture:** A new world axis (`responsiveness`) decides whether the simulated person answers; `runSimulation` skips the counterpart's model call when they do not and records a `silent` turn instead. The deterministic rule engine gains the silence ladder and a vague-commitment check, both defaulted so a run with no silence behaves exactly as today. The judge gains one field. One eran-task migration widens the two `outcome` check constraints.

**Tech Stack:** TypeScript strict, AI SDK v7 with `MockLanguageModelV3` in tests, zod 4, Vitest, Biome, Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-09-18-response-law-training-design.md`

## Global Constraints

- Repos: code in `minene` on branch `feat/response-law-training` (already created from `main`, spec committed at `ff8e57c`); migration in `eran-task` on a new branch `feat/no-response-outcome`.
- A run with no silence must behave exactly as it does today. Every existing simulation, prompt and rules test must keep passing unchanged unless this plan says otherwise.
- `responsiveness` is optional on `WorldState`: absent means `answers`. `isWorldState` must keep accepting worlds written before this change, or the ~136 queued jobs and every stored simulation break.
- The world reaches the simulated counterpart only. `tests/persuade/world-isolation.test.ts` asserts the literal call text `targetReply(persona, plan, turns, world)` in `simulation.ts` and that the `persuaderTurn(` call carries no `world`; keep both true.
- A silent turn is `{ role: 'target', text: '', silent: true, interaction }`. Never invent words for a person who said nothing.
- No tenant tokens (`ammunition`, `tenantId`/`tenant_id`, `assignmentId`/`assignment_id`) in `simulation.ts`, `worker.ts`, `feed.ts`, `lab-generator.ts`, `generate-lab-content.ts`.
- minene style: no semicolons, single quotes, 2-space indent, Biome; comments explain why; Hebrew user-facing strings; no emojis; TypeScript strict with `noUncheckedIndexedAccess`.
- Gate before every commit in minene: `pnpm lint:fix` then `pnpm run ci` (never `pnpm ci`, a reserved pnpm builtin).
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Anything that writes to the linked Supabase project, pushes, opens or merges a PR, or calls a paid model needs explicit user approval in the session.

## File Map

**eran-task**
- Create `supabase/migrations/20260918120000_no_response_outcome.sql` and `supabase/verify/20260918120000_no_response_outcome.sql`.

**minene**
- `src/persuade/engine/world.ts`: `Responsiveness`, the axis in `WorldCell`/`WorldState`/`worldCells`/`buildWorld`/`describeWorld`/`isWorldState`, plus `responsivenessOf` and `staysSilent`.
- `src/persuade/engine/types.ts`: `Turn.silent`, `Outcome` gains `no_response`, `RunScore.responseValidity`.
- `src/persuade/engine/prompts.ts`: silent turns render as a no-reply marker for the persuader and are dropped for the counterpart.
- `src/persuade/engine/knowledge.ts`: `VAGUE_COMMITMENT_MARKERS`.
- `src/persuade/engine/rules.ts`: `maxSilences`, `enforceSilenceLadder`, fatigue ignores silence, `applySilence`, `detectOutcome` vague check, `shouldStop` for `no_response`.
- `src/persuade/engine/simulation.ts`: skip the counterpart's call when the world says silent.
- `src/persuade/engine/score.ts`: `responseValidity` in the schema, the prompt and the transcript.
- `CLAUDE.md`.
- Tests: `tests/persuade/silence.test.ts` (new), plus edits to `world-isolation.test.ts`, `rules.test.ts`, `prompts.test.ts`, `simulation.test.ts`, `outcome-integrity.test.ts`.

---

### Task 0: Branches and baseline

- [ ] **Step 1: minene**

```bash
cd /Users/itayostraich/Documents/GitHub/minene
git branch --show-current     # expect: feat/response-law-training
git log --oneline -1          # expect: ff8e57c docs: design for training the bot on the response law
pnpm lint:fix && pnpm run ci
```
Expected: exit 0, `Test Files 86 passed`, `Tests 827 passed` or more. Stop and report any failure before changing code.

- [ ] **Step 2: eran-task**

```bash
cd /Users/itayostraich/Documents/GitHub/eran-task
git switch main && git pull --ff-only
git switch -c feat/no-response-outcome
```

---

### Task 1: The `no_response` outcome in the database

**Files:**
- Create: `eran-task/supabase/migrations/20260918120000_no_response_outcome.sql`
- Create: `eran-task/supabase/verify/20260918120000_no_response_outcome.sql`

**Interfaces:**
- Produces (database): `conversations.outcome` and `simulations.outcome` accept `no_response` in addition to their current values.

- [ ] **Step 1: Write the migration**

```sql
-- A conversation nobody answered.
--
-- The engine's outcomes all describe something the counterpart did: agreed,
-- refused, deferred, ran out of patience. The product spec's response law names
-- a different failure -- the message was never answered at all -- and the two
-- must not be merged: a deferral was answered and dodged, a non-response was
-- never answered, and the matrix has to tell a bot that gets ignored apart from
-- one that gets put off.
--
-- Widened rather than replaced with a lookup table: the list is small, it is
-- the engine's own vocabulary, and a table would put a join in front of every
-- read of a column every report groups by.

alter table public.conversations drop constraint conversations_outcome_check;

alter table public.conversations add constraint conversations_outcome_check
  check (outcome in (
    'open', 'agreed', 'refused', 'escalate_to_manager', 'stopped_fatigue',
    'deferred', 'no_response'
  ));

alter table public.simulations drop constraint simulations_outcome_check;

alter table public.simulations add constraint simulations_outcome_check
  check (outcome in (
    'open', 'agreed', 'refused', 'escalate_to_manager', 'stopped_fatigue',
    'deferred', 'no_response'
  ));
```

If either constraint is not named as written, find the real name first with:

```bash
supabase db query --linked "select conrelid::regclass as t, conname from pg_constraint where conname like '%outcome%'"
```
and use the names it prints. Do not run that command without the user's approval; if you cannot, state the assumption in your report.

- [ ] **Step 2: Write the verification script**

```sql
-- Runs after the migration, inside `begin; <migration>; <this>; rollback;`.
-- Leaves rows behind if you run it any other way.
do $$
declare
  n int;
begin
  insert into public.simulations (industry, persona_id, plan, turns, state, outcome)
  values ('retail', 'verify', '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, 'no_response');

  select count(*) into n from public.simulations where persona_id = 'verify' and outcome = 'no_response';
  if n <> 1 then raise exception 'no_response was not accepted on simulations'; end if;

  begin
    insert into public.simulations (industry, persona_id, plan, turns, state, outcome)
    values ('retail', 'verify2', '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, 'ghosted');
    raise exception 'an unknown outcome was accepted on simulations';
  exception when check_violation then
    null;
  end;

  -- Every outcome the engine already produces must still be accepted. Inserted
  -- for real rather than compared against a copy of the list: a check written
  -- against its own literal passes whatever the constraint says.
  insert into public.simulations (industry, persona_id, plan, turns, state, outcome)
  select 'retail', 'verify-' || o, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, o
  from unnest(array['open', 'agreed', 'refused', 'escalate_to_manager', 'stopped_fatigue', 'deferred']) as o;

  select count(*) into n from public.simulations where persona_id like 'verify-%';
  if n <> 6 then raise exception 'expected all six existing outcomes to insert, got %', n; end if;

  raise notice 'no_response_outcome verification passed';
end;
$$;
```

If `public.simulations` has NOT NULL columns beyond those listed, add them to both inserts with any valid value; read `supabase/migrations/20260827100000_add_simulations.sql` to check before writing.

- [ ] **Step 3: Commit (eran-task, no push)**

```bash
git add supabase/migrations/20260918120000_no_response_outcome.sql supabase/verify/20260918120000_no_response_outcome.sql
git commit -m "feat: a conversation nobody answered is its own outcome

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The responsiveness axis

**Files:**
- Modify: `src/persuade/engine/world.ts`
- Modify: `tests/persuade/world-isolation.test.ts` (cell count and a new isolation case)
- Test: `tests/persuade/silence.test.ts` (new file, world section)

**Interfaces:**
- Produces:
  - `export type Responsiveness = 'answers' | 'slow' | 'silent'`
  - `WorldCell` and `WorldState` gain `responsiveness?: Responsiveness`
  - `responsivenessOf(world: WorldState | null): Responsiveness` (null or absent -> `answers`)
  - `staysSilent(world: WorldState | null, persuaderTurnIndex: number): boolean` where `persuaderTurnIndex` is 0 for the first persuader message: `silent` is always true, `slow` is true only at index 0, `answers` is always false
  - `worldCells()` returns 972 cells

- [ ] **Step 1: Write the failing test**

`tests/persuade/silence.test.ts`:

```ts
/**
 * @vitest-environment node
 */
import { describe, expect, test } from 'vitest'
import {
  buildWorld,
  describeWorld,
  isWorldState,
  responsivenessOf,
  staysSilent,
  type WorldState,
  worldCells,
} from '../../src/persuade/engine/world'

const cell = () => worldCells()[0] as ReturnType<typeof worldCells>[number]

describe('the responsiveness axis', () => {
  test('enumerates every combination, three times the old space', () => {
    const cells = worldCells()
    expect(cells).toHaveLength(972)
    expect(new Set(cells.map((c) => JSON.stringify(c))).size).toBe(972)
    expect(new Set(cells.map((c) => c.responsiveness))).toEqual(
      new Set(['answers', 'slow', 'silent']),
    )
  })

  test('a built world carries it and describes it to the counterpart', () => {
    const world = buildWorld({ ...cell(), responsiveness: 'silent' })
    expect(world.responsiveness).toBe('silent')
    expect(describeWorld(world)).toContain('אל תענה')
  })

  test('a world written before the axis existed is still valid and answers', () => {
    // Every queued job and every stored simulation holds one of these.
    const withoutAxis: Partial<WorldState> = { ...buildWorld(cell()) }
    // Deleted rather than destructured: an unused binding is a lint error here.
    delete withoutAxis.responsiveness
    expect(isWorldState(withoutAxis)).toBe(true)
    expect(responsivenessOf(withoutAxis as WorldState)).toBe('answers')
    expect(responsivenessOf(null)).toBe('answers')
  })

  test('an unknown responsiveness is not a world', () => {
    expect(isWorldState({ ...buildWorld(cell()), responsiveness: 'maybe' })).toBe(false)
  })

  test('staysSilent says who answers when', () => {
    const answers = buildWorld({ ...cell(), responsiveness: 'answers' })
    const slow = buildWorld({ ...cell(), responsiveness: 'slow' })
    const silent = buildWorld({ ...cell(), responsiveness: 'silent' })

    expect([0, 1, 2].map((i) => staysSilent(answers, i))).toEqual([false, false, false])
    // Slow ignores the opening message and answers from the second.
    expect([0, 1, 2].map((i) => staysSilent(slow, i))).toEqual([true, false, false])
    expect([0, 1, 2].map((i) => staysSilent(silent, i))).toEqual([true, true, true])
    expect(staysSilent(null, 0)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/persuade/silence.test.ts`
Expected: FAIL, `responsivenessOf` and `staysSilent` are not exported.

- [ ] **Step 3: Implement in `world.ts`**

Add the type beside the other axis types (near `Disposition`):

```ts
/**
 * Whether the person answers at all.
 *
 * The product spec's response law says a topic that matters demands a
 * response, and its ladder for silence is a reminder, a personal approach, then
 * the manager. None of that could ever be exercised while every simulated
 * counterpart always replied.
 */
export type Responsiveness = 'answers' | 'slow' | 'silent'
```

Add the constant beside `DISPOSITIONS`:

```ts
const RESPONSIVENESS: Responsiveness[] = ['answers', 'slow', 'silent']
```

Add to `WorldCell` and to `WorldState`:

```ts
  /**
   * Optional, and absent means `answers`.
   *
   * Every world queued or stored before this axis existed has no such field,
   * and isWorldState refusing them would fail every job already in the queue.
   */
  responsiveness?: Responsiveness
```

Wrap the innermost loop of `worldCells()` so each existing cell is emitted once per value:

```ts
          for (const disposition of DISPOSITIONS) {
            for (const responsiveness of RESPONSIVENESS) {
              cells.push({ motivation, workload, reason, pressureResponse, disposition, responsiveness })
            }
          }
```

In `describeWorld`, after the disposition line, add:

```ts
${RESPONSIVENESS_TEXT[responsivenessOf(world)]}
```

with the lookup beside the other text tables:

```ts
const RESPONSIVENESS_TEXT: Record<Responsiveness, string> = {
  answers: 'אתה עונה להודעות שמגיעות אליך.',
  slow: 'להודעה הראשונה אתה לא עונה בכלל. אתה עסוק ולא פנוי. מההודעה השנייה אתה עונה כרגיל.',
  silent: 'אתה לא עונה בכלל. אל תענה לאף הודעה, גם לא אחרי תזכורת או פנייה אישית.',
}
```

In `isWorldState`, accept an absent value and reject an unknown one, by adding to the returned expression:

```ts
    (w.responsiveness === undefined || RESPONSIVENESS.includes(w.responsiveness as Responsiveness)) &&
```

Add the two helpers at the end of the file:

```ts
/** Absent means the person answers: that is what every world written before this axis meant. */
export const responsivenessOf = (world: WorldState | null): Responsiveness =>
  world?.responsiveness ?? 'answers'

/**
 * Whether the counterpart stays quiet after the persuader's message at this index.
 *
 * Index 0 is the opening message, so `slow` ignores exactly one and then behaves
 * normally: being busy once is the common case, and a person who never answers
 * is a different cell.
 */
export function staysSilent(world: WorldState | null, persuaderTurnIndex: number): boolean {
  const responsiveness = responsivenessOf(world)
  if (responsiveness === 'silent') return true
  if (responsiveness === 'slow') return persuaderTurnIndex === 0
  return false
}
```

- [ ] **Step 4: Update the world-isolation test's cell count**

In `tests/persuade/world-isolation.test.ts`, the test `enumerates every combination, so coverage is a fact rather than a hope` expects 324. Change both numbers to 972 and its comment to name the sixth axis (`3 motivations x 3 workloads x 6 reasons x 3 pressure responses x 2 dispositions x 3 responsiveness`). In the same file, inside the test that renders `targetSystemPrompt` with a world, add an assertion that the responsiveness line reaches the counterpart:

```ts
    expect(rendered).toContain('אתה עונה להודעות שמגיעות אליך.')
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/persuade/silence.test.ts tests/persuade/world-isolation.test.ts tests/persuade/prompts.test.ts`
Expected: all PASS.

- [ ] **Step 6: Gate and commit**

```bash
pnpm lint:fix && pnpm run ci
git add src/persuade/engine/world.ts tests/persuade/silence.test.ts tests/persuade/world-isolation.test.ts
git commit -m "feat: a simulated person who does not answer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Silent turns, recorded and rendered

**Files:**
- Modify: `src/persuade/engine/types.ts` (`Turn.silent`, `Outcome`)
- Modify: `src/persuade/engine/prompts.ts` (`historyForModel`, `historyForTarget`)
- Modify: `src/persuade/engine/score.ts` (transcript rendering only)
- Test: `tests/persuade/silence.test.ts` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Turn.silent?: true`; `Outcome` includes `'no_response'`; `SILENT_TURN_MARKER = '[לא ענה]'` exported from `prompts.ts`.

- [ ] **Step 1: Write the failing test (append to `tests/persuade/silence.test.ts`)**

```ts
import { historyForModel, historyForTarget, SILENT_TURN_MARKER } from '../../src/persuade/engine/prompts'
import type { Turn } from '../../src/persuade/engine/types'

const persuaderTurn = (text: string, interaction: number): Turn => ({
  role: 'persuader',
  text,
  interaction,
})
const silentTurn = (interaction: number): Turn => ({
  role: 'target',
  text: '',
  silent: true,
  interaction,
})

describe('a turn nobody answered', () => {
  test('reaches the persuader as an explicit no-reply, never as empty text', () => {
    const history = historyForModel([persuaderTurn('שלום', 0), silentTurn(0)])

    expect(history).toEqual([
      { role: 'assistant', content: 'שלום' },
      { role: 'user', content: SILENT_TURN_MARKER },
    ])
    // An empty user message is rejected by some providers and teaches nothing.
    expect(history.every((m) => m.content.length > 0)).toBe(true)
  })

  test('is dropped from the counterpart’s own history', () => {
    // The counterpart did not speak, so there is nothing for it to see itself say.
    expect(historyForTarget([persuaderTurn('שלום', 0), silentTurn(0)])).toEqual([
      { role: 'user', content: 'שלום' },
    ])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/persuade/silence.test.ts`
Expected: FAIL, `SILENT_TURN_MARKER` is not exported.

- [ ] **Step 3: Implement**

In `src/persuade/engine/types.ts`, add to `Turn` after `text`:

```ts
  /**
   * Set when the counterpart did not answer this message at all.
   *
   * `text` stays empty rather than holding a stand-in like "(לא ענה)": a turn is
   * replayed into the model's prompt and exported as training data, and a
   * sentence nobody said would be taught as one they did.
   */
  silent?: true
```

In the same file, add `'no_response'` to the `Outcome` union, with a short comment:

```ts
  /** Nobody ever answered. Different from a deferral, which was answered and dodged. */
  | 'no_response'
```

In `src/persuade/engine/prompts.ts`:

```ts
/** What the persuader sees where a reply should have been. */
export const SILENT_TURN_MARKER = '[לא ענה]'
```

and rewrite the two history functions:

```ts
export function historyForModel(turns: Turn[]): { role: 'user' | 'assistant'; content: string }[] {
  return turns.map((t) => ({
    role: t.role === 'persuader' ? ('assistant' as const) : ('user' as const),
    content: t.silent ? SILENT_TURN_MARKER : t.text,
  }))
}

/** The counterpart sees the mirror image of the history, minus its own silences. */
export function historyForTarget(turns: Turn[]): { role: 'user' | 'assistant'; content: string }[] {
  return turns
    .filter((t) => !t.silent)
    .map((t) => ({
      role: t.role === 'target' ? ('assistant' as const) : ('user' as const),
      content: t.text,
    }))
}
```

In `src/persuade/engine/score.ts`, the transcript currently maps every turn to `${role}: ${text}`. Change that map so a silent turn renders as the marker:

```ts
  const transcript = turns
    .map((t) => `${t.role === 'persuader' ? 'משכנע' : 'נמען'}: ${t.silent ? '(לא ענה)' : t.text}`)
    .join('\n')
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/persuade/silence.test.ts tests/persuade/prompts.test.ts tests/persuade/dataset.test.ts`
Expected: all PASS.

- [ ] **Step 5: Gate and commit**

```bash
pnpm lint:fix && pnpm run ci
git add src/persuade/engine/types.ts src/persuade/engine/prompts.ts src/persuade/engine/score.ts tests/persuade/silence.test.ts
git commit -m "feat: record silence as silence, never as words

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The ladder answers silence, and a vague yes is not a yes

**Files:**
- Modify: `src/persuade/engine/knowledge.ts` (`VAGUE_COMMITMENT_MARKERS`)
- Modify: `src/persuade/engine/rules.ts` (`RuleConfig`, `DEFAULT_RULES`, `fatigueScore`, `detectOutcome`, `shouldStop`, new `applySilence`)
- Test: `tests/persuade/silence.test.ts` (append), `tests/persuade/rules.test.ts` (unchanged, must still pass)

**Interfaces:**
- Consumes: `Turn.silent`, `Outcome['no_response']` (Task 3).
- Produces:
  - `RuleConfig` gains `maxSilences: number` (default 3) and `enforceSilenceLadder: boolean` (default true)
  - `silenceCount(turns: readonly Turn[]): number`
  - `applySilence(turns: Turn[], state: ConversationState, rules?: RuleConfig): { turn: Turn; state: ConversationState; stopped: { stop: boolean; reason: string | null } }`
  - `detectOutcome` returns `deferred` for a commitment with a vague time

- [ ] **Step 1: Write the failing test (append to `tests/persuade/silence.test.ts`)**

```ts
import { DEFAULT_RULES, applySilence, detectOutcome, fatigueScore, initialState, silenceCount } from '../../src/persuade/engine/rules'

describe('the ladder answers silence', () => {
  test('silence is not fatigue', () => {
    const tired = [
      { role: 'target' as const, text: 'בסדר', interaction: 1 },
      { role: 'target' as const, text: 'נראה', interaction: 2 },
    ]
    expect(fatigueScore(tired)).toBeGreaterThan(0)
    expect(fatigueScore([silentTurn(1), silentTurn(2)])).toBe(0)
    expect(silenceCount([...tired, silentTurn(3)])).toBe(1)
  })

  test('each unanswered message climbs exactly one rung', () => {
    let state = { ...initialState(), interaction: 1, rung: 1 as const }
    const turns: Turn[] = []

    const first = applySilence(turns, state)
    expect(first.turn).toEqual({ role: 'target', text: '', silent: true, interaction: 1 })
    expect(first.state.rung).toBe(2)
    expect(first.stopped.stop).toBe(false)

    state = { ...first.state, interaction: 2 }
    const second = applySilence([first.turn], state)
    expect(second.state.rung).toBe(3)
    expect(second.stopped.stop).toBe(false)
  })

  test('three unanswered messages end the run as no_response, two do not', () => {
    const state = { ...initialState(), interaction: 3, rung: 3 as const }
    const twoSilences = [silentTurn(1), silentTurn(2)]

    const third = applySilence(twoSilences, state)

    expect(third.state.outcome).toBe('no_response')
    expect(third.stopped.stop).toBe(true)
    expect(third.stopped.reason).toContain('לא ענה')

    const second = applySilence([silentTurn(1)], { ...state, interaction: 2 })
    expect(second.state.outcome).toBe('open')
    expect(second.stopped.stop).toBe(false)
  })

  test('the ladder can be switched off, and then silence only counts', () => {
    const rules = { ...DEFAULT_RULES, enforceSilenceLadder: false }
    const state = { ...initialState(), interaction: 1, rung: 1 as const }

    const result = applySilence([], state, rules)

    expect(result.state.rung).toBe(1)
    expect(result.turn.silent).toBe(true)
  })
})

describe('a vague yes is not a yes', () => {
  test('a commitment with a vague time defers', () => {
    expect(detectOutcome('כן כן, מחר')).toBe('deferred')
    expect(detectOutcome('סגור, אשתדל בהמשך')).toBe('deferred')
  })

  test('a commitment with a real start still agrees', () => {
    expect(detectOutcome('סגור, אני עושה את זה מחר בבוקר בתשע')).toBe('agreed')
    expect(detectOutcome('סגור, אני עושה את זה')).toBe('agreed')
  })

  test('a refusal is still a refusal and an open reply is still open', () => {
    expect(detectOutcome('לא מסכים, זה לא עובד')).toBe('refused')
    expect(detectOutcome('כמה זמן זה לוקח?')).toBe('open')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/persuade/silence.test.ts`
Expected: FAIL, `applySilence` and `silenceCount` are not exported.

- [ ] **Step 3: Implement**

In `src/persuade/engine/knowledge.ts`, beside the other marker lists:

```ts
/**
 * A yes with nothing behind it.
 *
 * "כן כן, מחר" is the product spec's own example of the failure this engine
 * exists to prevent: agreement that never became execution. A commitment marker
 * next to one of these, with no concrete start, is a deferral.
 */
export const VAGUE_COMMITMENT_MARKERS = [
  'כן כן',
  'מחר',
  'אשתדל',
  'בקרוב',
  'נראה מה יהיה',
  'אחר כך',
  'בהמשך',
  'נסתדר',
]

/** A time you could put in a calendar. A vague yes next to one of these is a real yes. */
export const CONCRETE_TIME_MARKERS = [
  'בשעה',
  'בבוקר',
  'בערב',
  'לפני הפתיחה',
  'אחרי הסגירה',
  'ביום ראשון',
  'ביום שני',
  'ביום שלישי',
  'ביום רביעי',
  'ביום חמישי',
  'בתשע',
  'בעשר',
  'בשמונה',
]
```

In `src/persuade/engine/rules.ts`, add to `RuleConfig`:

```ts
  /** Unanswered messages before the conversation is over. */
  maxSilences: number
  /** An unanswered message climbs one rung: reminder, personal approach, manager. */
  enforceSilenceLadder: boolean
```

and to `DEFAULT_RULES`:

```ts
  maxSilences: 3,
  enforceSilenceLadder: true,
```

Make `fatigueScore` ignore silence by filtering at the top of the function (the first line that collects target turns):

```ts
  const answered = targetTurns.filter((t) => !t.silent)
```

and use `answered` everywhere the function currently uses its parameter. A missing reply is not a tired reply; counting it as fatigue would end runs that should escalate.

Add the counter and the silence step:

```ts
export const silenceCount = (turns: readonly Turn[]): number =>
  turns.filter((t) => t.role === 'target' && t.silent).length

/**
 * The counterpart said nothing. The engine still has to act.
 *
 * Climbing exactly one rung per unanswered message is the product spec's ladder:
 * a reminder, then a personal approach, then the manager. The run ends at
 * `maxSilences` because a fourth message to someone who has answered none of
 * three is not persuasion, it is noise.
 */
export function applySilence(
  turns: Turn[],
  state: ConversationState,
  rules: RuleConfig = DEFAULT_RULES,
): { turn: Turn; state: ConversationState; stopped: { stop: boolean; reason: string | null } } {
  const turn: Turn = { role: 'target', text: '', silent: true, interaction: state.interaction }
  const silences = silenceCount([...turns, turn])

  const newState: ConversationState = {
    ...state,
    rung: rules.enforceSilenceLadder ? nextRung(state, rules) : state.rung,
    outcome: silences >= rules.maxSilences ? 'no_response' : state.outcome,
  }

  return { turn, state: newState, stopped: shouldStop(newState, rules) }
}
```

In `detectOutcome`, insert the vague check before the commitment check:

```ts
  if (containsAny(targetText, REFUSAL_MARKERS)) return 'refused'
  if (containsAny(targetText, COMMITMENT_MARKERS)) {
    // A yes with a vague time and no concrete start is the spec's "כן כן, מחר".
    const vague = containsAny(targetText, VAGUE_COMMITMENT_MARKERS)
    const concrete = containsAny(targetText, CONCRETE_TIME_MARKERS)
    return vague && !concrete ? 'deferred' : 'agreed'
  }
  return 'open'
```

In `shouldStop`, add before the interaction budget check:

```ts
  if (state.outcome === 'no_response')
    return { stop: true, reason: 'הנמען לא ענה. עוברים להסלמה ניהולית' }
```

Import `VAGUE_COMMITMENT_MARKERS` and `CONCRETE_TIME_MARKERS` from `./knowledge` beside the existing marker imports.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/persuade/silence.test.ts tests/persuade/rules.test.ts tests/persuade/turn.test.ts tests/persuade/outcome-integrity.test.ts`
Expected: all PASS. If `rules.test.ts` or `outcome-integrity.test.ts` has a case asserting that a phrase like "סגור, אני עושה את זה מחר" is `agreed`, that expectation is now wrong by design: report it in your report, and change the expectation only if the phrase carries a vague time and no concrete start.

- [ ] **Step 5: Gate and commit**

```bash
pnpm lint:fix && pnpm run ci
git add src/persuade/engine/knowledge.ts src/persuade/engine/rules.ts tests/persuade/silence.test.ts
git commit -m "feat: escalate when nobody answers, and stop counting a vague yes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The simulation loop stays quiet when the world says so

**Files:**
- Modify: `src/persuade/engine/simulation.ts`
- Test: `tests/persuade/silence.test.ts` (append)

**Interfaces:**
- Consumes: `staysSilent` (Task 2), `applySilence` (Task 4).
- Produces: no new exports. `runSimulation` emits silent target turns without calling the counterpart's model.

- [ ] **Step 1: Write the failing test (append to `tests/persuade/silence.test.ts`)**

```ts
import { afterEach } from 'vitest'
import { runSimulation } from '../../src/persuade/engine/simulation'
import type { Run } from '../../src/persuade/engine/types'
import { setModelOverrides } from '../../src/persuade/lib/model'
import { jsonModel, PERSUADER_PAYLOAD, TEST_PERSONA, TEST_PLAN, textModel } from './helpers'

afterEach(() => setModelOverrides({}))

async function collect(world: WorldState | null): Promise<Run> {
  let run: Run | null = null
  for await (const event of runSimulation({ plan: TEST_PLAN, persona: TEST_PERSONA, world })) {
    if (event.type === 'done') run = event.run
  }
  if (!run) throw new Error('no run')
  return run
}

describe('a run against someone who does not answer', () => {
  test('never calls the counterpart, and ends as no_response', async () => {
    let targetCalls = 0
    const counting = textModel(['לא אמור להיקרא'])
    setModelOverrides({
      persuader: jsonModel([PERSUADER_PAYLOAD]),
      target: new Proxy(counting, {
        get(model, key, receiver) {
          if (key === 'doGenerate') targetCalls += 1
          return Reflect.get(model, key, receiver)
        },
      }),
    })

    const run = await collect(buildWorld({ ...cell(), responsiveness: 'silent' }))

    expect(targetCalls).toBe(0)
    expect(run.state.outcome).toBe('no_response')
    expect(run.turns.filter((t) => t.silent)).toHaveLength(3)
    expect(run.turns.filter((t) => t.role === 'persuader')).toHaveLength(3)
    // The ladder climbed rather than standing still. Exactly one rung per
    // silence is asserted as a unit in the applySilence test above; here the
    // interaction counter also bounds the rung, so pinning a number would test
    // that interaction instead of this behaviour.
    expect(run.state.rung).toBeGreaterThanOrEqual(2)
  })

  test('a slow world is ignored once and then answers', async () => {
    setModelOverrides({
      persuader: jsonModel([PERSUADER_PAYLOAD]),
      target: textModel(['סגור, אני עושה את זה']),
    })

    const run = await collect(buildWorld({ ...cell(), responsiveness: 'slow' }))

    expect(run.turns.filter((t) => t.silent)).toHaveLength(1)
    expect(run.state.outcome).toBe('agreed')
  })

  test('a world that answers behaves exactly as before', async () => {
    setModelOverrides({
      persuader: jsonModel([PERSUADER_PAYLOAD]),
      target: textModel(['סגור, אני עושה את זה']),
    })

    const run = await collect(buildWorld({ ...cell(), responsiveness: 'answers' }))

    expect(run.turns.some((t) => t.silent)).toBe(false)
    expect(run.state.outcome).toBe('agreed')
    expect(run.turns).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/persuade/silence.test.ts`
Expected: FAIL, the silent run calls the counterpart and never reaches `no_response`.

- [ ] **Step 3: Implement in `simulation.ts`**

Add to the imports:

`simulation.ts` currently imports the world as a type only (`import type { WorldState } from './world'`). A type-only import cannot carry a function, so add a value import beside it:

```ts
import { staysSilent } from './world'
```

and add `applySilence` to the existing `./rules` import.

Inside the loop, replace the block that fetches and applies the counterpart's reply:

```ts
    const reply = await targetReply(persona, plan, turns, world)
    const t = applyTargetReply(reply, turns, state, rules)
```

with:

```ts
    // `i` counts persuader messages, so index 0 is the opening one: a `slow`
    // world ignores exactly that and answers from the next.
    const t = staysSilent(world, i)
      ? applySilence(turns, state, rules)
      : applyTargetReply(await targetReply(persona, plan, turns, world), turns, state, rules)
```

The world-isolation test asserts the literal text `targetReply(persona, plan, turns, world)` appears in this file; the expression above keeps it. Run that test to confirm.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/persuade/silence.test.ts tests/persuade/simulation.test.ts tests/persuade/world-isolation.test.ts`
Expected: all PASS.

- [ ] **Step 5: Gate and commit**

```bash
pnpm lint:fix && pnpm run ci
git add src/persuade/engine/simulation.ts tests/persuade/silence.test.ts
git commit -m "feat: run a conversation with someone who never answers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The judge reads response validity

**Files:**
- Modify: `src/persuade/engine/types.ts` (`RunScore`)
- Modify: `src/persuade/engine/score.ts` (schema, system prompt)
- Test: `tests/persuade/silence.test.ts` (append)

**Interfaces:**
- Produces: `RunScore.responseValidity: 'did' | 'refused_with_reason' | 'stuck_with_plan' | 'none'`.

- [ ] **Step 1: Write the failing test (append to `tests/persuade/silence.test.ts`)**

```ts
import { scoreRun } from '../../src/persuade/engine/score'
import { initialState as freshState } from '../../src/persuade/engine/rules'

const JUDGE_PAYLOAD = {
  persuaded: 'no',
  winningArgument: null,
  winningCategory: null,
  mainObjection: null,
  whatBrokeIt: null,
  whatFailed: 'לא הגיעה תשובה',
  grade: 30,
  notes: 'הנמען לא ענה',
  responseValidity: 'none',
}

describe('response validity', () => {
  test('comes back on the score and survives an unknown-free schema', async () => {
    setModelOverrides({ judge: jsonModel([JUDGE_PAYLOAD]) })

    const score = await scoreRun(
      TEST_PLAN,
      [persuaderTurn('שלום', 0), silentTurn(0)],
      { ...freshState(), outcome: 'no_response' },
      [],
    )

    expect(score.responseValidity).toBe('none')
    expect(score.interactionsUsed).toBe(0)
  })

  test('the judge is told the four values and what a valid response means', async () => {
    const { model, prompts } = recordingJsonModel([JUDGE_PAYLOAD])
    setModelOverrides({ judge: model })

    await scoreRun(TEST_PLAN, [persuaderTurn('שלום', 0), silentTurn(0)], freshState(), [])

    const asked = prompts()[0] ?? ''
    expect(asked).toContain('(לא ענה)')
  })
})
```

Add `recordingJsonModel` to the imports from `./helpers` at the top of the file.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/persuade/silence.test.ts`
Expected: FAIL, `responseValidity` is missing from the score.

- [ ] **Step 3: Implement**

In `types.ts`, add to `RunScore`:

```ts
  /**
   * Whether the counterpart gave a valid response at all, in the product spec's
   * sense: you may disagree, you may not disappear. A refusal with a reason is a
   * valid response and a failed persuasion at the same time, which is why this
   * is a separate field from `persuaded` rather than a grade.
   */
  responseValidity: 'did' | 'refused_with_reason' | 'stuck_with_plan' | 'none'
```

In `score.ts`, add to `scoreSchema`:

```ts
  responseValidity: z
    .enum(['did', 'refused_with_reason', 'stuck_with_plan', 'none'])
    .describe('האם הנמען נתן תשובה תקינה בכלל'),
```

and add to the system prompt, after the existing scoring guidance:

```
תשובה תקינה היא אחת מהשלוש:
- did: התחייב לפעולה ולזמן.
- refused_with_reason: אמר לא ואמר למה.
- stuck_with_plan: אמר מה תקוע והציע מועד או דרך אחרת.
none זה כשלא הגיעה תשובה תקינה: שתיקה, או "כן כן" בלי זמן.
סירוב מנומק הוא תשובה תקינה גם אם השכנוע נכשל. אל תדרג אותו none.
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/persuade/silence.test.ts tests/persuade/rates.test.ts tests/persuade/simulations-store.test.ts tests/persuade/dataset.test.ts`
Expected: all PASS. If a fixture elsewhere builds a `RunScore` literal, `tsc` will now require the new field; add `responseValidity: 'did'` to those fixtures and say so in your report.

- [ ] **Step 5: Gate and commit**

```bash
pnpm lint:fix && pnpm run ci
git add src/persuade/engine/types.ts src/persuade/engine/score.ts tests/persuade/silence.test.ts
git commit -m "feat: judge whether the conversation got a valid response at all

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md` (the "The scenario, and what the persuader is not told" section)

- [ ] **Step 1: Document the axis and the ladder**

In `CLAUDE.md`, that section says `worldCells()` enumerates 162 distinct worlds (it is 324 today and 972 after Task 2). Correct the number to 972 and add this bullet after it:

```markdown
- **Silence is a world, not an error.** `responsiveness` decides whether the
  simulated person answers (`answers`), ignores the opening message (`slow`) or
  never answers (`silent`). A silent turn calls no model, is stored as
  `{ silent: true, text: '' }` and reaches the persuader as `[לא ענה]`. Each
  unanswered message climbs one rung (reminder, personal approach, manager) and
  `maxSilences` of them end the run as `no_response`. A world written before the
  axis existed has no `responsiveness` and means `answers`, which is what keeps
  the jobs queued before the change runnable.
```

- [ ] **Step 2: Gate and commit**

```bash
pnpm lint:fix && pnpm run ci
git add CLAUDE.md
git commit -m "docs: silence is a world the lab can run

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Review, then rollout (rollout steps need user approval)

- [ ] **Step 1: Code review**

Run `/code-review` over the minene branch diff against `main` and the eran-task branch. Fix CRITICAL and HIGH findings with a test each, re-run `pnpm lint:fix && pnpm run ci`, commit.

- [ ] **Step 2: Verify the migration in a rolled-back transaction (user approval)**

```bash
cd /Users/itayostraich/Documents/GitHub/eran-task
out=/private/tmp/claude-501/verify_no_response.sql
{ echo 'begin;'; cat supabase/migrations/20260918120000_no_response_outcome.sql; cat supabase/verify/20260918120000_no_response_outcome.sql; echo 'rollback;'; } > "$out"
supabase db query --linked -f "$out"
supabase db query --linked "select count(*) as leftover from public.simulations where persona_id like 'verify%'"
```
Expected: no error; `leftover` is 0. Run a negative control the same way (the migration plus a `raise exception`) to prove the assertions execute.

- [ ] **Step 3: Push both branches, open PRs (user approval).** The minene PR states the order: the migration must be applied before minene merges, because a run that ends `no_response` cannot be stored until the constraint accepts it, and the worker would mark those jobs failed.

- [ ] **Step 4: Merge eran-task, `supabase migration list --linked`, `supabase db push --linked` (user approval).**

- [ ] **Step 5: Merge minene (user approval).** The feed's `inputsVersion` changes as soon as the world count does, so the walk restarts from the first cell of the new space; the jobs already queued keep running under their old worlds, which are valid and mean `answers`.

- [ ] **Step 6: Read the first silent runs (user approval for the queries)**

After a few hours:

```bash
supabase db query --linked "
select outcome, count(*) runs,
       round(avg((score->>'grade')::numeric)) avg_grade,
       count(*) filter (where score->>'responseValidity' = 'none') no_valid_response
from public.simulations
where created_at > now() - interval '6 hours'
group by outcome order by runs desc"
```
Report the outcome mix and how the bot behaved in `no_response` runs: whether it climbed the ladder one rung at a time and what its third message actually said.
