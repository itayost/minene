import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ReactNode } from 'react'
import { mineneBrand } from '../src/brands/minene'
import type { BrandManifest } from '../src/core/brand-types'
import { demoBrand } from './fixtures/demo-brand'

// The route bodies answer "no such resource" and "go elsewhere" by throwing
// through next/navigation, which only exists inside a Next render. Standing both
// calls in as identifiable throws preserves the routes' real control flow --
// nothing after notFound() or redirect() runs -- while letting a test name which
// one fired and, for a redirect, where it pointed. The two hooks are stood in
// for the same reason: the shell a rendered route sits inside reads the path.
const nav = vi.hoisted(() => {
  class NotFoundSignal extends Error {}

  class RedirectSignal extends Error {
    constructor(readonly href: string) {
      super(`redirect to ${href}`)
    }
  }

  return { NotFoundSignal, RedirectSignal, pathname: '/', replace: vi.fn(), push: vi.fn() }
})

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new nav.NotFoundSignal('not found')
  },
  redirect: (href: string) => {
    throw new nav.RedirectSignal(href)
  },
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
}))

// Only real brands are registered, and the branching below reads more clearly
// against the demo fixture: one subject holding a single group, one holding
// three. Serving it beside the real registry leaves brandManifestEntries alone,
// so every prerendered-path count below still counts the real manifest.
vi.mock('../src/core/brand-registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/brand-registry')>()
  const { demoBrand: fixture } = await import('./fixtures/demo-brand')
  return {
    ...actual,
    getBrand: (id: string) => (id === fixture.id ? fixture : actual.getBrand(id)),
  }
})

// The route bodies now resolve the brand through the session rather than the
// registry. Auth is stood in here because these tests exist to pin routing
// behaviour -- which redirect fires, what is not found, what renders -- and the
// session logic has its own tests in require-brand.test.ts. The stub mirrors
// requireBrand's real contract: a brand the caller may not have throws the same
// not-found signal, never a 403.
vi.mock('../src/auth/require-brand', async () => {
  const actual = await vi.importActual<typeof import('../src/core/brand-registry')>(
    '../src/core/brand-registry',
  )
  const { demoBrand: fixture } = await import('./fixtures/demo-brand')
  const baseSession = { tenantId: 'tenant-1', role: 'owner' as const }
  const find = (id: string) => (id === fixture.id ? fixture : actual.getBrand(id))

  return {
    LOGIN_PATH: '/login',
    requireBrand: vi.fn(async (brandId: string) => {
      const brand = find(brandId)
      if (!brand) throw new nav.NotFoundSignal('not found')
      return { brand, session: { ...baseSession, brandId: brand.id } }
    }),
    resolveUserBrand: vi.fn(async () => {
      const brand = actual.getBrand('minene')
      if (!brand) throw new Error('minene must be registered for this fixture')
      return { brand, session: { ...baseSession, brandId: brand.id } }
    }),
  }
})

const { BrandShellClient } = await import('../app/[brandId]/brand-shell-client')
const { default: RootPage } = await import('../app/page')
const { default: BrandHomePage } = await import('../app/[brandId]/page')
const subjectRoute = await import('../app/[brandId]/[subjectId]/page')
const viewerRoute = await import('../app/[brandId]/[subjectId]/[groupId]/page')
const toolRoute = await import('../app/[brandId]/tools/[toolId]/page')

/** Runs a route body and hands back what it threw, failing if it returned. */
async function capture(run: () => unknown): Promise<unknown> {
  try {
    await run()
  } catch (thrown) {
    return thrown
  }
  throw new Error('The route returned instead of signalling through next/navigation')
}

async function expectNotFound(run: () => unknown): Promise<void> {
  expect(await capture(run)).toBeInstanceOf(nav.NotFoundSignal)
}

async function redirectTarget(run: () => unknown): Promise<string> {
  const thrown = await capture(run)
  if (!(thrown instanceof nav.RedirectSignal)) {
    throw new Error(`Expected a redirect; the route threw ${String(thrown)}`)
  }
  return thrown.href
}

const noQuery = Promise.resolve({})

/**
 * A viewer route returns a client tree that reads the path and the shell it sits
 * inside, which is how the shell header comes to report the page. Mounting it
 * the way the layout does is what makes the header readable from a test.
 */
function renderUnderShell(brand: BrandManifest, pathname: string, screenTree: ReactNode) {
  nav.pathname = pathname
  return render(<BrandShellClient brand={brand}>{screenTree}</BrandShellClient>)
}

function headerSubtitle(): string {
  return document.querySelector('.app-header__subtitle')?.textContent ?? ''
}

beforeEach(() => {
  nav.pathname = '/'
  nav.replace.mockReset()
  nav.push.mockReset()
})

describe('route bodies', () => {
  test('the site root sends the reader to their own brand', async () => {
    expect(await redirectTarget(() => RootPage())).toBe('/minene')
  })

  test('a brand home screen lists the brand subjects', async () => {
    render(await BrandHomePage({ params: Promise.resolve({ brandId: demoBrand.id }) }))

    expect(screen.getByRole('link', { name: /Single subject/ })).toHaveAttribute('href', '/demo/single')
    expect(screen.getByRole('link', { name: /Multiple subject/ })).toHaveAttribute('href', '/demo/multiple')
  })

  test('an unknown brand is not found', async () => {
    await expectNotFound(() => BrandHomePage({ params: Promise.resolve({ brandId: 'not-configured' }) }))
  })

  // A subject with exactly one group never showed a chooser before routing, so
  // its address stands for that group. This is the branch most of the real
  // manifest takes: five of its eight subjects hold a single group.
  test('a subject holding one group redirects to that group', async () => {
    const target = await redirectTarget(() => subjectRoute.default({
      params: Promise.resolve({ brandId: demoBrand.id, subjectId: 'single' }),
    }))

    expect(target).toBe('/demo/single/only-group')
  })

  test('the same redirect fires for a single-group subject of the real brand', async () => {
    const target = await redirectTarget(() => subjectRoute.default({
      params: Promise.resolve({ brandId: mineneBrand.id, subjectId: 'tasks' }),
    }))

    expect(target).toBe('/minene/tasks/daily-tasks')
  })

  test('a subject holding several groups renders the chooser instead', async () => {
    render(await subjectRoute.default({
      params: Promise.resolve({ brandId: demoBrand.id, subjectId: 'multiple' }),
    }))

    expect(screen.getByRole('heading', { name: 'Multiple subject' })).toBeVisible()
    expect(screen.getByRole('link', { name: /Group one/ })).toHaveAttribute('href', '/demo/multiple/group-one')
    expect(screen.getByRole('link', { name: /Group two/ })).toHaveAttribute('href', '/demo/multiple/group-two')
    expect(screen.getByRole('link', { name: /Group three/ })).toHaveAttribute('href', '/demo/multiple/group-three')
  })

  test('an unknown subject is not found', async () => {
    await expectNotFound(() => subjectRoute.default({
      params: Promise.resolve({ brandId: demoBrand.id, subjectId: 'no-such-subject' }),
    }))
  })

  test('a group viewer renders the requested group', async () => {
    const tree = await viewerRoute.default({
      params: Promise.resolve({ brandId: demoBrand.id, subjectId: 'multiple', groupId: 'group-two' }),
      searchParams: noQuery,
    })
    renderUnderShell(demoBrand, '/demo/multiple/group-two', tree)

    expect(screen.getByRole('img', { name: 'Group two page' })).toBeVisible()
  })

  // The page parameter is one-based in the URL and the viewer is zero-based, so
  // the route is the only place that conversion happens.
  test('a group viewer opens the page named by the query', async () => {
    const tree = await viewerRoute.default({
      params: Promise.resolve({
        brandId: mineneBrand.id,
        subjectId: 'results',
        groupId: 'conversion-basket-traffic',
      }),
      searchParams: Promise.resolve({ page: '3' }),
    })
    renderUnderShell(mineneBrand, '/minene/results/conversion-basket-traffic', tree)

    expect(headerSubtitle()).toContain('3 / 3')
  })

  test('an unknown group is not found', async () => {
    await expectNotFound(() => viewerRoute.default({
      params: Promise.resolve({ brandId: demoBrand.id, subjectId: 'multiple', groupId: 'no-such-group' }),
      searchParams: noQuery,
    }))
  })

  test('a tool screen renders the tool contents', async () => {
    render(await toolRoute.default({
      params: Promise.resolve({ brandId: demoBrand.id, toolId: 'notes' }),
    }))

    expect(screen.getByText('Ideas to discuss')).toBeVisible()
    expect(screen.getByText('First idea')).toBeVisible()
  })

  test('an unknown tool is not found', async () => {
    await expectNotFound(() => toolRoute.default({
      params: Promise.resolve({ brandId: demoBrand.id, toolId: 'no-such-tool' }),
    }))
  })

  // A subject is not reachable through the tools segment, and a tool is not
  // reachable as a subject, however similar the two addresses look.
  test('a subject identifier is not a tool identifier', async () => {
    await expectNotFound(() => toolRoute.default({
      params: Promise.resolve({ brandId: demoBrand.id, toolId: 'multiple' }),
    }))
  })
})

// These counts used to be asserted through each route's generateStaticParams.
// Those functions are gone: every brand route reads cookies to verify the
// session, which makes it dynamic, so Next would ignore them and their presence
// would tell a reader the routes are prerendered when they are not.
//
// The manifest shape they pinned is still worth guarding, so it is asserted
// directly. The numbers stay literal rather than derived, so a subject, group or
// tool appearing or vanishing has to be a deliberate edit to this file.
describe('manifest shape', () => {
  test('the registered brand has eight subjects', () => {
    expect(mineneBrand.subjects).toHaveLength(8)
    expect(mineneBrand.subjects.map((subject) => subject.id)).toContain('tasks')
  })

  test('the registered brand has eighteen groups', () => {
    const groups = mineneBrand.subjects.flatMap((subject) => subject.groups)

    expect(groups).toHaveLength(18)
    expect(groups.map((group) => group.id)).toContain('daily-tasks')
  })

  test('the registered brand has three tools', () => {
    expect(mineneBrand.tools).toHaveLength(3)
    expect(mineneBrand.tools.map((tool) => tool.id)).toContain('brain')
  })
})

// No brand route exports generateStaticParams any more, and that is load-bearing
// rather than incidental: one reappearing would mean Next tried to prerender a
// tenant's pages onto a CDN.
describe('no brand route is prerendered', () => {
  test('none of the dynamic routes offers static params', () => {
    expect(subjectRoute).not.toHaveProperty('generateStaticParams')
    expect(viewerRoute).not.toHaveProperty('generateStaticParams')
    expect(toolRoute).not.toHaveProperty('generateStaticParams')
  })
})

// Guards the protection itself. Without this a future edit could delete a
// requireBrand call and every other test here would still pass, because they
// assert routing behaviour and the stub would happily never be consulted.
describe('every brand route is protected', () => {
  test('each route resolves its brand through the auth helper', async () => {
    const auth = await import('../src/auth/require-brand')
    const requireBrandMock = vi.mocked(auth.requireBrand)

    const calls: Array<[string, () => Promise<unknown>]> = [
      ['home', () => BrandHomePage({ params: Promise.resolve({ brandId: demoBrand.id }) })],
      ['subject', () => subjectRoute.default({
        params: Promise.resolve({ brandId: demoBrand.id, subjectId: 'multiple' }),
      })],
      ['viewer', () => viewerRoute.default({
        params: Promise.resolve({ brandId: demoBrand.id, subjectId: 'multiple', groupId: 'group-one' }),
        searchParams: Promise.resolve({}),
      })],
      ['tool', () => toolRoute.default({
        params: Promise.resolve({ brandId: demoBrand.id, toolId: demoBrand.tools[0]!.id }),
      })],
    ]

    for (const [name, run] of calls) {
      requireBrandMock.mockClear()
      await run().catch(() => undefined)
      expect(requireBrandMock, `${name} route must call requireBrand`).toHaveBeenCalledWith(demoBrand.id)
    }
  })
})
