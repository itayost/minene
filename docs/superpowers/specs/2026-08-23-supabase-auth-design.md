# Supabase Auth Design (sub-project 2a)

Date: 2026-08-23
Status: Draft

## Objective

Put Supabase Auth in front of the whole minene shell. A signed-in user's profile
resolves a tenant, and the tenant resolves the brand they may see. No content
route renders without a verified session.

This is the prerequisite for sub-project 3, which ports eran-task's dashboard,
approval lobby, PDF extraction and admin history into the `מוח ארגוני` tool.
Every one of those surfaces assumes an authenticated profile with a tenant.

## Scope

This sub-project includes:

- A `brand_id` column on `tenants`, linking a tenant to a brand manifest.
- Supabase session plumbing: browser, server and middleware clients.
- Middleware that refreshes the session cookie and redirects signed-out requests.
- A `requireBrand()` helper enforcing the session and tenant in every route.
- A `/login` route with validated return-to, and a `/logout` route.
- `/` redirecting to the signed-in user's brand rather than a hardcoded default.

This sub-project does NOT include: private page assets, role-based gating,
a signup flow, password reset, any change to the rendered shell, or any ported
code from the other two repositories.

## Decisions Taken

- **Brand equals tenant.** One tenant per brand; the brand is both the visual
  identity and the data boundary.
- **The URL keeps its brand segment.** `/[brandId]/...` is unchanged from
  sub-project 1. The brand in the URL is now a claim the server verifies against
  the caller's tenant, not a free choice. Dropping the segment was considered and
  rejected: it closes an attack surface the server-side check closes anyway,
  while churning every route file and every URL the visual suite navigates to.
- **Enforcement is defence in depth.** Middleware gates and refreshes; a shared
  helper re-verifies server-side in every route. Reading cookies opts routes out
  of static generation, so the 8 subject and 3 tool routes become dynamic, as
  the viewer route already is. Middleware-only authorization was rejected: Next
  shipped a middleware-bypass CVE in 2025, and while 16.3.1 is patched, an
  architecture whose only gate is an edge matcher fails open when someone adds a
  route and forgets the matcher.
- **Accounts are created by an owner** in the Supabase dashboard. Public signup
  stays disabled; there is no self-service path into a tenant.
- **Content privacy is deliberately out of scope here.** Page images stay public
  under `public/brands/`. Sub-project 2b moves them into Supabase Storage behind
  per-tenant RLS. Until then the content is unlisted, not secret, and this
  document does not pretend otherwise.

## Schema

`tenants` gains one column:

```sql
alter table public.tenants add column brand_id text not null unique;
```

backfilled to `'minene'` for the existing tenant
`11111111-1111-4111-8111-111111111111`.

The database cannot validate `brand_id` against the TypeScript brand registry,
so the two can disagree. That case is NOT a 404: a 404 asserts the resource does
not exist, when in fact the data references a brand the deployed code lacks.
`requireBrand()` raises instead, so an operator sees a misconfiguration rather
than users seeing a silent absence.

### Migration ownership

The migration lands in the **eran-task** repository, not this one.

Both repositories will share Supabase project `zibpqbrfvxmkqnwmiboo`, and
`eran-task/supabase/migrations/` is already that schema's single source of truth
with 23 migrations. A second migration directory in minene would mean two
repositories writing to one database with no shared ordering, which produces a
migration applied in one checkout and missing in another.

This stays a cross-repository dependency until sub-project 3 merges the two, at
which point the migrations arrive with the rest of eran-task.

Note that eran-task's real code lives on its `feat/interactive-dashboard`
branch, not `master`. The migration must land where both that branch and this
repository agree on the applied schema.

## Session Plumbing

Two dependencies: `@supabase/ssr` and `@supabase/supabase-js`.

Three client factories, because each context needs a different cookie strategy:

| Factory | Context | Responsibility |
|---|---|---|
| browser | the login form | sign in, sign out |
| server | route components | read cookies, verify the user |
| middleware | `middleware.ts` | read cookies AND write refreshed ones onto the response |

Environment: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
replacing eran-task's `VITE_` prefix. Both are public browser configuration by
design. No service-role key enters this repository.

**The factories fail on use, not on module load.** A fresh clone and CI have no
Supabase credentials, and the existing 152 tests plus `pnpm check` must keep
passing without them. This mirrors the pattern already documented in
eran-task's `src/services/supabaseClient.js`, and for the reason recorded there:
a load-time throw makes the suite pass locally and fail everywhere else.

## Middleware

`middleware.ts` at the repository root does two jobs: refresh the Supabase cookie
so a long session does not expire mid-use, and redirect a signed-out request to
`/login?next=<path>`.

A signed-IN request to `/login` redirects to that user's brand, so an
authenticated visitor cannot sit on a sign-in form. That check lives in the login
route rather than the middleware, since the middleware deliberately does not run
there.

Its matcher must skip:

- `/login`, or a signed-out visitor redirects forever
- `/logout`, which must work whether or not the session is still valid
- `_next/static`, `_next/image`, `favicon.ico`
- `/brands/*`, because those assets stay public until sub-project 2b. Gating
  them here would break every page image the moment auth lands.

## Route Protection

`src/auth/require-brand.ts` exports `requireBrand(params)`, returning the
resolved brand and profile or throwing. It replaces the three-line
`getBrand` preamble currently duplicated across five route files.

Sequence: resolve the user, load the profile for `tenant_id` and `role`, load the
tenant for `brand_id`, compare against the `brandId` in the URL, resolve the
manifest.

**It calls `getUser()`, never `getSession()`.** `getSession()` decodes the cookie
the browser sent and therefore trusts client-controlled data. `getUser()`
revalidates against the Supabase auth server. On a server-side authorization
check that difference is the entire point, and it is asserted by a test so it
cannot silently regress.

**It runs in `app/[brandId]/layout.tsx` AND in each of the four routes beneath
it** — the brand home, the subject chooser, the viewer and the tool screen — not
the layout alone. Next's own guidance places authorization next to the data it
protects, because a layout does not necessarily re-run on client-side
navigation. Relying on inheritance is the "a missed route is an authorization
bypass" failure mode this helper exists to prevent.

`requireBrand` takes the requested `brandId` and therefore serves only routes
that have one. `app/page.tsx` has no such parameter: it asks who the caller is
rather than checking a claim. That is a separate, smaller function,
`resolveUserBrand()`, returning the brand for the current session or redirecting
to login. Both live in `src/auth/` and share the profile-and-tenant lookup, so
the session logic exists once.

Three outcomes, deliberately distinguished:

| Situation | Response |
|---|---|
| No valid session | Redirect to `/login?next=…` |
| Signed in, another tenant's brand | 404, never 403, so probing cannot enumerate tenants |
| `brand_id` names a manifest the code lacks | Server error, surfaced to an operator |

`role` is loaded and returned but nothing gates on it. The content viewer has no
owner-only surface. Carrying it now means sub-project 3's `/admin` gets its owner
check without reworking the helper; gating on it now would build a feature
nothing uses.

## Routing Changes

`app/page.tsx` stops redirecting to a hardcoded `DEFAULT_BRAND_ID` and redirects
to the signed-in user's brand, which makes `/` dynamic.

`DEFAULT_BRAND_ID` survives for one remaining purpose: theming the login screen,
which by definition runs before a brand is known.

## Login and Logout

`app/login/page.tsx` is a server component reading `?next=`; the form is a small
client component calling `signInWithPassword`.

**`next` is an open-redirect surface and is validated twice.** Before use it must
be a relative path beginning with a single `/`, which rejects `//evil.com` —
browsers treat that as protocol-relative, and it is the classic bypass. After
sign-in it must belong to the caller's own brand, otherwise it falls back to
their brand root, so a deep link shared from another tenant does not survive a
login prompt.

**The login screen cannot be brand-themed**, because the brand comes from the
session and there is none yet. It renders in the default brand's theme and
Hebrew labels, RTL like everything else. With one tenant this is invisible. With
several it would mean everyone signs in wearing Minene's colours. That is
accepted rather than solved: a last-brand cookie is machinery for a problem that
does not exist yet.

**Sign-out is a bare `/logout` route with no visible control in the shell.**

This is deliberate and unsatisfying. The 20 frozen reference screenshots cover
home, subject chooser, page viewer and tool screen, and every one includes the
shell header and bottom navigation. A sign-out control anywhere in that chrome
changes all four screens at all five widths, and the references cannot be
regenerated because the application that produced them no longer exists.

It is also temporary. Sub-project 3 replaces the tool screens outright, the shell
changes for real reasons, and the references' role has to be renegotiated then
regardless.

## Testing

Unit tests for `requireBrand()` against a mocked Supabase client: no session
redirects, a mismatched brand 404s, an unknown manifest raises rather than 404s,
and the helper calls `getUser()` rather than `getSession()`.

Unit tests for `next` validation: reject `//evil.com`, reject `http://evil.com`,
reject a path in another tenant's brand, accept an ordinary deep link.

The existing 152 tests must pass with no `.env.local`, asserted rather than
assumed.

The visual suite gains a `globalSetup` that signs in once and saves
`storageState` for all 20 tests, because every route now requires a session.
That gives `pnpm visual:verify` a dependency it never had: real credentials and
a test account.

That dependency stays OUT of `pnpm check`, so a fresh clone still runs unit tests
and a build with nothing configured. When credentials are absent the visual suite
**skips with a clear message** rather than failing with connection errors that
look like a broken suite. Failing confusingly on a missing prerequisite is the
trap the `webServer` block closed in sub-project 1.

**The 20 references must still match exactly.** Nothing in this sub-project
changes a rendered pixel, so a 20/20 gate proves auth altered nothing visually.
If any reference moves, that is a finding, never a reason to regenerate. Both
snapshot guards stay exactly as they are.

## Risks and Accepted Trade-offs

1. Page assets remain publicly fetchable by direct URL until sub-project 2b. The
   interface is private; the content is unlisted.
2. The 8 subject and 3 tool routes lose static generation, so they are served by
   a function rather than from the CDN. This is the cost of verifying the session
   next to the data.
3. Sign-out has no visible entry point until sub-project 3.
4. The login screen shows the default brand's theme regardless of who is signing
   in.
5. The migration lives in another repository until sub-project 3 merges them,
   so the two must be applied in a known order.
6. `pnpm visual:verify` now needs credentials, and skips without them.

## Out of Scope, Recorded for Later

- Private asset delivery (sub-project 2b).
- Role-based gating (arrives with sub-project 3's `/admin`).
- Signup, password reset, and account management.
- A per-tenant login theme.
- Security headers. The app still ships with no CSP, HSTS or frame headers,
  which was equally true before auth existed, but auth is the point at which it
  starts to matter.
