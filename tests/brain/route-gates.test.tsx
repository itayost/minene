import { describe, expect, it, vi } from 'vitest'
import { mineneBrand } from '../../src/brands/minene'

const nav = vi.hoisted(() => {
  class NotFoundSignal extends Error {}
  class RedirectSignal extends Error {
    constructor(readonly to: string) {
      super(to)
    }
  }
  return { NotFoundSignal, RedirectSignal }
})

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new nav.NotFoundSignal('not found')
  },
  redirect: (to: string) => {
    throw new nav.RedirectSignal(to)
  },
}))

const role = vi.hoisted(() => ({ current: 'owner' as 'owner' | 'staff' }))

vi.mock('../../src/auth/require-brand', () => ({
  LOGIN_PATH: '/login',
  requireBrand: vi.fn(async () => ({
    brand: mineneBrand,
    session: { tenantId: 'tenant-1', role: role.current, brandId: mineneBrand.id },
  })),
}))

vi.mock('../../app/[brandId]/tools/brain/ingest/ingest-client', () => ({
  IngestClient: () => null,
}))
vi.mock('../../app/[brandId]/tools/brain/book-client', () => ({ BookClient: () => null }))

const { default: IngestPage } = await import('../../app/[brandId]/tools/brain/ingest/page')
const { default: LobbyRedirect } = await import('../../app/[brandId]/tools/brain/lobby/page')
const { default: ExtractRedirect } = await import('../../app/[brandId]/tools/brain/extract/page')
const { default: AdminRedirect } = await import('../../app/[brandId]/tools/brain/admin/page')

const params = () => ({ params: Promise.resolve({ brandId: mineneBrand.id }) })

describe('who reaches the ingest screen', () => {
  it('refuses a staff member with a 404', async () => {
    role.current = 'staff'

    // Every documents policy and every pending-rule read behind it requires the
    // owner role. Without the gate, RLS filters every row and the page states
    // as fact that the queue is empty when it may be full.
    await expect(IngestPage(params())).rejects.toBeInstanceOf(nav.NotFoundSignal)
  })

  it('lets an owner in', async () => {
    role.current = 'owner'
    await expect(IngestPage(params())).resolves.toBeDefined()
  })
})

describe('the routes that were live before the restructure', () => {
  it('sends the old lobby to the screen that now holds the queue', async () => {
    await expect(LobbyRedirect(params())).rejects.toMatchObject({
      to: `/${mineneBrand.id}/tools/brain/ingest`,
    })
  })

  it('sends the old extract screen to the same place', async () => {
    await expect(ExtractRedirect(params())).rejects.toMatchObject({
      to: `/${mineneBrand.id}/tools/brain/ingest`,
    })
  })

  it('sends the old history to the book, whose list it was', async () => {
    await expect(AdminRedirect(params())).rejects.toMatchObject({
      to: `/${mineneBrand.id}/tools/brain`,
    })
  })
})
