import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mineneBrand } from '../../src/brands/minene'

const nav = vi.hoisted(() => {
  class NotFoundSignal extends Error {}
  return { NotFoundSignal }
})

vi.mock('next/navigation', () => ({
  notFound: () => { throw new nav.NotFoundSignal('not found') },
}))

const role = vi.hoisted(() => ({ current: 'owner' as 'owner' | 'staff' }))

vi.mock('../../src/auth/require-brand', () => ({
  LOGIN_PATH: '/login',
  requireBrand: vi.fn(async () => ({
    brand: mineneBrand,
    session: { tenantId: 'tenant-1', role: role.current, brandId: mineneBrand.id },
  })),
}))

// Stubbed so this file is about the route, not the list it renders. The stub
// reports the role it was handed, which is the one thing the page decides.
vi.mock('../../app/[brandId]/tools/brain/book-client', () => ({
  BookClient: ({ role: given }: { role: string }) => <div data-testid="book" data-role={given} />,
}))

const { default: BrainPage } = await import('../../app/[brandId]/tools/brain/page')

async function renderBrain(as: 'owner' | 'staff') {
  role.current = as
  render(await BrainPage({ params: Promise.resolve({ brandId: mineneBrand.id }) }))
}

describe('the מוח ארגוני front door', () => {
  it('is the knowledge book itself, not a menu in front of it', async () => {
    await renderBrain('staff')

    // The bottom nav already reaches this tool. Four cards in front of four
    // screens cost two taps before any task began, and the largest element on
    // that page was a list of marketing copy from the brand manifest.
    expect(screen.getByTestId('book')).toBeVisible()
  })

  it('lets every member in, because the approved rules are theirs to read', async () => {
    await renderBrain('staff')

    // rules_select_member_approved admits the whole tenant. Gating this would
    // put the knowledge behind the role that least needs to read it.
    expect(screen.getByTestId('book')).toHaveAttribute('data-role', 'staff')
  })

  it('tells the book which role it is rendering for', async () => {
    await renderBrain('owner')

    // The owner's extra controls are options on this one list, not a second
    // copy of it, so the page hands the role down rather than branching here.
    expect(screen.getByTestId('book')).toHaveAttribute('data-role', 'owner')
  })
})
