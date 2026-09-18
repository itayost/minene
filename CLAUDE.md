@AGENTS.md

# minene

The Next.js host for the brand content viewer, the organisational brain
(`מוח ארגוני`) and the persuader (`משכנע`). It reads and writes eran-task's
Supabase project; it has no database of its own.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server. **Pass `--hostname` explicitly** — see the trap below. |
| `pnpm test` | Vitest, watch mode |
| `pnpm test:run` | Vitest once |
| `pnpm lint` | Biome check (format + lint + import order) |
| `pnpm lint:fix` | Biome, writing fixes |
| `pnpm ci` | What CI runs: `biome ci` + `tsc --noEmit` + `vitest run` |
| `pnpm build` | `validate:brands` + `tsc --noEmit` + `next build` |
| `pnpm visual:verify` | Playwright against frozen snapshots |

## Enforcement

Conventions here are enforced rather than asked for, because the ones that were
only asked for did not hold:

- **`.husky/pre-commit`** — Biome (writing fixes, then re-staging) and `tsc`.
- **`.husky/pre-push`** — the test suite.
- **`.github/workflows/ci.yml`** — the same, plus the production build, on pull
  requests and pushes to `main`. It runs no database service on purpose, so it
  stays cheap enough to leave switched on.
- **`biome.jsonc`** — every rule that is off or demoted carries its reason in
  the file. A disabled rule with no explanation is indistinguishable from one
  somebody turned off to make a red build go green.

### The a11y backlog

Fifteen real accessibility findings are demoted to `info` in `biome.jsonc`,
listed there by rule: svgs with no title, divs with click handlers and no
keyboard path, roles on elements that cannot carry them. They are demoted
individually rather than by category, so an a11y violation of any *other* kind
still fails the build. Raise each back to `"error"` as it is cleared.

## Operations

### Deployment

Vercel deploys **production from `main` on push**. Project `minene`
(`prj_kRFeODMyrPv5WZVVhUIiowV4hcz3`, team `team_l1bzB1EDRpXjQwBcwhF3s6IU`),
aliased to `minene.vercel.app`. There is no deploy workflow in this repo — the
push is the deploy, so `main` should be green before it is pushed.

### The database lives in another repo

Migrations are in **eran-task**, not here (`supabase/migrations/`, 41 of them).
Supabase project `zibpqbrfvxmkqnwmiboo` (`ai-tips-dashboard`) — the same project
both repos use. Applying one:

```
cd ../eran-task
supabase link --project-ref zibpqbrfvxmkqnwmiboo
supabase migration list --linked     # check what is actually pending FIRST
supabase db push --linked
```

`migration list` before `db push` is not optional. `db push` applies every
unapplied migration, and eran-task keeps a deliberate `supabase/migrations-pending/`
parking area for migrations whose preconditions have not been met.

Migrations are roll-forward only. To undo a schema change, write one that
reverses it.

### The simulation loop

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
  plan with a null `job_role_name` pairs with every hand-written
  (`source = 'manual'`) persona in its industry, never a generated one.
  Changing the active personas or plans restarts the walk.
- **Generated content** comes from `pnpm lab:generate [--industry=retail]
  [--force]`, which writes two personas per role and one plan per need from
  eran-task's `role_needs` (`src/persuade/lib/generate-lab-content.ts`). Every
  item passes the same checks as `pnpm validate:lab` before it is written, and
  is stored with `source = 'generated'` and `generated_at`, so a bad batch is
  switched off with one update. A plan targets the role that owns the need and
  is made on behalf of the role listed above it, never a named person. Adding or
  changing active content restarts the feed's walk.
- Queue a one-off experiment with `queueExperiment` in
  `src/persuade/lib/experiments.ts`. It refuses an experiment whose arms differ
  in more than one setting, because that is an expensive way to learn nothing.
### The scenario, and what the persuader is not told

A run happens inside a `WorldState` — motivation, workload, the real reason it
has not happened, response to pressure, minutes left. The simulated employee
gets all of it; the persuader gets none of it and has no parameter it could be
passed through. `tests/persuade/world-isolation.test.ts` asserts the signature
and the rendered text, because a leak there makes every number the lab produces
a measurement of a bot reading an answer key.

- `worldCells()` enumerates 162 distinct worlds. `planSweep` walks them in order
  and resumes with `after`, so coverage is a fact rather than a hope about a
  random seed.
- `pnpm report:techniques` reads what each technique is doing, sliced by persona
  and by the reason. Note the denominator: a technique's `runs` counts runs
  where the plan **offered** it, not where it was used — fair between techniques
  in one plan, poor as an absolute rate. One category can break even that: a
  technique the plan never offered is credited when the scorer names it the
  winner, and its losses are unrecorded, so it reads near 100%. The report
  prints how many runs came in that way, and `propose()` refuses to weight a
  row where they are the majority.
- `pnpm export:dataset` builds a fine-tuning JSONL from runs that ended agreed
  with zero rule violations and a passing grade.

### Nothing promotes itself

`public.technique_weights` is the gate. `propose()` turns evidence into a
suggestion and writes nothing; `readPromoted()` filters on `promoted_at is not
null`, so a proposal nobody accepted is invisible to production; `promote()`
requires a person's id. There is deliberately no function that could be put on a
schedule to close that loop — the whole reason the table exists is that a weight
which changed itself cannot be explained afterwards.

- A simulation must never touch a tenant's knowledge. `tests/persuade/
  tenant-boundary.test.ts` enforces it on the engine, the turn loop and the
  worker -- the matrix and bank are readable across every tenant, and that is
  only safe while every run in them is invented.

## Traps that cost real time

- **`next dev` needs an explicit `--hostname`.** Started on the default host and
  browsed via `127.0.0.1`, Next 16 treats its own dev bundle as cross-origin and
  blocks it. Nothing hydrates, every form falls back to a native submit, and it
  looks exactly like a broken login.
- **Deleting a route leaves a validator behind** in `.next/types`, so `tsc` fails
  against a page that no longer exists until `.next` is cleared.
- **`useSearchParams()` in a layout** forces a Suspense boundary that turns every
  `notFound()` and `redirect()` beneath it into an HTTP 200.
- **Next 16 rewrites `tsconfig.json` on every build.** Biome is configured to
  ignore that file for exactly this reason.
- **A reasoning effort the AI SDK's types accept is not one the model accepts.**
  `LanguageModelV3` allows `minimal`; `gpt-5.4-mini` rejects it with a 400 that
  fails the whole call. `callOptions` in `src/persuade/lib/model.ts` drops any
  value outside `none | low | medium | high | xhigh`. Verify a new value with a
  real API call, not against the types.
- **`tests/visual/__snapshots__` cannot be regenerated.** They were captured from
  a Vite build that no longer exists. `pnpm visual:verify` compares against them;
  `visual:reference` deliberately refuses to run.
- **Node 26 installs a global `localStorage`** that shadows jsdom's. `tests/setup.ts`
  shims it.

## Conventions

- Files stay small. Nothing here is over 550 lines and it should stay that way —
  brain-backend's equivalent module reached 1,471 lines in a directory holding 65
  files, which is what the ceiling exists to prevent.
- Comments explain **why**, not what. The bar is: a reader who disagrees with the
  code should find out here whether they are missing something.
- Hebrew and RTL are the default for anything a user reads.
- Tests live in `tests/`, mirroring the source area they cover.
