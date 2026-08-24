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

    // Distinct, so no two actions are confusable at a glance, and cockpit-owned
    // so the action set cannot silently drift back to generic home/tool artwork.
    expect(new Set(icons)).toHaveLength(8)
    for (const icon of icons) {
      expect(icon).toMatch(/^\/brands\/minene\/icons\/cockpit\/[a-z-]+\.png$/)
    }
  })

  it('links only the flow that exists, and marks the rest unavailable', async () => {
    render(await CockpitPage({ params: Promise.resolve({ brandId: mineneBrand.id }) }))

    // A card that looks tappable and then 404s reads as a broken app.
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', `/${mineneBrand.id}/cockpit/video`)
    // The other seven render, but as plain content: linking to a route that
    // 404s is worse than not linking at all.
    expect(screen.queryAllByText('בקרוב')).toHaveLength(0)
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
  const pick = async (user: ReturnType<typeof userEvent.setup>, label: string | RegExp) =>
    user.click(screen.getByRole('button', { name: label }))

  it('reveals one decision at a time and keeps completed answers editable', async () => {
    const user = userEvent.setup()
    render(<VideoWizard />)

    expect(screen.getByText('שלב 1 מתוך 4')).toBeVisible()
    expect(screen.getByRole('button', { name: /שלב 1.*בחרי נושא/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.queryByRole('button', { name: 'שיציעו מוצר נוסף' })).toBeNull()

    await pick(user, 'מכירות')

    expect(screen.getByText('שלב 2 מתוך 4')).toBeVisible()
    expect(screen.getByRole('button', { name: /שלב 1.*נושא: מכירות.*עריכה/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.getByRole('button', { name: /שלב 2.*מה תרצי שיקרה/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByRole('button', { name: 'שיציעו מוצר נוסף' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: /שלב 1.*נושא: מכירות.*עריכה/ }))

    expect(screen.getByText('שלב 1 מתוך 4')).toBeVisible()
    expect(screen.getByRole('button', { name: 'מכירות' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('refuses to submit until all four choices are made', async () => {
    const user = userEvent.setup()
    render(<VideoWizard />)

    const submit = screen.getByRole('button', { name: /השלימי את הבחירות.*נשארו 4 בחירות/ })
    expect(submit).toBeDisabled()

    await pick(user, 'מכירות')
    await pick(user, 'שיציעו מוצר נוסף')
    await pick(user, 'אנרגטי')
    expect(submit).toBeDisabled()
    expect(submit).toHaveAccessibleName(/נשארו 1 בחירות/)

    await pick(user, '20 שניות')
    expect(submit).toBeEnabled()
    expect(submit).toHaveAccessibleName('צרי סרטון')
    expect(screen.getByLabelText('סיכום הבחירות')).toHaveTextContent(
      'מכירות · שיציעו מוצר נוסף · אנרגטי · 20 שניות',
    )
  })

  it('records style and length independently', async () => {
    const user = userEvent.setup()
    render(<VideoWizard />)

    await pick(user, 'מכירות')
    await pick(user, 'שיציעו מוצר נוסף')
    await pick(user, 'מקצועי')
    await pick(user, '30 שניות')

    await user.click(screen.getByRole('button', { name: /שלב 3.*סגנון: מקצועי.*עריכה/ }))
    expect(screen.getByRole('button', { name: 'מקצועי' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'אנרגטי' })).toHaveAttribute('aria-pressed', 'false')

    await user.click(screen.getByRole('button', { name: /שלב 4.*אורך: 30 שניות.*עריכה/ }))
    expect(screen.getByRole('button', { name: '30 שניות' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('reports the choices back and does not claim a video exists', async () => {
    const user = userEvent.setup()
    render(<VideoWizard />)

    await pick(user, 'שירות')
    await pick(user, 'שיחייכו יותר')
    await pick(user, 'מעודד')
    await pick(user, '10 שניות')
    await pick(user, /צרי סרטון/)

    expect(screen.getByRole('status')).toHaveTextContent('שירות · שיחייכו יותר · מעודד · 10 שניות')
    // Implying a render is coming would be a promise this screen cannot keep.
    expect(screen.getByText(/יצירת הסרטון עצמו עדיין לא זמינה/)).toBeVisible()
  })
})
