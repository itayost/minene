# Organisational Brain Design (sub-project 3)

Date: 2026-08-24
Status: Draft

## Objective

Give the `מוח ארגוני` tool three working entry points, ported from eran-task:
approval lobby, PDF rule extraction, and the admin rules history. The existing
preview list on that screen stays exactly as it is.

## Scope

Included:

- A tool that owns its whole URL subtree, so a tool can have sub-screens at all.
- A typed data layer over the existing `rules` and `documents` tables.
- `לובי אושר`, `חילוץ חוקים` and `דשבורד`, faithful in behaviour, restyled to
  minene's shell.
- Three entry points on the `מוח ארגוני` screen, with the admin one shown only to
  owners.

Not included: any change to `משכנע` or `קמפיינר`, any change to the content
viewer, private page assets (still sub-project 2b), and any new backend. Both
edge functions are already deployed and active on the shared project with
`verify_jwt = true`; this is a frontend and service-layer port.

## Decisions Taken

- **Faithful port, minene styling.** Behaviour, data and Hebrew copy are
  reproduced exactly; only the visual treatment changes to fit the shell.
  Rewording while converting JSX to TypeScript would make a port bug and an
  intended change indistinguishable in review.
- **Client components against the browser Supabase client**, with row-level
  security enforcing tenancy. This mirrors eran-task, whose services are already
  dependency-injected as `createRulesApi(client)`, so the port carries its own
  test suite across. Server components were considered and rejected: these
  screens are filters, stars, edit sheets and polling, so most of the work is
  client-side regardless, and rebuilding rather than porting discards the tests
  that prove the port correct.
- **Phased delivery from one spec.** The three surfaces are three views over one
  data layer, not independent subsystems, so the layer is built once. Each phase
  ships something that works and can be stopped after.

## Routing

`src/core/navigation.ts:46` returns null for any third segment beneath a brand,
and `BrandShellClient` turns null into the home screen. So `/minene/tools/brain/lobby`
would render the lobby wrapped in home chrome: brand lockup instead of a title,
no back control, Home highlighted in the navigation, and no error anywhere. It
presents as a styling bug and debugs like one.

A tool therefore owns its whole subtree. `Screen`'s tool variant becomes:

```ts
{ kind: 'tool'; toolId: string; subPath: readonly string[] }
```

empty at the tool root. `resolveScreen` accepts `[tools, toolId, ...rest]` as
that tool whenever the tool exists, rather than refusing past two segments.

Three consequences, all wanted:

- `parentHref` returns the tool root when `subPath` is non-empty, so back from
  the lobby lands on `מוח ארגוני` rather than skipping past it to the brand root.
- The bottom navigation keeps `מוח ארגוני` lit throughout the subtree, because
  `aria-current` already keys off `screen.kind === 'tool'` and the tool id.
- Unknown sub-screens still answer 404. Route files decide what exists beneath a
  tool; `resolveScreen` only decides which tool's shell you are in.

### Routes

```
app/[brandId]/tools/brain/page.tsx          three entry points, then the preview list
app/[brandId]/tools/brain/lobby/page.tsx    לובי אושר
app/[brandId]/tools/brain/extract/page.tsx  חילוץ חוקים
app/[brandId]/tools/brain/admin/page.tsx    דשבורד, owners only
```

`brain` is a static segment, not another dynamic parameter. Next resolves static
before dynamic — the same rule that makes `tools` beat `[subjectId]` — so
`[toolId]` keeps serving `משכנע` and `קמפיינר` unchanged and `ToolScreen` needs
no modification. There is no `toolId === 'brain'` conditional anywhere.

`משכנע` will get its own differently shaped subtree in sub-project 4, which is
why these are not generalised now.

### Known churn

`Screen`'s tool variant changes shape, so the `resolveScreen` tests asserting
`toEqual({ kind: 'tool', toolId })` need updating. That is real churn in a file
deliberately kept stable, accepted rather than special-casing the shell.

## Data Layer

Four files under `src/brain/`, grouped by feature as the rest of the repository is:

| File | Responsibility |
|---|---|
| `types.ts` | `Rule`, `RuleKind`, `RuleStatus`, `Document`, `TenantKpis` |
| `topics.ts` | The seven rule topics |
| `rules-api.ts` | `createRulesApi(client)`: list, listPending, setStatus, setStarred, edit, kpis |
| `documents-api.ts` | `createDocumentsApi(client)`: upload, extract, status, list |

Both keep eran-task's dependency-injected shape rather than a module-level
singleton. That is what makes them testable without a live project, and why the
existing tests port across largely intact.

The seven topics (`live`, `store`, `numbers`, `energy`, `team-energy`,
`briefing`, `performance`) stay their own vocabulary. Brand subjects drive the
content viewer; these drive rules and documents. They do not mix, as decided in
sub-project 1.

### Tenancy

Row-level security is the boundary. Reads go straight from the browser through
`list_rules` and `list_pending_rules`, and a caller sees only their own tenant's
rows. The API layer never sends a tenant id for reads.

The one exception is `documentsApi.upload`, which needs the tenant id to build
the storage path `<tenant_id>/<document_id>.pdf`, because the storage policy
matches on that prefix. That id comes from the session: the server component
reads it from `requireBrand` and passes it to the client component as a prop. It
is never taken from user input, matching the rule the edge functions already
follow.

### Expired sessions

A 401 mid-session is a real case here and was not before. eran-task notes that
storage and `functions.invoke` surface an expired session as a plain HTTP 401
while PostgREST reports it differently. In eran-task that meant "signed out"; in
minene it means the Supabase cookie expired while someone was reading.

The middleware refreshes on navigation, but these screens make requests without
navigating — polling an extraction, starring a rule — so a long idle session can
expire in place. Both API layers translate a 401 into a redirect to
`/login?next=<current path>`, so an expired session sends the reader to sign in
and then back where they were, rather than showing an error they cannot act on.

## The מוח ארגוני Screen

Two parts: the three entry points, then the existing preview list unchanged,
including its `תצוגה מקדימה` note.

Entry points sit **above** the list. The list is explicitly labelled a preview of
document content; the buttons are the working product, and putting real
functionality below a preview would invert the hierarchy.

Each is a `Link` styled as a card matching the existing pink rows — same radius,
same right-to-left alignment, same pink accent — but visually weightier so the
hierarchy reads: actions first, reference material second. Labels are
`לובי אושר`, `חילוץ חוקים`, `דשבורד`.

The `דשבורד` entry renders only for owners. A staff member should not see a link
to a page that will 404 for them.

## The Three Surfaces

**Phase 1, `לובי אושר`.** Rules awaiting approval, oldest first, with approve,
reject, and an edit sheet that corrects a rule's text, kind and topic before
approving. The smallest complete loop: it reads and writes, so it exercises the
whole data layer.

**Phase 2, `חילוץ חוקים`.** Choose a topic and a PDF, upload to the `documents`
bucket, invoke `extract-rules`, then poll the document's status until it reports
how many new rules were found. Those rules land pending, which is what fills the
lobby.

**Phase 3, `דשבורד`.** The rules table with topic, text and starred filters,
persistent stars, and the KPI cards. Owner-only, which is where the `role`
carried through in sub-project 2a is finally used. A staff member gets a 404, not
a 403, consistent with the rule for brands.

### The empty-lobby risk

The lobby shows rules with `status = 'pending'`, and the shared project may have
none. If so, phase 1 ships something correct but unverifiable by eye: an empty
lobby and a broken lobby look identical.

Check for pending rules before starting phase 1. If there are none, either run
one extraction through the already-deployed function to seed some, or swap phases
1 and 2 so extraction lands first. Do not write a seed script: that is a
throwaway artifact for a problem one real PDF solves.

## Testing

The port's safety net is that eran-task's tests come with it. They describe
behaviour that already works, so a ported test that fails means the port is
wrong. They need converting to TypeScript and rehoming onto the new module
paths, not rethinking.

Three additions have no equivalent to inherit:

- **Tool-subtree resolution.** A third segment under a known tool resolves to
  that tool with `subPath`; `parentHref` returns the tool root from a sub-screen;
  an unknown tool returns null however deep the path.
- **401 handling.** An expired session redirects to login rather than surfacing
  an error.
- **The owner gate.** A staff role neither sees the admin entry point nor can
  load the admin route.

The 20 frozen references stay untouched and must still pass 20/20. Nothing here
changes the persuade tool screen, the home grid, the subject chooser or the
viewer, so a reference moving means something unrelated broke. Both snapshot
guards stay exactly as they are.

## The Label Typo, Deliberately Not Fixed

The manifest spells the tool `מוח ארגני`, missing the vav. The correct spelling
is `מוח ארגוני`, and this document uses the correct one when naming the tool.

**The manifest is not corrected here.** That label renders in the bottom
navigation, which appears in all four reference screenshots at all five widths.
Changing one character would invalidate all 20 references, and they cannot be
regenerated because the application that produced them no longer exists.

The fix belongs with the first change that legitimately alters the shell chrome.
Sub-project 4 rebuilds `משכנע` and will move the references' role anyway; correct
it there, in the same change, so the cost is paid once and knowingly.

## Risks and Accepted Trade-offs

1. The lobby may be empty on arrival, making phase 1 hard to verify by eye. See
   the empty-lobby risk above.
2. `Screen`'s tool variant changes shape, churning tests in a previously stable
   file.
3. These screens hold tenant data in the client bundle at runtime, which is the
   same posture as eran-task and the reason RLS is the boundary rather than the
   API layer.
4. Page assets remain public until sub-project 2b. Unchanged by this work.
5. The tool's label keeps its spelling error until the shell legitimately
   changes. See above.

## Out of Scope, Recorded for Later

- `משכנע` and its subtree (sub-project 4).
- Wiring approved rules into the persuader (sub-project 5).
- Private page assets (sub-project 2b).
- Generalising tool subtrees beyond what `brain` needs.
