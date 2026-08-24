import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { mineneBrand } from '../src/brands/minene'
import { COCKPIT_ACTIONS } from '../src/cockpit/actions'

vi.mock('../src/auth/require-brand', () => ({
  LOGIN_PATH: '/login',
  requireBrand: vi.fn(async () => ({
    brand: mineneBrand,
    session: { tenantId: 'tenant-1', role: 'owner' as const, brandId: mineneBrand.id },
  })),
}))

const { default: CockpitPage } = await import('../app/[brandId]/cockpit/page')
const { VideoWizard } = await import('../app/[brandId]/cockpit/video/video-wizard')

describe('the cockpit', () => {
  it('offers all eight actions', async () => {
    render(await CockpitPage({ params: Promise.resolve({ brandId: mineneBrand.id }) }))

    expect(COCKPIT_ACTIONS).toHaveLength(8)
    for (const action of COCKPIT_ACTIONS) {
      expect(screen.getByText(action.subtitle)).toBeVisible()
    }
  })

  it('gives every action its own icon', () => {
    const icons = COCKPIT_ACTIONS.map((action) => action.icon)

    // Distinct, so no two actions are confusable at a glance. They are drawn
    // from the brand's existing icon set rather than a dedicated cockpit folder:
    // there is no cockpit artwork, and inventing a path for files that do not
    // exist would ship eight broken images.
    expect(new Set(icons)).toHaveLength(8)
    for (const icon of icons) {
      expect(icon).toMatch(/^\/brands\/minene\/icons\/[a-z-]+\.png$/)
    }
  })

  it('links only the flow that exists, and marks the rest unavailable', async () => {
    render(await CockpitPage({ params: Promise.resolve({ brandId: mineneBrand.id }) }))

    // A card that looks tappable and then 404s reads as a broken app.
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', `/${mineneBrand.id}/cockpit/video`)
    expect(screen.getAllByText('בקרוב')).toHaveLength(7)
  })

  it('closes with the mentor composer rather than a prompt with nowhere to answer', async () => {
    render(await CockpitPage({ params: Promise.resolve({ brandId: mineneBrand.id }) }))

    // No visible heading by design, so the region's accessible name is what
    // identifies the composer.
    expect(screen.queryByRole('heading', { name: 'דברו עם המנטור' })).toBeNull()
    expect(screen.getByRole('region', { name: 'דברו עם המנטור' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'הודעה למנטור' })).toBeVisible()
    for (const control of ['הוספת קובץ', 'הקלטה קולית', 'שיחת לייב עם אווטאר']) {
      expect(screen.getByRole('button', { name: control })).toBeVisible()
    }
  })

  it('admits the mentor is not connected instead of ignoring a press', async () => {
    const user = userEvent.setup()
    render(await CockpitPage({ params: Promise.resolve({ brandId: mineneBrand.id }) }))

    await user.click(screen.getByRole('button', { name: 'הקלטה קולית' }))

    // A control that silently ignores you reads as broken; one that pretends to
    // work is worse.
    expect(screen.getByRole('status')).toHaveTextContent(/המנטור עדיין לא מחובר/)
  })
})

describe('the video wizard', () => {
  const pick = async (user: ReturnType<typeof userEvent.setup>, label: string) =>
    user.click(screen.getByRole('button', { name: label }))

  it('refuses to submit until all four choices are made', async () => {
    const user = userEvent.setup()
    render(<VideoWizard />)

    const submit = screen.getByRole('button', { name: /צורו סרטון/ })
    expect(submit).toBeDisabled()

    await pick(user, 'מכירות')
    await pick(user, 'שיציעו מוצר נוסף')
    await pick(user, 'אנרגטי')
    expect(submit).toBeDisabled()

    // Step 3 carries two choices, so style alone does not complete it.
    await pick(user, '20 שניות')
    expect(submit).toBeEnabled()
  })

  it('records style and length independently', async () => {
    const user = userEvent.setup()
    render(<VideoWizard />)

    await pick(user, 'מקצועי')
    await pick(user, '30 שניות')

    expect(screen.getByRole('button', { name: 'מקצועי' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '30 שניות' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'אנרגטי' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('reports the choices back and does not claim a video exists', async () => {
    const user = userEvent.setup()
    render(<VideoWizard />)

    await pick(user, 'שירות')
    await pick(user, 'שיחייכו יותר')
    await pick(user, 'מעודד')
    await pick(user, '10 שניות')
    await pick(user, /צורו סרטון/ as unknown as string)

    expect(screen.getByRole('status')).toHaveTextContent('שירות · שיחייכו יותר · מעודד · 10 שניות')
    // Implying a render is coming would be a promise this screen cannot keep.
    expect(screen.getByText(/יצירת הסרטון עצמו עדיין לא זמינה/)).toBeVisible()
  })
})
