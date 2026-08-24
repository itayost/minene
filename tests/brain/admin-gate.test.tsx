import { describe, expect, it, vi } from 'vitest'
import { mineneBrand } from '../../src/brands/minene'

const nav = vi.hoisted(() => {
  class NotFoundSignal extends Error {}
  return { NotFoundSignal }
})

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new nav.NotFoundSignal('not found')
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

// The client half reaches for a browser Supabase client at render time, which
// this test never gets to: the gate throws first, which is the point.
vi.mock('../../app/[brandId]/tools/brain/admin/admin-client', () => ({
  AdminClient: () => null,
}))

const { default: AdminPage } = await import('../../app/[brandId]/tools/brain/admin/page')

describe('the rules history gate', () => {
  it('refuses a staff member with a 404, never a 403', async () => {
    role.current = 'staff'

    // A 403 would confirm the page exists to someone who may not have it. The
    // entry point is hidden from staff too, so this is the boundary rather than
    // the only line of defence.
    await expect(AdminPage({ params: Promise.resolve({ brandId: mineneBrand.id }) }))
      .rejects.toBeInstanceOf(nav.NotFoundSignal)
  })

  it('lets an owner through', async () => {
    role.current = 'owner'

    await expect(AdminPage({ params: Promise.resolve({ brandId: mineneBrand.id }) }))
      .resolves.toBeDefined()
  })
})
