import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

// One stable object, matching real useRouter. A fresh object per render would
// change handleError's identity, which changes loadRules, which refires its
// effect forever.
const router = { replace: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/minene/tools/brain/admin',
}))

vi.mock('../../src/auth/supabase-browser', () => ({ createBrowserSupabase: () => ({}) }))

const api = {
  listRules: async () => ({ rows: [], nextCursor: null }),
  loadKpis: async () => ({ knowledgeItems: 0, qualityItems: 0, growthPercent: null }),
  setStar: async () => ({}),
}
vi.mock('../../src/brain/rules-api', () => ({
  createRulesApi: () => api,
  __unused: () => ({
  }),
}))

const { AdminClient } = await import('../../app/[brandId]/tools/brain/admin/admin-client')

describe('the history search control', () => {
  it('is a collapsed toggle in the header, not a field on the page', async () => {
    render(<AdminClient />)

    const toggle = screen.getByRole('button', { name: 'חיפוש וסינון' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // The panel exists so aria-controls points somewhere real, but is hidden,
    // which also keeps it out of the accessibility tree.
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('opens the field when pressed and moves focus into it', async () => {
    const user = userEvent.setup()
    render(<AdminClient />)

    await user.click(screen.getByRole('button', { name: 'חיפוש וסינון' }))

    const field = screen.getByRole('searchbox')
    expect(field).toBeVisible()
    // Opening a search control that does not take focus makes the reader hunt
    // for the field they just asked for.
    expect(field).toHaveFocus()
    expect(screen.getByRole('button', { name: 'חיפוש וסינון' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('closes again when pressed a second time', async () => {
    const user = userEvent.setup()
    render(<AdminClient />)

    const toggle = screen.getByRole('button', { name: 'חיפוש וסינון' })
    await user.click(toggle)
    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('searchbox')).toBeNull()
  })
})
