# Next.js Conversion Handover

Date: 2026-08-23
Status: Complete. Branch `feat/nextjs-conversion`, 26 commits.

The conversion of this repository from a Vite single-page application to Next.js
App Router is finished. Every screen has a URL, `pnpm check` passes, 152 unit
tests pass across 14 files, and the visual suite passes 20/20 against references
captured from the Vite build before it was deleted.

This document carries forward the parts of the final whole-branch review that
outlive the branch: what is still owed, and what the next sub-projects should
know before they start. The spec is at
`specs/2026-08-23-minene-nextjs-conversion-design.md` and the plan at
`plans/2026-08-23-minene-nextjs-conversion.md`.

## Before the first deploy

Confirm in the Vercel dashboard that the linked project's Framework Preset is
Next.js and that any Output Directory override left from the Vite build,
which would have been `dist`, is cleared. `.vercel/project.json` shows an
existing linked project that had been deploying the Vite build. No code change
can fix this, and a stale override makes the first deploy serve an empty
directory. The README repeats this where a deployer will see it.

## Outstanding findings, triaged

Several entries in `deferred-minors.md` are truncated at ~120 characters; I triaged on the visible text.

| # | Item | Verdict | Reasoning |
|---|---|---|---|
| 1 | T1: `--exclude tests/visual` duplicated in scripts | **Already resolved** | `package.json` scripts are now bare `vitest` / `vitest run`; the exclude lives once in `vitest.config.ts:15`. No action. |
| 2 | T1: references prove local determinism only | **Fix soon after** — as documentation | Cross-environment determinism cannot be established without regenerating, which is banned. The fix is the README section in Important 4, naming macOS as the capture platform. |
| 3 | T2: `it(` vs `test(` in validate-brand.test.ts | **Fix before merge** | Two words, and it is one of only two cross-task style divergences left. Do it with Minor 4. |
| 4 | T3: `brand.tools.some(...)` appears 3× without `findTool` | **Fix soon after** | Real DRY, but it belongs in the shared route-helper refactor described in the readiness section, not as a standalone edit. |
| 5 | T3: `clampPageIndex(param, 0)` returns 0 | **Accept permanently** | Unreachable twice over: `resolveScreen:64` rejects an empty group before clamping, and validation forbids one existing. Signalling "no valid page" would add a branch nothing can take. |
| 6 | T4: report prose mislabels a ruling | **Accept permanently** | A `.superpowers/` report file, gitignored, zero code impact. |
| 7 | T5: `generateViewport` and `generateStaticParams` untested | **Partly stale; rest fix soon after** | `generateViewport` is now tested (`tests/brand-metadata.test.ts:20,27`). `generateStaticParams` is not — fold it into Important 3. |
| 8 | T5: `not-found.tsx` pulls the registry into the client bundle | **Fix soon after — before sub-project 2** | Verified: it lands on every route, not just the 404. Negligible today; a tenant-data question the moment brand means tenant. See readiness. |
| 9 | T5: `BrandShellClient` has no unit test | **Accept permanently — superseded** | `tests/viewer-client.test.tsx` renders it as the tree root and exercises `register`, `report`, share-open and share-close-on-pathname. It is covered now, just not in a file bearing its name. |
| 10 | T5: the share button silently no-ops if a route forgets to register | **Fix soon after** | Unreachable today (effects run before paint, and the only viewer route registers). It is a trap for sub-projects 3–4, which will add screens under the same shell. Render the button only when a factory is registered, or throw in development. |
| 11 | T5: the `_rsc` abort is unconditional so it also applies to click mode | **Accept permanently** | Click mode cannot run at all. Resolves itself if Minor 6 is taken. |
| 12 | T5: tsconfig carries ~30 lines of Next-generated churn | **Accept permanently** | Next rewrites `tsconfig.json` on every `build` and `dev`. Fighting it loses on every run. |
| 13 | T6: subject route re-finds what `resolveScreen` found | **Accept permanently as-is** | The `assertDefined` makes the guarantee explicit and loud, the scan is O(8), and the fix is not a local edit — it is the shared route helper below. |
| 14 | T7: header reads "1 / N" in served HTML for a deep link | **Accept permanently** | The only alternative is `useSearchParams()` in the layout, which per `brand-shell-client.tsx:67-75` turns every `notFound()` and `redirect()` below into a 200. A momentarily wrong counter against silently broken status codes is not a close call. |
| 15 | T7: `use-progress.ts:25,27` fallback branches uncovered | **Accept permanently** | Defensive branches for blocked site data and stubbed globals. The harness guarantees storage exists, so covering them means mocking the thing being defended against. |
| 16 | T7: `MemoryStorage.setItem` does not `String()`-coerce | **Accept permanently** | It implements `Storage`, so TypeScript already rejects a non-string at every call site. Coercion would only matter to an untyped caller that cannot exist here. |
| 17 | T7: `viewer-client.test.tsx:164` cannot distinguish clear-on-pathname from … | **Accept permanently** | Entry truncated. As written, both candidate causes produce the behaviour the product wants (the sheet is gone), so the test asserts the guarantee that matters. |
| 18 | T7: share effect depends on the whole `group` object | **Accept permanently** | `group` is deserialized fresh from the RSC payload on every page turn anyway, so narrowing the deps saves no re-registration. |
| 19 | T7: `useShareTarget` narrows only at the type level | **Accept permanently** | Type-level narrowing is the stated intent; a cast to defeat it is a deliberate act. |
| 20 | T7: the context error no longer names which hook was misused | **Accept permanently** | "must be used inside BrandShellClient" plus a stack trace is enough to find the caller. |
| 21 | T7: `pagePosition?: PagePosition \| null` with `= null` says absent twice | **Accept permanently** | Harmless, and the default keeps `findHeaderContent`'s signature non-optional. |
| 22 | T8: tool route inlines its params type | **Fix before merge** | Two lines, and it is the other half of the cross-task divergence. Do it with #3 above. Note the brand home route inlines too, so it is two files. |

Summary: **3 fix before merge** (all cosmetic, four lines total), **5 fix soon after**, **13 accept permanently**, **1 already resolved**.


## Readiness for sub-projects 2 to 5

The architecture helps more than it hinders, and I found nothing that has to be *undone*. Four things are worth knowing before starting sub-project 2.

**1. There is no shared route helper, and there should be before auth lands.** All five files under `app/[brandId]/` open with the same three lines:

```ts
const { brandId } = await params
const brand = getBrand(brandId)
if (!brand) notFound()
```

This duplication is framework-imposed — a layout cannot pass props to a page — not carelessness, and the implementers handled it identically everywhere, which is the good outcome. But sub-project 2 adds "resolve the profile, resolve the tenant, check the tenant owns this brand" to exactly that spot, and today that means editing five files and hoping none is missed. A missed one is an authorization bypass, not a bug. Introduce `requireBrand(params)` first, as a pure refactor with the current test suite green, then add the tenant check inside it once. The same helper is the natural home for the four `assertDefined` re-finds (deferred item 13).

**2. Every brand, subject and tool route is prerendered from the static registry — and brand is about to mean tenant.** `generateStaticParams` currently walks `brandManifestEntries` and emits a page per subject and tool. That is correct today with one public brand. Once a brand is a tenant and a data boundary, prerendering every brand means every tenant's content exists as a static file on the CDN, and middleware becomes the only thing between an anonymous request and another tenant's pages. That is a defensible design, but it must be a decision, not an inheritance. Decide in sub-project 2 whether tenant routes stay SSG behind middleware or become dynamic behind a server-side session check. Deferred item 8 is the same question in miniature: the manifest is already in the client bundle on every route, which is fine for one public brand and is a data-exposure question for many private ones.

**3. `resolveScreen` caps a brand subtree at two segments, and the shell's fallback for anything deeper is silent.** `src/core/navigation.ts:46` returns `null` for `segments.length > 2`, and `brand-shell-client.tsx:77` turns `null` into `createInitialScreen()`. Sub-projects 3 and 4 mount a rules dashboard, approval lobby, PDF extraction and admin history behind `מוח ארגוני`, and a persuader behind `משכנע` — those are multiple screens that will want URLs like `/minene/tools/brain/rules/123`. The moment such a route file exists, the layout will resolve it to the home screen: brand lockup header, no back button, `aria-current="page"` on Home, and no error anywhere. It presents as a styling bug and debugs like one.

Nothing is broken today — Next 404s on unmatched paths before `[brandId]/layout.tsx` runs, so no >2-segment path can reach the resolver. But make it the first change in sub-project 3: treat `[TOOLS_SEGMENT, toolId, ...rest]` as `{ kind: 'tool', toolId }` when the tool exists, so a tool sub-app keeps the tool's shell chrome for its whole subtree. Roughly three lines, and it makes 3 and 4 purely additive.

**4. Two smaller items.** `app/page.tsx` redirects to `DEFAULT_BRAND_ID`; sub-project 2 will want it to redirect to the *user's* tenant, which makes `/` dynamic — a change, not an undoing. And the pnpm pin is still 10.34.5 against `eran-presueder`'s 11.0.9. The plan's Self-Review deliberately deferred this and said so, so it is a recorded decision, not a lost requirement — but it is still owed before sub-project 4 merges the two repositories, and the spec's argument that it is cheaper now than mid-merge has not gotten any weaker.

There are no security issues today. The 404 paths return real 404 status codes with the specialisation done client-side, which is the right ordering. `src/core/validate-brand.ts:39-67` is genuinely careful — prefix check, `URL` round-trip, empty-segment rejection, and per-segment `decodeURIComponent` catching encoded traversal and NUL — and `urlSafeId` means every id interpolated into an href is `[a-z0-9-]` by construction, so no href built by `src/core/hrefs.ts` can escape its brand. The reflected path segment in `app/not-found.tsx:30` is React-escaped text. The one thing worth adding before auth is security headers: the deleted `vercel.json` contained only the SPA rewrite, and there is no `next.config.ts`, so the app ships with no CSP, HSTS or frame headers. That was equally true before this branch, so it is not a regression — but sub-project 2 is the moment it starts to matter.


## Test-suite health

135 tests over 13 files, and I found no test passing for the wrong reason. The suite asserts real behaviour: `href` attributes rather than click handlers, `localStorage` contents rather than mock calls, and `tests/viewer-client.test.tsx:127` deliberately re-renders twice to prove the restore-once guarantee survives both the in-flight and the settled render. The `MemoryStorage` extraction removed the only duplication I found. Redundancy is low; `HomeScreen`'s links are asserted both directly and through the shell harness, which is worth keeping since they exercise different composition.

The real gaps are Important 3 (no route-level tests) and the reliance profile of the visual suite. On the latter: the reliance is sound but narrower than it looks. The suite verifies **server-rendered first paint only** — every test does a bare `page.goto()`, and `viewer.spec.ts:16` aborts all `_rsc=` traffic. Client-side navigation, which is the mechanism the whole button-to-anchor conversion introduced, is never screenshotted. That is acceptable (the same components render either way, and the unit tests cover the anchors), but it should be stated rather than assumed, because "20/20 visual pass" sounds like it covers more than it does.

One reassurance about the references that cuts against the guard messages: they are committed at f6e2f81, so an accidental overwrite is recoverable with `git restore tests/visual/__snapshots__`. The `package.json` and `playwright.config.ts` messages both say the overwrite "cannot be undone", which overstates it. The guards themselves are adequate — `updatesSnapshots` at `playwright.config.ts:8` correctly matches `-u`, `--update-snapshots`, and both the `=mode` and space-separated `mode` forms — and nothing else on this branch writes to that directory. Git is the real backstop, and it is in place.


