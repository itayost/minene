# Final review fix report

Date: 2026-08-21
Branch: `feature/multi-brand-content-viewer`
Starting commit: `b2f2e1c`
Final-fix commit: this report is committed atomically with the fix, so the commit cannot embed its own content-addressed SHA; the exact SHA is recorded in the final handoff and is the branch `HEAD` containing this file.

## Outcome

All important findings and all deferred/minor findings were addressed in one pass. No item was deferred.

- Pinned `jsdom` exactly to `29.1.1`, whose engine range includes Node 20.19, and regenerated `pnpm-lock.yaml`.
- Pinned the repository package manager to `pnpm@10.34.5`. The previously declared pnpm 11 itself requires Node 22.13, so this additional pin was necessary to run the complete approved Node 20.19 floor rather than only the application dependencies.
- Replaced the ambiguous WhatsApp popup check with a synchronous blank-context contract: a `null` handle means blocked; a non-null handle has its opener severed before navigation; navigation/setup failure closes the blank context and reports `failed`.
- Guarded browser `localStorage` acquisition and fall back to no-op storage when its getter throws.
- Reject unsafe/non-normalized asset URLs and make build validation require a path beneath the matching brand root and a regular, non-symlink file.
- Validate registry entries as a list before constructing the `Map`, including duplicate keys, duplicate manifest IDs, and key/manifest disagreement.
- Hide Share on chooser and tool screens.
- Added manifest-configured, localized feedback for file share, URL share, clipboard fallback, save, WhatsApp opened/blocked/failed, and action failures.
- Kept stale high progress clamping and aligned the approved design wording with that ruling.
- Made indicator controls wrap while preserving 44px hit targets; eight indicators remain usable at 360px and narrower.
- Added direct persisted-output coverage for `writeProgress` sanitization.
- Mirrored screen-entry motion in RTL.
- Made the adjacent shell logo decorative while preserving required manifest `logo.alt` validation and documenting independent-use semantics.
- Restored synthetic document metadata in the shared-component test itself.
- Removed redundant `retryAttempt` state; remounting after the error branch already creates a fresh image.
- Added exact no-swipe boundary coverage at 55px and a 1.4 horizontal-dominance ratio.

## RED evidence

### Node floor

Command (isolated runtime; no global Node mutation):

```bash
npm_config_manage_package_manager_versions=false npx --yes --package=node@20.19.5 --package=pnpm@10.34.5 pnpm test:run
```

Before the dependency fix: exit 1; all 8 Vitest workers failed while loading locked `jsdom@30.0.1`, with `TypeError: webidl.util.markAsUncloneable is not a function`. The lockfile declared jsdom 30's Node engines as `^22.22.2 || ^24.15.0 || >=26.0.0`.

### Functional regressions

Command after adding tests and before production edits:

```bash
pnpm vitest run tests/page-actions.test.ts tests/App.test.tsx tests/validate-brand.test.ts tests/validate-brands-script.test.ts tests/PageViewer.test.tsx tests/shared-components.test.tsx tests/progress.test.ts
```

Result: exit 1; 27 failed and 60 passed. Expected failures demonstrated:

- missing secure external-window helper for opened/blocked/failed outcomes;
- the throwing `localStorage` getter crashing `App` before `readProgress`;
- unsafe dot, encoded-dot, backslash, duplicate-separator, query, and fragment asset paths being accepted;
- no registry builder for duplicate IDs or mismatched keys;
- build validation accepting traversal/cross-brand targets and directories;
- Share still present outside viewers;
- generic symbol-only feedback instead of configured outcome messages;
- duplicate accessible logo naming;
- non-wrapping indicators and unmirrored RTL entry motion.

The new exact gesture-boundary cases, direct `writeProgress` persisted-output case, metadata restoration assertions, and existing retry behavior were already green because they pin correct existing behavior or test hygiene; no production behavior change was required for those assertions. The redundant retry state was removed under the existing error/retry regression test.

### Node 20 test-fixture diagnosis

After downgrading jsdom, Node 20 exposed three cross-realm fixture failures (`object.stream is not a function`). Diagnostic command:

```bash
npx --yes --package=node@20.19.5 node --input-type=module -e 'import { JSDOM } from "jsdom"; const dom = new JSDOM(); const blob = new dom.window.Blob(["image"]); console.log({ node: process.version, jsdomBlobStream: typeof blob.stream, globalBlobStream: typeof Blob.prototype.stream }); try { new Response(blob); console.log("response accepted") } catch (error) { console.log(error.message) }'
```

Result: Node `v20.19.5`; jsdom Blob `stream` was `undefined`, global Blob `stream` was a function, and Node's Response rejected the jsdom Blob. Test HTTP responses now use a string body with an image content type, avoiding a non-browser cross-realm combination while preserving the response/blob boundary exercised by production code.

## GREEN evidence

Focused command after implementation:

```bash
pnpm vitest run tests/page-actions.test.ts tests/App.test.tsx tests/validate-brand.test.ts tests/validate-brands-script.test.ts tests/PageViewer.test.tsx tests/shared-components.test.tsx tests/progress.test.ts
```

Result: 7 files passed, 87 tests passed. `pnpm exec tsc --noEmit` and `pnpm validate:brands` also exited 0.

Current-runtime full gate:

```bash
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm check
```

Result: 8 files passed, 100 tests passed; 1 brand manifest validated; TypeScript passed; Vite 8.2.2 built 30 modules and emitted `dist/`.

Node-floor frozen-install/full-gate command:

```bash
CI=true npx --yes --package=node@20.19.5 --package=pnpm@10.34.5 sh -c 'node --version && pnpm --version && pnpm install --frozen-lockfile && pnpm check'
```

Result: Node `v20.19.5`, pnpm `10.34.5`, frozen install up to date, 8 files passed, 100 tests passed, brand validation/TypeScript passed, and the Vite production build succeeded. This uses temporary `npx` packages and does not alter the machine's global Node installation.

## Changed files

- Toolchain/docs: `package.json`, `pnpm-lock.yaml`, `README.md`, `docs/adding-a-brand.md`, `docs/superpowers/specs/2026-08-21-multi-brand-content-viewer-design.md`.
- Core/build: `scripts/validate-brands.ts`, `src/core/brand-registry.ts`, `src/core/brand-types.ts`, `src/core/page-actions.ts`, `src/core/validate-brand.ts`, `src/App.tsx`.
- Brand/UI: `src/brands/minene.ts`, `src/components/BrandShell.tsx`, `src/components/PageViewer.tsx`, `src/components/ShareSheet.tsx`, `src/styles.css`.
- Tests/fixtures: `tests/App.test.tsx`, `tests/PageViewer.test.tsx`, `tests/fixtures/demo-brand.ts`, `tests/navigation.test.ts`, `tests/page-actions.test.ts`, `tests/progress.test.ts`, `tests/setup.ts`, `tests/shared-components.test.tsx`, `tests/validate-brand.test.ts`, `tests/validate-brands-script.test.ts`.
- Evidence: `.superpowers/sdd/2026-08-21-multi-brand-content-viewer/final-fix-report.md`.

## Residual concern

No known code or gate failure remains. Native Web Share, download, and popup policy still vary by device/browser, so a real-device smoke check remains useful deployment validation; the browser-boundary outcomes and cleanup paths are covered deterministically in tests.
