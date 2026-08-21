# Task 3 report: navigation state and brand-scoped progress

## Scope

Implemented the framework-independent navigation model and versioned progress persistence in:

- `src/core/navigation.ts`
- `src/core/progress.ts`
- `tests/navigation.test.ts`
- `tests/progress.test.ts`

## Navigation behavior

- Added the discriminated `Screen` union for home, subject menu, page viewer, and tool screens.
- Added `NavigationAction` and pure `createInitialScreen`/`reduceNavigation` transitions.
- Added `openSubject` and `openGroup` helpers. Single-group subjects open directly; multi-group subjects open their menu.
- Restored viewer page indices from progress and clamps them to the available page range.
- Page next/previous and page selection enforce viewer boundaries.
- Back returns a multi-group viewer to its subject menu and returns home from single-group viewers, menus, tools, and home.
- Unknown subject, group, tool, or stale screen IDs safely resolve to home.

## Progress behavior

- Added `ProgressMap`, `progressEntryKey`, and `progressStorageKey`.
- Storage keys use `content-viewer.progress.v1.<brand-id>`.
- Reads parse and sanitize only finite, non-negative integer page indices.
- Malformed, stale-version, absent, or cross-brand data returns an empty map.
- Writes sanitize input and catch serialization, security, and quota/storage exceptions.

## TDD evidence

1. Wrote navigation and progress tests before production modules.
2. Ran `pnpm vitest run tests/navigation.test.ts tests/progress.test.ts` in RED state: both suites failed because `src/core/navigation.ts` and `src/core/progress.ts` did not exist.
3. Implemented the minimal behavior and reran the focused suites: 2 files passed, 17 tests passed.
4. Ran the full suite: 4 files passed, 29 tests passed.
5. Ran TypeScript with `pnpm exec tsc --noEmit`: passed.
6. Ran `pnpm build` (brand validation, TypeScript, and Vite build): passed.

## Concerns

- Progress persistence is intentionally best-effort; storage failures are swallowed so navigation remains usable.
- The reducer does not write progress itself because navigation is pure. The app integration should write the current viewer page index using `progressEntryKey` after page changes.
