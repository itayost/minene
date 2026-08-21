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

## Review fix round 1

The reducer now validates viewer `pageIndex` values in its incoming `Screen`:

- negative and over-bound integer indices are clamped to the group's first/last page before the action is reduced;
- non-integer and non-finite indices are rejected to home;
- malformed indices can no longer survive `back`, page movement, or page selection.

TDD evidence for this fix:

1. Added focused tests for negative, over-bound, decimal, `Infinity`, and `NaN` viewer indices.
2. RED: `pnpm vitest run tests/navigation.test.ts` → 1 file, 13 tests; 2 tests failed because malformed/out-of-range indices were retained or reduced from their malformed values.
3. GREEN: after the `validScreen` normalization/rejection change, `pnpm vitest run tests/navigation.test.ts` → 1 file, 13 tests passed.
4. Regression verification: `pnpm vitest run` → 4 files, 31 tests passed; `pnpm exec tsc --noEmit` passed.
