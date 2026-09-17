# Simulation at scale, and a persuader that learns

The persuader should get better at getting people to do their tasks. Not better
for one employee or one business: one general model, improved by evidence.

Two sources of evidence feed it:

- **Simulations**, now: 1,000 a day against synthetic personas in synthetic
  worlds.
- **Real conversations**, later: labelled by whether the person actually did
  the task a week afterwards.

Two mechanisms turn evidence into a better bot, in this order:

1. **Technique weights**, first. Cheap, explainable, gated by a person.
2. **Fine-tuning**, once real conversations with settled execution exist.

## Where things stand (2026-09-17)

- The simulation loop already exists here: an hourly cron on
  `/api/persuade/worker`, the `simulation_jobs` queue with
  `claim_simulation_jobs`, scoring, worlds, experiments and sweeps, a daily cap
  and a `CRON_SECRET` gate. It has produced 17 simulations (2026-08-27 to
  2026-08-29). All 13 queued jobs are `done` and nothing refills the queue, so
  the loop is idle.
- Throughput ceiling today: 6 jobs per hourly tick, run sequentially, capped at
  200 a day. At most 144 a day in practice.
- Inputs: 4 personas (all retail), 1 lab plan, 324 world cells. 1,296
  combinations: about one day at the target volume.
- `technique-weights.ts` defines `propose`, `promote` and `readPromoted`, and
  **nothing calls any of them**. Production does not consult weights, and no
  person can promote one without writing code.
- `conversation_turns` stores `role, text, interaction, rung, blocker,
  violations`. It does not store the structured `output`, so
  `examplesFromRun` would reject every real turn as
  `turn-missing-structured-output`.
- eran-task has 0 assignments, 1 tenant, 1 profile, 0 conversations.
- `eran-presueder` is an older copy of the engine. None of this work happens
  there.

This branch starts from `fix/report-paging-and-offplan-bias`, not `main`,
because section 1 depends on `ab2f6c4` (models recorded on runs saved from the
lab). That branch must merge first, or this one carries it.

## Out of scope

- Getting real conversations to happen at all. That is a product and adoption
  question; this spec only guarantees nothing is lost once they start.
- Running a fine-tuning job, choosing the provider, and deploying a tuned
  model. Section 4 prepares the data and the evaluation; the job itself is a
  manual step.
- A dollar budget cap. Section 1 records tokens so one can be added later.
- Moving work to Vercel Workflow/Queues or the Hetzner VPS. Considered and
  rejected: at 42 runs an hour the existing queue is enough, and a new runtime
  would weaken comparison with runs already stored.

All migrations are written in `eran-task/supabase/migrations`, applied with
`supabase migration list --linked` before `supabase db push --linked`, as this
repo's CLAUDE.md requires.

---

## 1. Throughput

### Schedule

`vercel.json` cron changes from `0 * * * *` to `*/10 * * * *`: 144 ticks a day.

### Concurrency inside a tick

`tick()` claims `PERSUADER_TICK_BATCH` jobs (default 8) and runs them
`PERSUADER_TICK_CONCURRENCY` at a time (default 4) with a small bounded pool, not
`Promise.all` over the whole batch.

- Measured: 3 runs took 125s, so about 42s each. 8 jobs at concurrency 4 is
  about 90-120s per tick, inside `maxDuration = 800`.
- 144 ticks x 8 = 1,152 possible; the cap holds it to 1,000.
- Both are env vars so a provider rate limit can be answered without a deploy.
- Each job's success or failure is still written individually, exactly as now.

### Cap

`DAILY_RUN_CAP` default changes from `200` to `1000` in code and in the Vercel
env. The cap check remains fail-closed. Room is computed once per tick
(`min(batch, cap - today)`), and concurrency never claims more than that room.

### Queue refill

At the start of a tick, before claiming, if `simulation_jobs` has fewer than
`PERSUADER_QUEUE_LOW_WATER` (default 50) jobs in `pending`, the worker queues the
next chunk of the sweep (`PERSUADER_REFILL_CHUNK`, default 200 jobs).

New table `public.simulation_feed`, one row:

| column | type | meaning |
|---|---|---|
| `id` | `smallint` pk, check `id = 1` | single row |
| `next_index` | `integer` | index into the pair x world enumeration (not `cursor`, a PL/pgSQL keyword) |
| `pass` | `integer` | how many full passes have completed |
| `inputs_version` | `text` | hash of active persona keys + plan keys |
| `refilled_at` | `timestamptz` | last refill |

The enumeration is computed in TypeScript, and supabase-js cannot hold a
transaction across calls, so the commit is a compare-and-set:

1. TS reads the feed row (`next_index`, `pass`, `inputs_version`).
2. TS computes the active inputs hash. If it differs, it plans from index 0,
   pass 0.
3. TS builds the next chunk of jobs and the resulting `(next_index, pass)`.
4. TS calls RPC `commit_simulation_feed_chunk(p_expected_index,
   p_expected_pass, p_expected_version, p_new_index, p_new_pass,
   p_new_version, p_jobs jsonb)`. In one transaction it locks the row
   (`for update`), returns `false` without writing if any expected value does
   not match, and otherwise inserts the jobs and advances the row.
5. `false` means another tick refilled first; this tick skips refill and
   claims as normal.

So two overlapping ticks cannot queue the same chunk, and a failed insert never
advances `next_index` past cells that were not queued.

- When `next_index` passes the end of the enumeration, `pass` increments and the
  index wraps.
- New column `simulation_jobs.pass integer null`, copied onto
  `simulations.pass integer null`, so repeats are visible. Null = queued by hand
  or before this change.
- The enumeration is over **valid pairs** (section 2), not the cartesian product
  of personas and plans.

### Token usage

`runSimulation` accumulates `usage` from every `generateObject` /
`generateText` call, by role. `scoreRun` returns its usage too. The worker
writes it to a new column `simulations.usage jsonb`:

```json
{ "persuader": { "input": 0, "output": 0 },
  "target":    { "input": 0, "output": 0 },
  "judge":     { "input": 0, "output": 0 } }
```

Nullable: rows before this change have no usage, and null means unknown.

### Circuit breaker

Before claiming, the worker reads jobs whose `updated_at` is within the last
hour and whose status is `done` or `failed`. If there are at least 20 and more
than 80% are `failed`, the tick claims nothing and returns
`stopped: 'מפסק: <failed>/<total> נכשלו בשעה האחרונה'`. It resets on its own as
the window moves. A manual `POST` with the secret still goes through the same
check; there is no bypass flag.

New index: `simulation_jobs (status, updated_at)`.

### Tests

- The pool never runs more than `concurrency` jobs at once.
- The cap is not exceeded when jobs run concurrently.
- Refill resumes from the stored `next_index`; wraps and increments `pass`.
- A changed inputs hash resets `next_index`.
- A refill whose expected index is stale writes nothing and the tick still
  claims (mocked RPC returning `false`).
- The SQL function itself: a mismatched expectation inserts no jobs and leaves
  the row unchanged (checked in a rolled-back transaction, not mocked).
- The breaker trips at >80% of >=20 and does not trip below 20.
- Usage sums across every model call in a run, including the judge.

---

## 2. Variety

### Source

eran-task `role_needs`: 3 industries (retail, bank, healthcare), 16 roles, 80
needs, 5 per role, each with a `meta_need`. It has no tenant column, so reading
it is consistent with the simulation tenant boundary.

Worlds already supply motivation, workload, reason, pressure response,
disposition, gender, age band and tenure, and `personaInWorld` applies them over
the persona. A generated persona therefore supplies only a name, a role and a
voice.

### Plans: one per need (80)

For each `role_needs` row, the planner model produces a concrete task that
someone in that role asks of a subordinate role in the same industry, as a full
`PersuasionPlan`.

- Stored in `persuasion_lab_plans`, `plan_key = gen-<industry>-<role_slug>-<need_key>`,
  `job_role_name` = the **target** role's label.
- The generator reads `role_needs` and nothing else from the database. It never
  reads `rules`, `documents`, tenant knowledge or ammunition.

### Personas: two per role (32)

For each `(industry, role_slug)`, two personas with distinct names and styles,
one at `resistance = 2` and one at `resistance = 4`.

- Stored in `persuasion_personas`,
  `persona_key = gen-<industry>-<role_slug>-<1|2>`.

### Validation

The invariants in `scripts/validate-lab-content.ts` move to a shared
`src/persuade/lib/lab-content-checks.ts` and are used by both the script and the
generator:

- `isAskPhotographable(plan)` passes.
- Plans do not name or gender the counterpart (the existing standalone-name
  check).
- Required fields present and non-empty.

A generated item that fails is not written; the generator prints each rejection
with its reason. An item that passes is written `is_active = true`.

New columns on both tables: `source text not null default 'manual'` and
`generated_at timestamptz null`. Generated rows get `source = 'generated'`, so a
bad batch is deactivated with one update. No per-item approval: these are inputs
to synthetic runs and change nothing in production. Human approval remains
where production changes (section 3).

### Pairing

A persona meets only plans whose target role matches its role, in the same
industry. The enumeration is:

```
for each active plan
  for each active persona where persona.industry = plan.industry
                            and persona.job_role_name = plan.job_role_name
    for each world cell (golden stride, as planSweep does now)
```

80 plans x 2 personas x 324 worlds = 51,840 unique runs, about 52 days at 1,000
a day before pass 2.

A plan whose `job_role_name` is null has no target role and pairs with every
active persona in its industry. That is the existing manual `briefings` plan,
so the feed has work (4 retail personas x 324 worlds) before any content is
generated. A persona that matches no plan is counted in the refill report
(`unpairedPersonas`) rather than dropped silently.

### Running it

`pnpm lab:generate [--industry=retail] [--force]`. Idempotent by key: existing
keys are skipped unless `--force`. About 112 planner calls, once.

### Tests

- The generator's database access is limited to `role_needs`, and the persona
  and plan tables for writing (extend `tests/persuade/tenant-boundary.test.ts`).
- Validation rejects a plan that names the counterpart.
- Pairing never matches across role or industry.
- A rerun without `--force` writes nothing.

---

## 3. Technique weights

### 3.1 Proposals, daily

New route `/api/persuade/weights/propose`, same `CRON_SECRET` check as the
worker, on a daily cron. It builds effectiveness per cell
`(industry, job_role_name, reason)`, calls `propose()`, and writes the results.

New table `public.technique_weight_proposals`:

| column | type |
|---|---|
| `id` | uuid pk |
| `industry`, `job_role_name`, `reason`, `category` | as in `technique_weights` |
| `weight` | numeric |
| `current_weight` | numeric null (the promoted weight at proposal time) |
| `evidence` | jsonb (sim runs, win %, negative reaction %, and section 4's real evidence) |
| `caveat` | text null |
| `weights_version` | text (the version the evidence was measured under) |
| `status` | text check in `pending, promoted, rejected, superseded` |
| `decided_by` | uuid null |
| `decided_at` | timestamptz null |
| `note` | text null |
| `created_at` | timestamptz |

- Separate from `technique_weights` because `promote()` upserts on
  `(industry, job_role_name, reason, category)`; a proposal written there would
  overwrite a live weight.
- A new proposal for the same cell and category marks the previous `pending` one
  `superseded`.
- `minRuns` default at this volume: 30. Cells below it produce no proposal.
- Two granularities per `(industry, job_role_name)`: one proposal pooled across
  all reasons (`reason = null`), and one per reason. This matters because a real
  conversation has no world and therefore no reason: `readPromoted` with
  `reason = null` matches only `reason = null` rows, so without the pooled row a
  promoted weight could never reach production. Per-reason rows are still useful
  to read and to steer simulations.

### 3.2 Review page

A page in the persuade lab lists `pending` proposals grouped by cell. Each row
shows current weight, proposed weight, win % vs peers, runs, caveats, and (once
section 4 has data) the real done rate.

- **Promote** calls `promote()` with the session user's id and marks the
  proposal `promoted`.
- **Reject** requires a note and marks it `rejected` with the user's id.
- Access: a signed-in session resolved through `src/persuade/lib/caller.ts`, as
  the chat route does. No promotion path without a user id, and no scheduled
  path that promotes.
- Hebrew, RTL.

### 3.3 Production reads promoted weights

When a plan is prepared, `readPromoted()` is called for its cell and each
argument's strength is multiplied by its category's weight before ranking. This
is applied in code after the model answers, alongside measured strength.

The promoted weights for the cell are included in `measuredInputs`, so
`planFingerprint` changes when a weight is promoted and `plans.ts` does not
serve a plan ranked by yesterday's weights.

### 3.4 Simulations record the weights they ran under

Simulations use promoted weights too, so the lab measures the bot as it is.

- New column `simulations.weights_version text null`: a hash of the promoted
  weights for the run's cell. Null = before this change.
- Effectiveness for a proposal is computed only within one `weights_version`,
  so runs before and after a promotion are never pooled.
- Testing a weight before promoting it uses the existing experiment queue, with
  arms that differ in that one weight.

### Risk

The loop can learn to persuade the LLM playing the employee. Human promotion is
the first guard. Section 4's real done rate, shown next to the simulated win
rate, is the second.

### Tests

- Writing proposals never changes a row in `technique_weights`.
- `promote()` requires a user id; the review action refuses without a session.
- Promoting a weight changes `planFingerprint` for that cell.
- Weights reorder arguments by category.
- Effectiveness does not pool runs across `weights_version`.
- The propose job skips cells under `minRuns` and supersedes older pending rows.

---

## 4. Real conversations to training

### 4.1 Record what training needs

Migration in eran-task:

- `conversation_turns.output jsonb null`: the persuader's structured answer.
- `conversations.rules jsonb null`, `conversations.models jsonb null`,
  `conversations.weights_version text null`.

`src/persuade/lib/store.ts` writes all four. Rows saved before this change stay
null and are not trainable, which is why this lands before real conversations
start.

### 4.2 The label is execution

A real conversation is a training candidate only when its assignment has been
settled by `recordExecution`.

- Assignment `done`: the conversation's clean turns become fine-tuning examples.
- Assignment `not_done`: not a fine-tuning example; counted as evidence in 4.4.
- No grade filter for real conversations: execution replaces the judge.
- Clean-turn filter (deterministic `checkTurn` violations) still applies.

### 4.3 Redaction at export

Before a real conversation becomes an example, known identifiers are replaced
with placeholders: the assignee's name, the assigning person's name, the tenant
name, and names in the tenant profile. The replayed system prompt uses a
placeholder recipient so prompt and answer agree.

After replacement, the finished example is searched for every known identifier.
Any match drops the example with reason `redaction-incomplete`. It is never
exported as-is.

The blanket "never conversations" statements in `dataset.ts`,
`scripts/export-dataset.ts` and this repo's CLAUDE.md are replaced by: real
conversations enter training only through the redacting export, only with
settled `done` execution. The simulation tenant boundary is unchanged.

### 4.4 Real evidence in the weights review

The proposal job (3.1) also reads settled real conversations per cell, and adds
`{ realSettled, realDone, realDonePct }` to `evidence`. The review page shows it
beside the simulated win rate. A large gap is surfaced, not auto-blocked.

### 4.5 Export and evaluation

`pnpm export:dataset [outfile] --source=simulations|conversations|both
[--real-repeat=N]`

- Real examples carry a `source` tag in a sidecar report, and may be repeated
  `N` times to up-weight them.
- Default `--source=simulations`, so the current behaviour is unchanged.

Evaluating a tuned model uses the existing experiment queue: two arms differing
only in the persuader model, with `models` recorded per run. Promotion to
production requires winning on simulations and not losing on real done rate.
That decision and the deployment are manual.

### Tests

- A conversation turn round-trips `output`.
- A conversation with no settled assignment produces no examples.
- `not_done` produces no examples.
- Redaction replaces every known identifier; an example still containing one is
  dropped and counted.
- `--source=simulations` reads only `simulations`; `conversations` reads only
  conversations; the tenant-boundary test for simulations still passes.

---

## Build order

1. Section 1 migrations + worker changes. Ship; watch one day at cap 200 to read
   real usage per run before raising the cap to 1,000.
2. Section 2 generator; run it; confirm the sweep enumerates pairs.
3. Section 4.1 recording (small, and must precede any real conversation).
4. Section 3 proposals, review page, production weights.
5. Section 4.2-4.5 export and evidence.
