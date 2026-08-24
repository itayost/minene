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

vi.mock('../../app/[brandId]/tools/brain/lobby/lobby-client', () => ({ LobbyClient: () => null }))
vi.mock('../../app/[brandId]/tools/brain/extract/extract-client', () => ({ ExtractClient: () => null }))

const { default: LobbyPage } = await import('../../app/[brandId]/tools/brain/lobby/page')
const { default: ExtractPage } = await import('../../app/[brandId]/tools/brain/extract/page')

const params = { params: Promise.resolve({ brandId: mineneBrand.id }) }

describe('the lobby and extract gates', () => {
  it('refuses a staff member from the lobby with a 404', async () => {
    role.current = 'staff'

    // Without this gate RLS filters every row on select and the page states as
    // fact that the queue is empty when it may be full. A confident false
    // statement is worse than an absence.
    await expect(LobbyPage(params)).rejects.toBeInstanceOf(nav.NotFoundSignal)
  })

  it('refuses a staff member from extraction with a 404', async () => {
    role.current = 'staff'

    // Otherwise they reach the form and get an upload failure with no
    // explanation: an endlessly retryable dead end.
    await expect(ExtractPage(params)).rejects.toBeInstanceOf(nav.NotFoundSignal)
  })

  it('lets an owner into both', async () => {
    role.current = 'owner'

    await expect(LobbyPage(params)).resolves.toBeDefined()
    await expect(ExtractPage({ params: Promise.resolve({ brandId: mineneBrand.id }) })).resolves.toBeDefined()
  })
})
