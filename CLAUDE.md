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
