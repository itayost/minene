# Supabase Auth Implementation Plan (sub-project 2a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Supabase Auth in front of the whole minene shell, so a signed-in user's profile resolves a tenant and the tenant resolves the one brand they may see.

**Architecture:** Middleware refreshes the Supabase cookie and redirects signed-out requests to `/login`. A shared `requireBrand()` helper then re-verifies the session server-side inside the brand layout and each of the four routes beneath it, so authorization sits next to the data rather than only at the edge. Reading cookies opts those routes out of static generation.

**Tech Stack:** Next.js 16.3.1 App Router, `@supabase/ssr` 0.12.4, `@supabase/supabase-js` 2.112.3, React 19.2.8, TypeScript 7, Vitest 4, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-23-supabase-auth-design.md`

## Global Constraints

- Branch off `main`: `feat/supabase-auth`. `main` is at `7e817a1` and is deployed.
- Node `>=20.19.0`. Do not lower this floor.
- TypeScript `strict` and `noUncheckedIndexedAccess` stay enabled. Index access and destructuring yield `T | undefined` and must be narrowed, never asserted with `!`.
- Baseline is 152 passing tests across 14 files. **They must keep passing with no `.env.local` present**, because a fresh clone and CI have none. This is the single hardest constraint in this plan.
- `pnpm check` must stay green and must not require Supabase credentials.
- No emojis in code, comments, or documentation.
- Hebrew RTL is a product constraint, not a localisation layer. Do not alter `dir`, `lang`, or any Hebrew copy. New user-facing copy is Hebrew.
- Commit format `<type>: <description>` where type is one of feat, fix, refactor, docs, test, chore, perf, ci. No attribution trailer, no Co-Authored-By line.
- pnpm only, never npm or yarn.
- **No service-role key enters this repository.** Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, both public browser configuration.
- **Never change a file under `tests/visual/__snapshots__/`.** Those 20 references were captured from an application that no longer exists and cannot be regenerated. Two guards enforce this: `pnpm visual:reference` exits 1, and `playwright.config.ts` throws on `-u`, `--update-snapshots`, and `--update-snapshots=<mode>`. Never weaken either. Nothing in this sub-project may change a rendered pixel.
- `--grep` must be unanchored: Playwright matches the full title path, so `"^home$"` errors with "No tests found".

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/auth/safe-next.ts` | Pure validation of the `?next=` return-to parameter |
| `src/auth/supabase-config.ts` | Reads the two env vars on use; `isSupabaseConfigured()` |
| `src/auth/supabase-browser.ts` | Browser client factory, for the login form |
| `src/auth/supabase-server.ts` | Server client factory reading request cookies |
| `src/auth/supabase-middleware.ts` | Middleware client that also writes refreshed cookies |
| `src/auth/session.ts` | Profile and tenant lookup, shared by both entry points |
| `src/auth/require-brand.ts` | `requireBrand(brandId)` and `resolveUserBrand()` |
| `middleware.ts` | Session refresh and signed-out redirect |
| `app/login/page.tsx` | Login route, reads `?next=`, redirects a signed-in caller away |
| `app/login/login-form.tsx` | Client form calling `signInWithPassword` |
| `app/logout/route.ts` | Route handler that signs out and redirects |
| `tests/safe-next.test.ts` | Tests for the return-to validation |
| `tests/require-brand.test.ts` | Tests for the auth helper against a mocked client |
| `tests/visual/global-setup.ts` | Playwright sign-in producing `storageState` |
| `.env.example` | The two public variables, documented |

**Modified:**

| File | Change |
|---|---|
| `app/page.tsx` | Redirect to the caller's brand, not a hardcoded default |
| `app/[brandId]/layout.tsx` | `requireBrand`; metadata stops leaking; static params marked inert |
| `app/[brandId]/page.tsx` | `requireBrand` |
| `app/[brandId]/[subjectId]/page.tsx` | `requireBrand`; static params marked inert |
| `app/[brandId]/[subjectId]/[groupId]/page.tsx` | `requireBrand` |
| `app/[brandId]/tools/[toolId]/page.tsx` | `requireBrand`; static params marked inert |
| `playwright.config.ts` | `globalSetup`, `storageState`, credential-absent skip |
| `package.json`, `README.md`, `.gitignore` | Dependencies, documentation, env ignore |

**Created in the eran-task repository:** one migration adding `tenants.brand_id`.

---

### Task 1: The `brand_id` migration, in the eran-task repository

The schema change lands in `eran-task`, not here, because both repositories share Supabase project `zibpqbrfvxmkqnwmiboo` and `eran-task/supabase/migrations/` is already that schema's single source of truth with 23 migrations. Two migration directories against one database produce a migration applied in one checkout and missing in another.

**Files:**
- Create: `/Users/itayostraich/Documents/GitHub/eran-task/.worktrees/interactive-dashboard/supabase/migrations/20260823120000_add_tenant_brand_id.sql`

**Interfaces:**
- Consumes: the existing `public.tenants` table from `20260819090000_add_tenancy.sql`
- Produces: `public.tenants.brand_id text not null unique`, set to `'minene'` for tenant `11111111-1111-4111-8111-111111111111`

- [ ] **Step 1: Confirm you are in the right repository and branch**

```bash
cd /Users/itayostraich/Documents/GitHub/eran-task/.worktrees/interactive-dashboard
git rev-parse --abbrev-ref HEAD
ls supabase/migrations | tail -3
```

Expected: branch `feat/interactive-dashboard`, and the last migration is `20260822100000_allow_editing_a_rule_topic.sql`. eran-task's `master` holds only docs; the real code is on this branch. If either check fails, stop and report BLOCKED.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260823120000_add_tenant_brand_id.sql`:

```sql
-- Links a tenant to the brand manifest it renders. minene resolves the brand a
-- signed-in user may see by reading this column, so a tenant without one has no
-- addressable content at all.
--
-- Added nullable, backfilled, then constrained: `add column ... not null` against
-- a table that already has rows fails without a default, and a default here would
-- be wrong -- there is no sensible brand to inherit, and a second tenant silently
-- adopting minene's brand is exactly the mistake this column exists to prevent.
alter table public.tenants add column brand_id text;

update public.tenants
   set brand_id = 'minene'
 where id = '11111111-1111-4111-8111-111111111111';

-- Fails loudly if any tenant was missed, rather than letting the not-null below
-- fail with a message that does not say which row is at fault.
do $$
declare
  v_missing int;
begin
  select count(*) into v_missing from public.tenants where brand_id is null;
  if v_missing > 0 then
    raise exception
      '% tenant(s) have no brand_id. Every tenant needs one before this column can be constrained.',
      v_missing;
  end if;
end $$;

alter table public.tenants alter column brand_id set not null;

-- One brand belongs to exactly one tenant: the brand IS the data boundary, so two
-- tenants sharing one would make the boundary meaningless.
alter table public.tenants add constraint tenants_brand_id_unique unique (brand_id);
```

- [ ] **Step 3: Verify it applies against a local database**

```bash
npx supabase start
npx supabase db reset --local
```

Expected: every migration applies in order with no error, this one included.

If Docker is unavailable, report that and STOP rather than pushing an unverified migration to the shared project.

- [ ] **Step 4: Verify the result locally**

```bash
npx supabase db reset --local
psql "$(npx supabase status --output json | python3 -c 'import sys,json;print(json.load(sys.stdin)["DB_URL"])')" \
  -c "select id, name, brand_id from public.tenants;"
```

Expected: one row, `brand_id` = `minene`.

- [ ] **Step 5: STOP. Do not push to the shared project.**

Applying this to `zibpqbrfvxmkqnwmiboo` changes a live database shared with eran-task. Report DONE_WITH_CONCERNS, state that the migration is verified locally and awaiting approval to push, and let the controller obtain it. Do not run `npx supabase db push`.

- [ ] **Step 6: Commit in the eran-task repository**

```bash
cd /Users/itayostraich/Documents/GitHub/eran-task/.worktrees/interactive-dashboard
git add supabase/migrations/20260823120000_add_tenant_brand_id.sql
git commit -m "feat: link a tenant to the brand manifest it renders"
```

---

### Task 2: Return-to validation

Pure TypeScript, no framework and no Supabase, so it is fully testable before anything else exists. This is the open-redirect surface, which is why it gets its own task and its own tests rather than living inline in the login route.

**Files:**
- Create: `src/auth/safe-next.ts`
- Create: `tests/safe-next.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `safeNextPath(next: string | null): string | null`
  - `nextWithinBrand(next: string | null, brandId: string): string | null`

- [ ] **Step 1: Write the failing tests**

Create `tests/safe-next.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { nextWithinBrand, safeNextPath } from '../src/auth/safe-next'

describe('safeNextPath', () => {
  it('accepts an ordinary absolute path', () => {
    expect(safeNextPath('/minene/results/overview')).toBe('/minene/results/overview')
  })

  it('keeps a query string', () => {
    expect(safeNextPath('/minene/results/overview?page=3')).toBe('/minene/results/overview?page=3')
  })

  it('rejects a protocol-relative path', () => {
    expect(safeNextPath('//evil.example')).toBeNull()
  })

  it('rejects a backslash-prefixed path', () => {
    expect(safeNextPath('/\\evil.example')).toBeNull()
  })

  it('rejects an absolute URL', () => {
    expect(safeNextPath('http://evil.example/minene')).toBeNull()
    expect(safeNextPath('https://evil.example/minene')).toBeNull()
  })

  it('rejects a relative path', () => {
    expect(safeNextPath('minene/results')).toBeNull()
  })

  it('rejects null and empty', () => {
    expect(safeNextPath(null)).toBeNull()
    expect(safeNextPath('')).toBeNull()
  })
})

describe('nextWithinBrand', () => {
  it('accepts a path inside the caller\'s own brand', () => {
    expect(nextWithinBrand('/minene/results', 'minene')).toBe('/minene/results')
  })

  it('accepts the brand root itself', () => {
    expect(nextWithinBrand('/minene', 'minene')).toBe('/minene')
  })

  it('rejects a path in another brand', () => {
    expect(nextWithinBrand('/other/results', 'minene')).toBeNull()
  })

  it('rejects a brand that merely shares a prefix', () => {
    expect(nextWithinBrand('/minene-other/results', 'minene')).toBeNull()
  })

  it('rejects anything safeNextPath already rejects', () => {
    expect(nextWithinBrand('//evil.example', 'minene')).toBeNull()
  })
})
```

The prefix case matters: a naive `startsWith('/' + brandId)` accepts `/minene-other`, which belongs to a different tenant.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/safe-next.test.ts`
Expected: FAIL, cannot resolve `../src/auth/safe-next`.

- [ ] **Step 3: Implement**

Create `src/auth/safe-next.ts`:

```ts
/**
 * A return-to path is attacker-supplied: it arrives as `?next=` on a URL anyone
 * can send. Only a same-origin absolute path is ever safe to redirect to.
 */
export function safeNextPath(next: string | null): string | null {
  if (!next) return null
  if (!next.startsWith('/')) return null

  // Browsers read a leading `//` as protocol-relative, so `//evil.example` is an
  // off-site redirect that passes a naive startsWith('/') check. Some also
  // normalise a backslash to a slash, which makes `/\evil.example` the same
  // attack wearing a different first character.
  if (next.startsWith('//') || next.startsWith('/\\')) return null

  return next
}

/**
 * A brand is a tenant boundary, so a return-to path is only honoured when it
 * belongs to the caller's own brand. A deep link shared from another tenant must
 * not survive a login prompt.
 */
export function nextWithinBrand(next: string | null, brandId: string): string | null {
  const safe = safeNextPath(next)
  if (!safe) return null

  const path = safe.split('?')[0] ?? ''
  const firstSegment = path.split('/').filter(Boolean)[0]

  // Compared segment by segment, not by prefix: `/minene-other` starts with
  // `/minene` but is a different brand belonging to a different tenant.
  return firstSegment === brandId ? safe : null
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run tests/safe-next.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Run the whole suite**

Run: `pnpm test:run`
Expected: 164 tests pass (152 + 12).

- [ ] **Step 6: Commit**

```bash
git add src/auth/safe-next.ts tests/safe-next.test.ts
git commit -m "feat: validate the login return-to path"
```

---

### Task 3: Supabase client factories

Three factories, because each context needs a different cookie strategy. The hard requirement is that none of them throws at module load: the suite and `pnpm check` must pass with no credentials configured.

**Files:**
- Create: `src/auth/supabase-config.ts`, `src/auth/supabase-browser.ts`, `src/auth/supabase-server.ts`, `src/auth/supabase-middleware.ts`
- Create: `.env.example`
- Modify: `package.json`, `.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `createBrowserSupabase(): SupabaseClient`
  - `createServerSupabase(): Promise<SupabaseClient>`
  - `createMiddlewareSupabase(request: NextRequest): { supabase: SupabaseClient; response: () => NextResponse }` — `response` is a GETTER, not a value. The response object is replaced whenever Supabase writes refreshed cookies, so callers must invoke it at the end (`response()`), never capture it up front.
  - `isSupabaseConfigured(): boolean`

- [ ] **Step 1: Install the dependencies**

```bash
pnpm add @supabase/ssr@0.12.4 @supabase/supabase-js@2.112.3
```

- [ ] **Step 2: Write the environment template**

Create `.env.example`:

```
# Public browser configuration. Both values are safe to ship to the client:
# the publishable key identifies the project and is gated by row-level security.
# A service-role key must never appear in this repository.
NEXT_PUBLIC_SUPABASE_URL=https://project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_example
```

Add to `.gitignore`:

```
.env.local
```

- [ ] **Step 3: Write the shared configuration reader**

Create `src/auth/supabase-config.ts`:

```ts
/**
 * Read on use, never at module load. A fresh clone and CI have no credentials,
 * and every test file that transitively imports a client factory would fail at
 * import time if this threw on load -- which makes the suite pass locally and
 * fail everywhere else. eran-task documents the same trap in
 * src/services/supabaseClient.js.
 */
export function supabaseConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return null
  return { url, key }
}

export function isSupabaseConfigured(): boolean {
  return supabaseConfig() !== null
}

export function requireSupabaseConfig(): { url: string; key: string } {
  const config = supabaseConfig()
  if (!config) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. '
      + 'Copy .env.example to .env.local and fill both in.',
    )
  }
  return config
}
```

- [ ] **Step 4: Write the browser factory**

Create `src/auth/supabase-browser.ts`:

```ts
'use client'

import { createBrowserClient } from '@supabase/ssr'
import { requireSupabaseConfig } from './supabase-config'

export function createBrowserSupabase() {
  const { url, key } = requireSupabaseConfig()
  return createBrowserClient(url, key)
}
```

- [ ] **Step 5: Write the server factory**

Create `src/auth/supabase-server.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { requireSupabaseConfig } from './supabase-config'

/**
 * Reads the request's cookies. Writing them from a server component is not
 * permitted by Next, so `setAll` is a no-op here: the middleware owns cookie
 * refresh, and swallowing the write is the documented pattern rather than an
 * oversight.
 */
export async function createServerSupabase() {
  const { url, key } = requireSupabaseConfig()
  const cookieStore = await cookies()

  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: () => undefined,
    },
  })
}
```

- [ ] **Step 6: Write the middleware factory**

Create `src/auth/supabase-middleware.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { requireSupabaseConfig } from './supabase-config'

/**
 * The only place a refreshed auth cookie can actually be written. Both the
 * request and the response carry the new cookies: the request copy so anything
 * later in this same pass sees the refreshed session, the response copy so the
 * browser keeps it.
 */
export function createMiddlewareSupabase(request: NextRequest) {
  const { url, key } = requireSupabaseConfig()
  let response = NextResponse.next({ request })

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  return { supabase, response: () => response }
}
```

- [ ] **Step 7: Verify nothing broke without credentials**

```bash
test -f .env.local && echo "WARNING: .env.local exists, move it aside for this check" || echo "no .env.local, correct"
pnpm exec tsc --noEmit && pnpm test:run
```

Expected: no type errors, 164 tests pass. This is the constraint that matters most in this task: importing these modules must not throw when the environment is empty.

- [ ] **Step 8: Commit**

```bash
git add src/auth package.json pnpm-lock.yaml .env.example .gitignore
git commit -m "feat: add Supabase client factories that fail on use, not on load"
```

---

### Task 4: Session lookup and the auth helpers

The core of this sub-project. Both entry points share one lookup so the session logic exists once.

**Files:**
- Create: `src/auth/session.ts`, `src/auth/require-brand.ts`
- Create: `tests/require-brand.test.ts`

**Interfaces:**
- Consumes: `createServerSupabase` from Task 3, `getBrand` from `src/core/brand-registry`
- Produces:
  - `type SessionBrand = { tenantId: string; role: 'owner' | 'staff'; brandId: string }`
  - `loadSessionBrand(client): Promise<SessionBrand | null>`
  - `requireBrand(brandId: string): Promise<{ brand: BrandManifest; session: SessionBrand }>`
  - `resolveUserBrand(): Promise<{ brand: BrandManifest; session: SessionBrand }>`
  - `LOGIN_PATH = '/login'`

- [ ] **Step 1: Write the failing tests**

Create `tests/require-brand.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { loadSessionBrand } from '../src/auth/session'

type Row = Record<string, unknown> | null

function client({ user, profile, tenant }: { user: Row; profile: Row; tenant: Row }) {
  const getUser = vi.fn(async () => ({ data: { user }, error: user ? null : new Error('no user') }))
  const getSession = vi.fn(async () => ({ data: { session: null }, error: null }))

  const from = vi.fn((table: string) => {
    const row = table === 'profiles' ? profile : tenant
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: row, error: null }),
    }
    return builder
  })

  return { auth: { getUser, getSession }, from, getUser, getSession }
}

const USER = { id: 'user-1' }
const PROFILE = { tenant_id: 'tenant-1', role: 'owner' }
const TENANT = { brand_id: 'minene' }

describe('loadSessionBrand', () => {
  it('resolves the brand for a signed-in user', async () => {
    const supabase = client({ user: USER, profile: PROFILE, tenant: TENANT })

    await expect(loadSessionBrand(supabase)).resolves.toEqual({
      tenantId: 'tenant-1',
      role: 'owner',
      brandId: 'minene',
    })
  })

  it('verifies the user against the auth server rather than trusting the cookie', async () => {
    const supabase = client({ user: USER, profile: PROFILE, tenant: TENANT })

    await loadSessionBrand(supabase)

    expect(supabase.getUser).toHaveBeenCalled()
    expect(supabase.getSession).not.toHaveBeenCalled()
  })

  it('returns null when there is no user', async () => {
    const supabase = client({ user: null, profile: PROFILE, tenant: TENANT })
    await expect(loadSessionBrand(supabase)).resolves.toBeNull()
  })

  it('returns null when the user has no profile', async () => {
    const supabase = client({ user: USER, profile: null, tenant: TENANT })
    await expect(loadSessionBrand(supabase)).resolves.toBeNull()
  })

  it('returns null when the profile points at a missing tenant', async () => {
    const supabase = client({ user: USER, profile: PROFILE, tenant: null })
    await expect(loadSessionBrand(supabase)).resolves.toBeNull()
  })
})
```

The second test is the one that matters most. `getSession()` only decodes the cookie the browser sent, so an authorization check built on it trusts client-controlled data. Asserting `getUser` was called and `getSession` was not turns that from a convention into something that fails when broken.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/require-brand.test.ts`
Expected: FAIL, cannot resolve `../src/auth/session`.

- [ ] **Step 3: Implement the lookup**

Create `src/auth/session.ts`:

```ts
export type TenantRole = 'owner' | 'staff'

export type SessionBrand = {
  tenantId: string
  role: TenantRole
  brandId: string
}

type MaybeSingle<T> = { maybeSingle: () => Promise<{ data: T | null }> }
type Query<T> = MaybeSingle<T> & { select: (columns: string) => Query<T>; eq: (column: string, value: unknown) => Query<T> }

/**
 * The shape both real and mocked clients satisfy. Narrower than SupabaseClient
 * on purpose: this module needs exactly two reads and one auth call, and
 * depending on more than that would make it untestable without a live project.
 */
export type SessionClient = {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> }
  from: (table: string) => Query<Record<string, unknown>>
}

/**
 * Resolve who the caller is and which brand their tenant owns.
 *
 * Uses getUser(), never getSession(). getSession() decodes the cookie the
 * browser sent and therefore trusts data the client controls; getUser()
 * revalidates against the Supabase auth server. On an authorization check that
 * difference is the entire point.
 *
 * Row-level security scopes both reads to the caller, so `profiles` needs no
 * explicit filter: the caller can only see their own row.
 */
export async function loadSessionBrand(client: SessionClient): Promise<SessionBrand | null> {
  const { data: userData } = await client.auth.getUser()
  const user = userData.user
  if (!user) return null

  const { data: profile } = await client.from('profiles').select('tenant_id, role').maybeSingle()
  if (!profile) return null

  const tenantId = profile.tenant_id
  const role = profile.role
  if (typeof tenantId !== 'string' || (role !== 'owner' && role !== 'staff')) return null

  const { data: tenant } = await client
    .from('tenants').select('brand_id').eq('id', tenantId).maybeSingle()
  if (!tenant) return null

  const brandId = tenant.brand_id
  if (typeof brandId !== 'string') return null

  return { tenantId, role, brandId }
}
```

- [ ] **Step 4: Run to verify the lookup passes**

Run: `pnpm exec vitest run tests/require-brand.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Implement the two entry points**

Create `src/auth/require-brand.ts`:

```ts
import { notFound, redirect } from 'next/navigation'
import { getBrand } from '../core/brand-registry'
import type { BrandManifest } from '../core/brand-types'
import { createServerSupabase } from './supabase-server'
import { loadSessionBrand, type SessionBrand } from './session'

export const LOGIN_PATH = '/login'

export type ResolvedBrand = { brand: BrandManifest; session: SessionBrand }

/**
 * The middleware has already redirected an anonymous caller with a `next`
 * parameter, so reaching this branch means the middleware was bypassed or its
 * matcher missed this route. A bare /login is the right destination: there is no
 * request URL to preserve here, and defence in depth does not need to be pretty.
 */
async function resolveSession(): Promise<{ session: SessionBrand; brand: BrandManifest }> {
  const session = await loadSessionBrand(await createServerSupabase())
  if (!session) redirect(LOGIN_PATH)

  const brand = getBrand(session.brandId)
  if (!brand) {
    // Data and code disagree: a tenant names a brand this deployment does not
    // ship. That is a misconfiguration an operator must see, not a 404, which
    // would tell the user their content does not exist when in fact it is
    // unreachable.
    throw new Error(
      `Tenant ${session.tenantId} names brand "${session.brandId}", which is not in the registry.`,
    )
  }

  return { session, brand }
}

/**
 * Verify the brand named in the URL is the one the caller's tenant owns.
 *
 * A brand belonging to someone else answers 404 rather than 403. A 403 would
 * confirm which brands exist, letting anyone enumerate tenants by probing.
 */
export async function requireBrand(brandId: string): Promise<ResolvedBrand> {
  const { session, brand } = await resolveSession()
  if (brand.id !== brandId) notFound()
  return { brand, session }
}

/** Answer "which brand is mine", for routes with no brand in the URL. */
export async function resolveUserBrand(): Promise<ResolvedBrand> {
  return resolveSession()
}
```

- [ ] **Step 6: Verify the whole suite**

Run: `pnpm exec tsc --noEmit && pnpm test:run`
Expected: no type errors, 169 tests pass (164 + 5).

- [ ] **Step 7: Commit**

```bash
git add src/auth/session.ts src/auth/require-brand.ts tests/require-brand.test.ts
git commit -m "feat: resolve the brand a signed-in caller may see"
```

---

### Task 5: Middleware

**Files:**
- Create: `middleware.ts`

**Interfaces:**
- Consumes: `createMiddlewareSupabase` from Task 3, `LOGIN_PATH` from Task 4
- Produces: nothing later tasks import

- [ ] **Step 1: Write the middleware**

Create `middleware.ts` at the repository root:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { isSupabaseConfigured } from './src/auth/supabase-config'
import { createMiddlewareSupabase } from './src/auth/supabase-middleware'
import { LOGIN_PATH } from './src/auth/require-brand'

export async function middleware(request: NextRequest) {
  // With no project configured there is no session to refresh and no way to
  // sign in, so gating here would lock a developer out of an app that cannot
  // authenticate anyone anyway. requireBrand still refuses to serve content.
  if (!isSupabaseConfigured()) return NextResponse.next()

  const { supabase, response } = createMiddlewareSupabase(request)

  // getUser(), not getSession(): this call is also what refreshes an expiring
  // token, and it validates against the auth server rather than trusting the
  // cookie it was handed.
  const { data } = await supabase.auth.getUser()

  if (!data.user) {
    const loginUrl = new URL(LOGIN_PATH, request.url)
    loginUrl.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search)
    return NextResponse.redirect(loginUrl)
  }

  return response()
}

export const config = {
  /**
   * Skips, in order: the login screen itself (or a signed-out visitor redirects
   * forever), the sign-out route (which must work even with a dead session),
   * Next's build output and favicon, and /brands/* -- the page images stay
   * public until sub-project 2b moves them into storage, and gating them here
   * would break every page in the viewer the moment auth lands.
   */
  matcher: ['/((?!login|logout|_next/static|_next/image|favicon.ico|brands/).*)'],
}
```

- [ ] **Step 2: Verify the matcher by reasoning about each path**

There is no unit test for a Next matcher, so check it by hand. Run `pnpm build`, start the server, and confirm with no session configured that `/login` is reachable and does not redirect to itself.

- [ ] **Step 3: Verify the suite still passes**

Run: `pnpm exec tsc --noEmit && pnpm test:run && pnpm build`
Expected: no type errors, 169 tests, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add middleware.ts
git commit -m "feat: refresh the session and gate signed-out requests"
```

---

### Task 6: Login and logout

**Files:**
- Create: `app/login/page.tsx`, `app/login/login-form.tsx`, `app/logout/route.ts`

**Interfaces:**
- Consumes: `safeNextPath`, `nextWithinBrand` from Task 2; `createBrowserSupabase` from Task 3; `loadSessionBrand`, `createServerSupabase`, `DEFAULT_BRAND_ID` from earlier
- Produces: nothing later tasks import

- [ ] **Step 1: Write the login route**

Create `app/login/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { createServerSupabase } from '../../src/auth/supabase-server'
import { loadSessionBrand } from '../../src/auth/session'
import { isSupabaseConfigured } from '../../src/auth/supabase-config'
import { nextWithinBrand, safeNextPath } from '../../src/auth/safe-next'
import { DEFAULT_BRAND_ID, getBrand } from '../../src/core/brand-registry'
import { brandHref } from '../../src/core/hrefs'
import { LoginForm } from './login-form'

type LoginParams = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export const metadata = { title: 'כניסה' }

export default async function LoginPage({ searchParams }: LoginParams) {
  const query = await searchParams
  const rawNext = typeof query.next === 'string' ? query.next : null

  if (isSupabaseConfigured()) {
    const session = await loadSessionBrand(await createServerSupabase())
    // An authenticated visitor has no business sitting on a sign-in form. The
    // middleware cannot do this: it deliberately does not run on /login.
    if (session) {
      redirect(nextWithinBrand(rawNext, session.brandId) ?? brandHref(session.brandId))
    }
  }

  // The brand comes from the session, and there is none yet, so the screen wears
  // the default brand. With one tenant this is invisible; with several it means
  // everyone signs in wearing Minene's colours. Accepted, not solved.
  const brand = getBrand(DEFAULT_BRAND_ID)

  return (
    <main className="login-screen" dir="rtl" lang="he">
      <div className="login-card">
        {brand ? <img className="login-logo" src={brand.logo.src} alt="" /> : null}
        <h1>כניסה</h1>
        <LoginForm next={safeNextPath(rawNext)} />
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Write the login form**

Create `app/login/login-form.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { createBrowserSupabase } from '../../src/auth/supabase-browser'

export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const { error: signInError } = await createBrowserSupabase()
        .auth.signInWithPassword({ email, password })

      if (signInError) {
        // Deliberately not echoing the provider's message: it distinguishes an
        // unknown address from a wrong password, which tells an attacker which
        // addresses have accounts.
        setError('הפרטים אינם נכונים')
        return
      }

      // The server re-validates `next` against the caller's own brand before
      // honouring it, so a link from another tenant cannot survive this.
      router.replace(next ?? '/')
      router.refresh()
    } catch {
      setError('לא הצלחנו להתחבר. נסי שוב.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label className="login-field">
        <span>אימייל</span>
        <input
          autoComplete="email"
          dir="ltr"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>

      <label className="login-field">
        <span>סיסמה</span>
        <input
          autoComplete="current-password"
          dir="ltr"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>

      {error ? <p className="login-error" role="alert">{error}</p> : null}

      <button disabled={isSubmitting} type="submit">
        {isSubmitting ? 'מתחברת...' : 'כניסה'}
      </button>
    </form>
  )
}
```

Note `dir="ltr"` on both inputs: the surrounding page is RTL, but an email address and a password are LTR strings and render wrongly inside an RTL field.

- [ ] **Step 3: Write the logout route**

Create `app/logout/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { createMiddlewareSupabase } from '../../src/auth/supabase-middleware'
import { isSupabaseConfigured } from '../../src/auth/supabase-config'
import { LOGIN_PATH } from '../../src/auth/require-brand'

/**
 * A route handler rather than a page, because signing out has to clear cookies
 * on the response, which a server component cannot do.
 *
 * There is no link to this anywhere in the shell. A sign-out control in the
 * header would change all four reference screens at all five widths, and those
 * references cannot be regenerated. Sub-project 3 replaces the tool screens and
 * the shell changes for real reasons; the control arrives then.
 */
async function signOut(request: NextRequest) {
  const redirectTo = new URL(LOGIN_PATH, request.url)
  if (!isSupabaseConfigured()) return NextResponse.redirect(redirectTo)

  const { supabase, response } = createMiddlewareSupabase(request)
  await supabase.auth.signOut()

  const cleared = NextResponse.redirect(redirectTo)
  for (const cookie of response().cookies.getAll()) {
    cleared.cookies.set(cookie)
  }
  return cleared
}

export async function GET(request: NextRequest) {
  return signOut(request)
}

export async function POST(request: NextRequest) {
  return signOut(request)
}
```

- [ ] **Step 4: Add the login styles**

Append to `src/styles.css`. These classes are new and used only by the login screen, so nothing the reference screenshots cover is touched:

```css
.login-screen {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--background, #e9e9ee);
}

.login-card {
  width: min(360px, 100%);
  display: grid;
  gap: 20px;
  justify-items: center;
  padding: 32px 24px;
  border-radius: 20px;
  background: #fffdfc;
  box-shadow: 0 18px 40px rgb(29 38 69 / 12%);
  text-align: center;
}

.login-logo { width: 96px; height: auto; }

.login-card h1 { margin: 0; font-size: 1.5rem; color: #1d2645; }

.login-form { display: grid; gap: 16px; width: 100%; }

.login-field { display: grid; gap: 6px; text-align: right; font-size: 0.9rem; color: #1d2645; }

.login-field input {
  padding: 12px 14px;
  border: 1px solid #e7e3e9;
  border-radius: 12px;
  font: inherit;
  min-height: 44px;
}

.login-error { margin: 0; color: #c51f73; font-size: 0.9rem; }

.login-form button {
  min-height: 44px;
  border: 0;
  border-radius: 12px;
  background: #e8368f;
  color: #fff;
  font: inherit;
  cursor: pointer;
}

.login-form button:disabled { opacity: 0.6; cursor: default; }
```

- [ ] **Step 5: Verify**

Run: `pnpm exec tsc --noEmit && pnpm test:run && pnpm build`
Expected: no type errors, 169 tests, build succeeds and lists `/login` and `/logout`.

- [ ] **Step 6: Commit**

```bash
git add app/login app/logout src/styles.css
git commit -m "feat: add the sign-in screen and a sign-out route"
```

---

### Task 7: Wire the helper into every route

The task that actually turns auth on. Until now nothing has been protected.

**Files:**
- Modify: `app/page.tsx`, `app/[brandId]/layout.tsx`, `app/[brandId]/page.tsx`, `app/[brandId]/[subjectId]/page.tsx`, `app/[brandId]/[subjectId]/[groupId]/page.tsx`, `app/[brandId]/tools/[toolId]/page.tsx`

**Interfaces:**
- Consumes: `requireBrand`, `resolveUserBrand` from Task 4
- Produces: nothing later tasks import

- [ ] **Step 1: Redirect the root to the caller's own brand**

Replace `app/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { resolveUserBrand } from '../src/auth/require-brand'
import { brandHref } from '../src/core/hrefs'

export default async function RootPage() {
  const { brand } = await resolveUserBrand()
  redirect(brandHref(brand.id))
}
```

`DEFAULT_BRAND_ID` is no longer used here. It stays exported, because the login screen needs a brand to wear before it knows who is signing in.

- [ ] **Step 2: Protect the brand layout, and stop its metadata leaking**

In `app/[brandId]/layout.tsx`, replace the `getBrand` calls in all three exports.

`generateMetadata` and `generateViewport` currently call `getBrand(brandId)` directly, which would return the real title and theme colour for a brand the caller may not access. That confirms the brand exists, which is exactly the enumeration the 404 rule exists to prevent. Both must resolve through the caller's session instead:

```tsx
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { requireBrand } from '../../src/auth/require-brand'
import { resolveUserBrand } from '../../src/auth/require-brand'
import { BrandShellClient } from './brand-shell-client'

type BrandParams = { params: Promise<{ brandId: string }> }

/**
 * Deliberately absent. Every route beneath this layout reads cookies to verify
 * the session, which makes them dynamic, so generateStaticParams would be
 * ignored -- and prerendering a tenant's pages onto a CDN is not something to
 * do accidentally now that a brand is a data boundary.
 */

async function brandForMetadata(params: BrandParams['params']) {
  const { brandId } = await params
  try {
    const { brand } = await resolveUserBrand()
    return brand.id === brandId ? brand : null
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: BrandParams): Promise<Metadata> {
  const brand = await brandForMetadata(params)
  return { title: brand?.title ?? 'Brand not found' }
}

export async function generateViewport({ params }: BrandParams): Promise<Viewport> {
  const brand = await brandForMetadata(params)
  return {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    themeColor: brand?.theme.background ?? '#e9e9ee',
  }
}

export default async function BrandLayout({ children, params }: BrandParams & { children: ReactNode }) {
  const { brandId } = await params
  const { brand } = await requireBrand(brandId)

  return <BrandShellClient brand={brand}>{children}</BrandShellClient>
}
```

The `try`/`catch` in `brandForMetadata` is deliberate: `resolveUserBrand` redirects by throwing, and a metadata function is not a place to perform navigation. Falling back to the generic title is correct there, because the layout itself will redirect a moment later.

- [ ] **Step 3: Protect the brand home**

In `app/[brandId]/page.tsx`, replace the `getBrand` preamble:

```tsx
import { HomeScreen } from '../../src/components/HomeScreen'
import { requireBrand } from '../../src/auth/require-brand'
import { subjectHref } from '../../src/core/hrefs'

type BrandHomeParams = { params: Promise<{ brandId: string }> }

export default async function BrandHomePage({ params }: BrandHomeParams) {
  const { brandId } = await params
  const { brand } = await requireBrand(brandId)

  return <HomeScreen subjects={brand.subjects} subjectHref={(id) => subjectHref(brand.id, id)} />
}
```

- [ ] **Step 4: Protect the subject route**

In `app/[brandId]/[subjectId]/page.tsx`, replace `const brand = getBrand(brandId); if (!brand) notFound()` with `const { brand } = await requireBrand(brandId)`. Remove the now-unused `getBrand` import; keep `notFound`, which the unknown-subject branch still uses.

Delete its `generateStaticParams` and replace it with the same comment used in the layout, since the route is now dynamic and the function would be ignored.

- [ ] **Step 5: Protect the viewer route**

In `app/[brandId]/[subjectId]/[groupId]/page.tsx`, make the same substitution. This route already had no static generation, so only the brand lookup changes. Leave its existing `generateStaticParams` comment alone: it already explains the route is dynamic, and that is still true, now for two reasons rather than one. Add the second reason to that comment.

- [ ] **Step 6: Protect the tool route**

In `app/[brandId]/tools/[toolId]/page.tsx`, make the same substitution and remove its `generateStaticParams`, replacing it with the shared comment.

- [ ] **Step 7: Verify the routes are all dynamic now**

Run: `pnpm exec tsc --noEmit && pnpm test:run && pnpm build`

Expected: no type errors, 169 tests, and a build whose route table shows `ƒ` for `/`, `/[brandId]`, `/[brandId]/[subjectId]`, `/[brandId]/[subjectId]/[groupId]` and `/[brandId]/tools/[toolId]`. `/login`, `/logout` and `/_not-found` may remain static.

If any brand route still shows `●`, its session check is not running, which means it is not protected. That is a failure, not a cosmetic difference.

- [ ] **Step 8: Verify the gate by hand, with no credentials configured**

```bash
pnpm build && pnpm start --port 4173 &
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4173/login
```

Expected: 200. With no Supabase configured the middleware stands aside, but `requireBrand` still refuses to serve content, so `/minene` should fail rather than render. Confirm it does not render the viewer.

- [ ] **Step 9: Commit**

```bash
git add app
git commit -m "feat: require a verified session and matching tenant on every route"
```

---

### Task 8: Teach the visual suite to sign in, and document the setup

**Files:**
- Create: `tests/visual/global-setup.ts`
- Modify: `playwright.config.ts`, `README.md`, `package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks at runtime
- Produces: `storageState` consumed by every visual test

- [ ] **Step 1: Write the global setup**

Create `tests/visual/global-setup.ts`:

```ts
import { chromium, type FullConfig } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export const STORAGE_STATE = 'tests/visual/.auth/state.json'

/**
 * Signs in once and saves the cookies every visual test reuses. Without this the
 * suite would compare the login screen against four content references and fail
 * twenty times for one reason.
 */
export default async function globalSetup(config: FullConfig) {
  const email = process.env.VIEWER_TEST_EMAIL
  const password = process.env.VIEWER_TEST_PASSWORD
  const baseURL = config.projects[0]?.use.baseURL

  if (!email || !password || !baseURL) {
    throw new Error(
      'The visual suite needs VIEWER_TEST_EMAIL and VIEWER_TEST_PASSWORD to sign in. '
      + 'See the "Visual references" section of README.md.',
    )
  }

  await mkdir(dirname(STORAGE_STATE), { recursive: true })

  const browser = await chromium.launch()
  const page = await browser.newPage({ baseURL })
  await page.goto('/login')
  await page.getByLabel('אימייל').fill(email)
  await page.getByLabel('סיסמה').fill(password)
  await page.getByRole('button', { name: 'כניסה' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
  await page.context().storageState({ path: STORAGE_STATE })
  await browser.close()
}
```

- [ ] **Step 2: Wire it into the Playwright config**

In `playwright.config.ts`, add above `export default`:

```ts
const hasCredentials = Boolean(process.env.VIEWER_TEST_EMAIL && process.env.VIEWER_TEST_PASSWORD)
```

then add to the `defineConfig` object:

```ts
  globalSetup: hasCredentials ? './tests/visual/global-setup.ts' : undefined,
```

and give each project a `storageState`:

```ts
  projects: WIDTHS.map((width) => ({
    name: `w${width}`,
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width, height: 900 },
      ...(hasCredentials ? { storageState: STORAGE_STATE } : {}),
    },
  })),
```

importing `STORAGE_STATE` from `./tests/visual/global-setup`.

**Do not touch the snapshot guard.** It must keep throwing at module-eval time, before any of this runs.

- [ ] **Step 3: Skip cleanly when credentials are absent**

At the top of `tests/visual/viewer.spec.ts`, after the existing imports:

```ts
// Every route needs a session now, so without credentials this suite would fail
// twenty times with an unhelpful screenshot of the login screen. Skipping with a
// reason is the honest outcome: a missing prerequisite is not a regression.
test.skip(
  !process.env.VIEWER_TEST_EMAIL || !process.env.VIEWER_TEST_PASSWORD,
  'Set VIEWER_TEST_EMAIL and VIEWER_TEST_PASSWORD to run the visual comparison.',
)
```

- [ ] **Step 4: Ignore the saved credentials**

Add to `.gitignore`:

```
tests/visual/.auth/
```

A saved `storageState` contains a live session token. It must never be committed.

- [ ] **Step 5: Document it**

In `README.md`, extend the "Visual references" section: the suite now signs in first, `VIEWER_TEST_EMAIL` and `VIEWER_TEST_PASSWORD` must name a real account in the tenant that owns the `minene` brand, and without them the suite skips rather than fails. Also add a short "Authentication" section covering `.env.example`, that accounts are created by an owner in the Supabase dashboard with public signup disabled, and that sign-out is currently the bare `/logout` route with no control in the shell, with the reason.

- [ ] **Step 6: Verify the skip path first**

```bash
unset VIEWER_TEST_EMAIL VIEWER_TEST_PASSWORD
VIEWER_MODE=url pnpm exec playwright test 2>&1 | tail -3
```

Expected: 20 skipped, 0 failed, with the reason shown. Not 20 failures.

- [ ] **Step 7: Verify the real gate with credentials**

With `.env.local` filled in and `VIEWER_TEST_EMAIL` / `VIEWER_TEST_PASSWORD` set to a real account:

```bash
VIEWER_MODE=url pnpm exec playwright test 2>&1 | tail -3
```

Expected: **20 passed**. Every reference must still match exactly. Nothing in this sub-project changes a rendered pixel, so a single failure is a real finding. Report it; never regenerate.

- [ ] **Step 8: Verify `pnpm check` still needs nothing**

```bash
pnpm check
```

Expected: PASS with no Supabase credentials present. This is the constraint that has governed the whole plan.

- [ ] **Step 9: Commit**

```bash
git add tests/visual playwright.config.ts README.md .gitignore
git commit -m "test: sign the visual suite in before it compares"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task: the schema and migration ownership to Task 1; session plumbing to Task 3; middleware to Task 5; route protection and the three distinguished outcomes to Tasks 4 and 7; `/` redirecting to the caller's brand to Task 7; login, logout and return-to validation to Tasks 2 and 6; the testing strategy to Tasks 2, 4 and 8.

**Two things this plan adds that the spec did not name.**

1. **`generateMetadata` and `generateViewport` were an enumeration leak.** They call `getBrand(brandId)` directly, so they would return the real title and theme colour for a brand the caller may not access, confirming its existence next to a 404 that denies it. Task 7 Step 2 routes them through the session. The spec's 404 rule implied this; the plan makes it explicit.

2. **`generateStaticParams` becomes inert on four routes.** Reading cookies makes a route dynamic, so Next ignores it. Leaving the functions in place would tell a reader the routes are prerendered when they are not, and would be actively misleading now that a brand is a data boundary. Tasks 7 removes them with an explanatory comment, following the precedent already set on the viewer route.

**Known sequencing risk.** Task 1 ends without pushing the migration, deliberately, because applying it touches a live database shared with eran-task. Tasks 2 through 8 can all be built and unit-tested against mocks without it, but **Task 7's manual verification and Task 8's real visual run both need the migration applied and an account provisioned.** The controller must obtain approval for that push before Task 7's Step 8, or those verification steps will be blocked while the code itself is fine.

**Weakest point.** `requireBrand` runs in the layout and in each of the four routes beneath it, so a signed-in request performs the profile and tenant lookup twice per page. That is intentional duplication for defence in depth, and Next request-level caching should collapse it in practice, but it is unmeasured. If it proves costly, the fix is React's `cache()` around `resolveSession`, not removing a check.
