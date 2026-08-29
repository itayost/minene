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

const { default: CockpitPage } = await import('../app/[brandId]/page')
const { VideoWizard } = await import('../app/[brandId]/cockpit/video/video-wizard')

/**
 * The catalog as approved: two columns, four rows, every card carrying a line
 * that says what it does. Order is DOM order, which in RTL fills right-to-left.
 */
const CATALOG = [
  ['חיים אישיים', 'האיזון, האנרגיה והזמן שלך'],
  ['תוכנית ופרויקט', 'לבנות תוכנית ופרויקט לחנות'],
  ['לנתח נתונים', 'מה המספרים אומרים על החנות'],
  ['הדרכה: סרטון, תמונה', 'סרטון או תמונה להדרכת הצוות'],
  ['עידוד ושכנוע', 'חיזוק, הכרה ומסר שמזיז לפעולה'],
  ['תרגילי הדרכה', 'תרגול קצר שמטמיע בפועל'],
  ['מנטורינג לעובדות', 'שיחה אישית עם כל עובדת'],
  ['ספר ארגוני ומוח', 'הידע הארגוני והמוח של החנות'],
] as const

describe('the cockpit', () => {
  it('leads with the catalog rather than a recommendation', async () => {
    render(await CockpitPage({ params: Promise.resolve({ brandId: mineneBrand.id }) }))

    expect(screen.getByRole('heading', { name: 'קוקפיט מנהלת' })).toBeVisible()
    expect(screen.getByText('כל מה שמנהלת צריכה, במקום אחד')).toBeVisible()

    // The recommendation was the previous composition's whole thesis. Asserted
    // absent rather than simply not asserted, so bringing it back is a decision
    // somebody makes on purpose.
    expect(screen.queryByText('יש לך שיחה חשובה בקרוב')).toBeNull()
    expect(screen.queryByText('המלצת המנטור')).toBeNull()
  })

  it('shows all eight cards, each saying what it does', async () => {
    render(await CockpitPage({ params: Promise.resolve({ brandId: mineneBrand.id }) }))

    for (const [title, subtitle] of CATALOG) {
      expect(screen.getByText(title)).toBeVisible()
      // The subtitle is the half that makes a card choosable: eight titles alone
      // are eight guesses.
      expect(screen.getByText(subtitle)).toBeVisible()
    }
  })

  it('gives every card an icon of its own from the home set', async () => {
    const { container } = render(
      await CockpitPage({ params: Promise.resolve({ brandId: mineneBrand.id }) }),
    )

    const icons = [...container.querySelectorAll('.cockpit-tool img')].map((img) =>
      decodeURIComponent(img.getAttribute('src') ?? ''),
    )

    expect(icons).toHaveLength(CATALOG.length)
    for (const icon of icons) {
      expect(icon).toContain('/brands/minene/icons/home-tools/')
    }
    // Distinct, so no two cards are confusable at a glance.
    expect(
      new Set(icons.map((i) => i.replace(/.*home-tools\//, '').split(/[?&]/)[0])),
    ).toHaveLength(8)
  })

  it('carries every destination the bottom nav used to', async () => {
    render(await CockpitPage({ params: Promise.resolve({ brandId: mineneBrand.id }) }))

    // The nav is gone, so these three cards are the only way to reach the three
    // tools. If one of them stops being a link, a whole tool becomes
    // unreachable and nothing else on the screen would say so.
    const destinations = Object.fromEntries(
      screen.getAllByRole('link').map((a) => [a.getAttribute('href'), true]),
    )
    for (const path of ['tools/campaign', 'tools/persuade', 'tools/brain']) {
      expect(destinations[`/${mineneBrand.id}/${path}`], path).toBe(true)
    }
  })

  it('names which card leads where', async () => {
    render(await CockpitPage({ params: Promise.resolve({ brandId: mineneBrand.id }) }))

    expect(screen.getByRole('link', { name: /הדרכה: סרטון, תמונה/ })).toHaveAttribute(
      'href',
      `/${mineneBrand.id}/tools/campaign`,
    )
    expect(screen.getByRole('link', { name: /עידוד ושכנוע/ })).toHaveAttribute(
      'href',
      `/${mineneBrand.id}/tools/persuade`,
    )
    expect(screen.getByRole('link', { name: /ספר ארגוני ומוח/ })).toHaveAttribute(
      'href',
      `/${mineneBrand.id}/tools/brain`,
    )

    // The rest are buttons that say they are not connected, rather than links
    // to pages that do not exist.
    expect(screen.getAllByRole('link')).toHaveLength(3)
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

  it('admits a tool is not connected instead of ignoring a press', async () => {
    const user = userEvent.setup()
    render(await CockpitPage({ params: Promise.resolve({ brandId: mineneBrand.id }) }))

    // A card that silently ignores a press reads as broken, and the whole grid
    // did exactly that: every card was an <article>.
    expect(screen.queryByText(/לא מחובר/)).toBeNull()
    await user.click(screen.getByRole('button', { name: /לנתח נתונים/ }))
    expect(screen.getByText(/הכלי הזה עדיין לא מחובר/)).toBeVisible()
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

  it('offers a way back whose icon carries its own dimensions', () => {
    // The shell renders home chrome on this path, so this link is the only exit.
    // The icon is asserted to be intrinsically sized because it once shipped
    // relying solely on a stylesheet rule, and when that rule went missing the
    // chevron expanded to fill the screen and buried the wizard.
    render(<VideoWizard backHref="/minene" />)

    const back = screen.getByRole('link', { name: 'חזרה' })
    expect(back).toHaveAttribute('href', '/minene')

    const icon = back.querySelector('svg')
    expect(icon).toHaveAttribute('width', '11')
    expect(icon).toHaveAttribute('height', '18')
  })

  it('reveals one decision at a time and keeps completed answers editable', async () => {
    const user = userEvent.setup()
    render(<VideoWizard backHref="/minene" />)

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
    render(<VideoWizard backHref="/minene" />)

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
    render(<VideoWizard backHref="/minene" />)

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
    render(<VideoWizard backHref="/minene" />)

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
