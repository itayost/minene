# Minene Next.js Conversion Design

Date: 2026-08-23
Status: Draft

## Objective

Convert the multi-brand content viewer from a client-rendered Vite single-page
application to a Next.js App Router application, giving every screen a real URL,
while the viewer continues to look and behave as it does today.

This conversion carries no new features. It exists because three later
sub-projects cannot begin without it.

## Why This Is First

Three repositories are being merged into one product. `minene` becomes the host
application. The two bottom-navigation tools that are static preview lists today
become real surfaces:

- `משכנע` becomes the persuader currently in the `eran-presueder` repository.
- `מוח ארגוני` becomes the rules dashboard, approval lobby, PDF rule extraction,
  and admin history currently in the `eran-task` repository.

The full programme is five sub-projects, each with its own spec, plan, and
implementation cycle:

1. Convert `minene` to Next.js. This document.
2. Put Supabase Auth in front of the whole shell. A profile resolves a tenant,
   and the tenant resolves the brand.
3. Port the `eran-task` surfaces into `מוח ארגוני`, converting JSX to TypeScript.
4. Port the `eran-presueder` engine, rules page, and API routes into `משכנע`.
5. Connect the two: `preparePlan()` grounds its drafted persuasion plan in the
   tenant's approved rules instead of free text typed by the user.

Decisions already taken that shape the later sub-projects, recorded here so this
conversion does not foreclose them:

- A brand is a tenant. `/minene` is both the visual identity and the data
  boundary. There is one tenant per brand.
- The whole application sits behind Supabase Auth, including the content viewer.
- Two topic vocabularies coexist. Brand `subjects` continue to drive the content
  viewer. The seven `eran-task` rule topics continue to drive rules and
  documents. The existing `rules_topic_id_check` and `documents_topic_id_check`
  constraints are not migrated.
- Approved rules feed the persuader, making the product one pipeline: a document
  is uploaded, rules are extracted, rules are approved, and approved rules become
  the persuader's ammunition.

Sub-projects 2 through 5 all require server components, route handlers, or
middleware. That is why a static export was rejected and why this conversion
must come first.

## Scope

This sub-project includes:

- A Next.js App Router route for every screen the viewer can display.
- Resolution of a URL into a validated screen, replacing the navigation reducer.
- Subject cards, group rows, and tool entries rendered as real link anchors.
- Server-rendered per-brand document title and theme colour.
- Static prerendering of every brand, subject, group, and tool route.
- A reserved-identifier rule in brand validation.
- Removal of the Vite build, `index.html`, `main.tsx`, and `vercel.json`.

This sub-project does not include: authentication, Supabase, any ported code
from the other two repositories, new brands, changes to page assets, changes to
the sharing or saving behaviour, or any visual change.

## Route Map

```
app/
  layout.tsx                          html shell, Heebo, styles.css
  page.tsx                            redirect to the registry default brand
  not-found.tsx                       BrandNotFound
  [brandId]/
    layout.tsx                        resolve brand or notFound; BrandShell
    page.tsx                          home, subject grid
    [subjectId]/
      page.tsx                        subject menu, or redirect when one group
      [groupId]/
        page.tsx                      page viewer, index from ?page=
    tools/
      [toolId]/
        page.tsx                      tool screen
```

### Page Index

The page index is a search parameter, `?page=N`, not a path segment. It is a
position inside a group rather than a resource. This keeps `generateStaticParams`
at one entry per group rather than one per page, and avoids a fourth dynamic
segment. The URL is one-based; internal state remains zero-based.

### Reserved Identifiers

Next resolves the static `tools` segment before the dynamic `[subjectId]`
segment. A brand declaring a subject with the identifier `tools` would therefore
become permanently unreachable at that route. Brand validation must reject
`tools` as a subject identifier. No current brand uses it.

### Single-Group Subjects

`openSubject` today skips the chooser when a subject has exactly one group. The
equivalent is a redirect: `/minene/tasks` redirects to
`/minene/tasks/daily-tasks`.

## URL Resolution

`src/core/navigation.ts` keeps its validation core and loses its action reducer.

The reducer and its thirteen action tests are removed. `validScreen`, page-index
clamping, and the fall-back-to-home guarantees for unknown brand, subject, and
group identifiers are retained and re-expressed as:

```
resolveScreen(brand, params, searchParams): Screen
```

Server route components call it to produce a `Screen` or to reject the URL.

The retained guarantee is that invalid input never crashes and never renders a
broken screen. How that guarantee is met changes, and deliberately so.

The single-page application silently fell back to the home screen for an unknown
subject or group, because there was no URL to be wrong about. A URL naming a
resource that does not exist is a different situation, and answering it with a
soft redirect to the home screen would return HTTP 200 for a resource that is not
there. Unknown subjects and groups therefore become genuine 404 responses.

Malformed input is handled as follows:

- An unknown brand identifier renders `BrandNotFound` from
  `app/[brandId]/layout.tsx`, which has the parameter in hand and can name the
  brand that was requested. `app/not-found.tsx` is the generic fallback for
  everything else and takes no parameters.
- An unknown subject or group identifier calls `notFound()`. This replaces the
  previous silent fall-back to the home screen.
- An unknown tool identifier calls `notFound()`, for the same reason.
- A `?page=` value that is absent, non-numeric, negative, or beyond the group
  length is clamped to a valid index rather than rejected. A page index is a
  position within a resource that does exist, not a resource of its own, so a
  bad one is corrected rather than refused.

## Server and Client Boundaries

Server components perform routing only: brand resolution, `resolveScreen`,
`notFound`, `redirect`, `generateStaticParams`, and `generateMetadata`.

Every interactive component is a client component: `BrandShell`, `HomeScreen`,
`SubjectMenu`, `PageViewer`, `ShareSheet`, `ToolScreen`, `BrandNotFound`.

`core/navigation.ts`, `core/brand-types.ts`, `core/brand-registry.ts`,
`core/validate-brand.ts`, and `core/progress.ts` are pure and require no
directive.

Components remain prop-driven. Route components compute `href` strings and pass
them down, so `HomeScreen`, `SubjectMenu`, and `ToolScreen` never call
`useRouter` and their tests require no `next/navigation` mock. Only a thin client
wrapper uses `useRouter`, for `router.replace` when paging. This preserves the
existing pattern in which `App` receives `pathname`, `registry`, and `storage`
as injected props.

This conversion does not pursue React Server Component payload reduction. It
establishes route structure.

## Browser Globals

Seven sites currently touch browser globals. Three change.

| Site | Resolution |
|---|---|
| `main.tsx` `document.getElementById` | File removed; Next owns mounting |
| `App.tsx` `window.localStorage` in a state initializer | Moves to a client hook, read in an effect |
| `App.tsx` `window.location.href` during render | Computed when the share sheet opens |
| `App.tsx` `window.location.pathname` | Replaced by route params |
| `page-actions.ts` `navigator`, `document`, `window.open` | Unchanged; only called from event handlers |
| `ShareSheet.tsx` `document.activeElement`, listeners | Unchanged; already inside effects |
| `BrandShell.tsx` `document.documentElement`, `document.title` | Split; see Metadata |

`window.location.href` is currently read during render, which is a hydration
hazard under server rendering. Moving it to the moment the share sheet opens also
makes it correct: it becomes the actual page URL rather than always the brand
root.

## Metadata, Theme, and Fonts

Next permits `<html>` only in the root layout, and a root layout cannot read a
child segment's parameters. Per-brand `lang` and `dir` on `<html>` therefore
cannot be server-rendered without middleware. `BrandShell`'s existing effect is
the correct pattern and is retained for those two attributes. The root layout
server-renders `lang="he"` and `dir="rtl"` as the default-brand baseline.
`.brand-shell` keeps its own `dir` and `lang`, so the rendered result never
depends on that effect running.

`document.title` moves out of the effect into `generateMetadata()` on the
`[brandId]` layout, so the served HTML carries the brand title. Link previews and
no-script loads stop showing the generic application title.

`theme-color`, currently hardcoded in `index.html`, becomes a per-brand
`viewport` export driven by `brand.theme.background`.

Theme custom properties continue to be applied as an inline style object on
`.app-stage`, which already server-renders correctly and needs no change.

Fonts remain on `@fontsource-variable/heebo`, imported in the root layout.
`next/font` is deliberately not adopted: it generates a hashed family name, while
`brand.theme.fontFamily` is manifest data containing a literal family list. Using
`next/font` would force every manifest to carry a build-generated identifier.
Fontsource already self-hosts.

## Navigation Semantics

- Subject cards, group rows, and tool entries render as `Link` anchors, gaining
  middle-click, right-click, open-in-new-tab, and correct link semantics for
  assistive technology.
- The in-application back control pushes to the parent route. It does not call
  `history.back()`. This preserves today's rule: the viewer returns to the
  chooser when the subject has more than one group, otherwise to the home screen.
- Paging uses `router.replace`, so moving through an eight-page group leaves one
  history entry rather than eight, and the back control continues to mean "leave
  this group".

## Progress Restore

Today, opening a group silently restores the last page read for that brand and
group.

With a URL that names the page, an explicit `?page=` must win. When it is absent,
the client reads stored progress after mount and calls `router.replace` to the
remembered page.

This is an accepted regression: the user sees the first page briefly before the
jump, which the current application does not do. Holding the render until
progress is read was rejected because it trades a brief flash for a blank frame.
`router.replace` is used so history is not polluted.

`core/progress.ts` itself is unchanged. Only its caller becomes a client hook.

## Build and Tooling

- `vite` is removed. `next` is added, pinned to 16.3.1 to match `eran-presueder`
  so the two agree before sub-project 4 merges them.
- `@vitejs/plugin-react` is retained; Vitest still needs it to transform JSX.
- `vite.config.ts` becomes `vitest.config.ts` and configures Vitest only.
- Scripts become `next dev` and `next start`. `build` remains a three-stage gate:
  `pnpm validate:brands && tsc --noEmit && next build`. The explicit
  `tsc --noEmit` is retained because `scripts/` and `tests/` sit outside Next's
  build graph and would otherwise stop being type-checked. `check` is unchanged.
- `tsconfig.json`: the `next` plugin is added, `include` gains `app` and
  `.next/types`, and `incremental` is enabled. `strict` and
  `noUncheckedIndexedAccess` remain enabled.

  `jsx` stays `react-jsx` and must not be changed. An earlier draft of this
  spec said it moves to `preserve`; that was wrong, and was an assumption
  carried over from older Next versions. Next 16.3.1 hardcodes `react-jsx` in
  `lib/typescript/writeConfigurationDefaults.js` with the reason "next.js uses
  the React automatic runtime", its `jsxMap` offers no other value, and it
  rewrites the tsconfig on every `next build` and `next dev`. Setting
  `preserve` is silently reverted. This is also convenient: Vite and Vitest
  transform JSX through `@vitejs/plugin-react` and are unaffected either way.

  Treat every other framework assumption in this document with the same
  suspicion. `eran-presueder/AGENTS.md` warns that this Next version differs
  from training data, and that warning was borne out here.

`minene` pins pnpm 10.34.5 and `eran-presueder` pins 11.0.9. These must converge
before sub-project 4. Bumping `minene` during this conversion is cheaper than
discovering the divergence mid-merge.

## Deployment

- `vercel.json` is deleted. Its only content is the catch-all rewrite to
  `index.html`, which Next makes unnecessary.
- `dist/` is removed and `.next` is added to `.gitignore`.
- `generateStaticParams` on every dynamic segment prerenders the whole site from
  the static registry at build time. Delivery characteristics match today's
  static bundle, and first paint improves because the served HTML is real rather
  than an empty root element.
- Vercel autodetects Next.js. No project settings change is required beyond
  clearing any output directory override left from the Vite build.

## Testing

The current suite is 103 tests across 9 files, all passing. That is the baseline
and the safety net.

Approximately 39 tests are rewritten: the 13 navigation reducer tests, the 12
`App` tests, and the parts of `SubjectMenu.test.tsx` and
`shared-components.test.tsx` that assert buttons where anchors now render. The
remaining tests, including all 16 `PageViewer` tests and all 16
`validate-brand` tests, are untouched.

New tests cover:

- `resolveScreen` against URLs: unknown brand, subject, and group identifiers;
  page clamping; out-of-range, negative, and non-numeric `?page=`; absent
  `?page=`.
- The single-group subject redirect.
- `generateMetadata` returning the brand title.
- Brand validation rejecting a subject with the reserved identifier `tools`.

Because the claim of this sub-project is that the viewer looks and behaves
exactly as before, and that is a visual claim, it is verified visually.

Playwright reference screenshots are captured against the current Vite build
before any code changes, at widths 320, 375, 768, 1024, and 1440, covering the
home grid, a multi-group subject chooser, a viewer page, and a tool screen. The
conversion is not complete until the Next build matches them.

These references must be captured first. Once `index.html` is deleted there is
nothing left to compare against.

## Risks and Accepted Regressions

1. Progress restore flashes the first page before jumping to the remembered page.
   Accepted; see Progress Restore.
2. A brand declaring a subject identifier of `tools` would be unreachable.
   Mitigated by a validation rule.
3. Sharing now produces a deep URL rather than the brand root. This is a
   behaviour change, and an improvement, but it is a change.
4. Unknown subject, group, and tool identifiers now return 404 instead of
   silently showing the home screen. Correct for a URL-addressed application, and
   a visible change for anyone holding a stale link.
5. Server rendering can expose hydration mismatches not visible today. The
   browser-global audit above is the mitigation; visual verification is the
   backstop.

## Out of Scope, Recorded for Later

- Deep-linkable sharing beyond what falls out of the route map.
- React Server Component payload optimisation.
- Any change to brand manifests other than the reserved-identifier rule.
- Migration of the two topic vocabularies into one.
