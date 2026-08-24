import { render, screen } from '@testing-library/react'
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

const { default: BrainPage } = await import('../../app/[brandId]/tools/brain/page')

async function renderBrain(as: 'owner' | 'staff') {
  role.current = as
  render(await BrainPage({ params: Promise.resolve({ brandId: mineneBrand.id }) }))
}

describe('the מוח ארגוני screen', () => {
  it('offers an owner all three entry points', async () => {
    await renderBrain('owner')

    expect(screen.getByRole('link', { name: /לובי אושר/ })).toBeVisible()
    expect(screen.getByRole('link', { name: /חילוץ חוקים/ })).toBeVisible()
    expect(screen.getByRole('link', { name: /דשבורד/ })).toBeVisible()
  })

  it('points each entry at its route beneath the tool', async () => {
    await renderBrain('owner')

    const base = `/${mineneBrand.id}/tools/brain`
    expect(screen.getByRole('link', { name: /לובי אושר/ })).toHaveAttribute('href', `${base}/lobby`)
    expect(screen.getByRole('link', { name: /חילוץ חוקים/ })).toHaveAttribute('href', `${base}/extract`)
    expect(screen.getByRole('link', { name: /דשבורד/ })).toHaveAttribute('href', `${base}/admin`)
  })

  it('hides the dashboard from a staff member rather than letting them hit a 404', async () => {
    await renderBrain('staff')

    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(screen.queryByRole('link', { name: /דשבורד/ })).toBeNull()
  })

  it('keeps the existing preview list beneath the entries', async () => {
    await renderBrain('owner')

    // The list is the tool's manifest items, unchanged. Its note marks it as a
    // preview, which is why the entry points sit above it.
    expect(screen.getByText('גיוס ידע בקרב 1500 סניפים')).toBeVisible()
    expect(screen.getByText('מקרים ותגובות')).toBeVisible()
  })
})
