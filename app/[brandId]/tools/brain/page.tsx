import Link from 'next/link'
import type { CSSProperties } from 'react'
import { notFound } from 'next/navigation'
import { requireBrand } from '../../../../src/auth/require-brand'
import { ToolScreen } from '../../../../src/components/ToolScreen'

type BrainParams = { params: Promise<{ brandId: string }> }

const BRAIN_TOOL_ID = 'brain'

/**
 * A static segment, so Next resolves it before the sibling [toolId] route -- the
 * same rule that makes `tools` beat `[subjectId]`. משכנע and קמפיינר keep being
 * served by [toolId] entirely unchanged, ToolScreen is not modified, and there
 * is no conditional on a tool id anywhere.
 *
 * Unlike its sibling routes this uses notFound() rather than assertDefined:
 * those call resolveScreen first, which has already proved the tool exists, so a
 * miss there would be a bug. Nothing has validated it here, so a brand whose
 * manifest has no brain tool is a legitimate 404.
 */
export default async function BrainPage({ params }: BrainParams) {
  const { brandId } = await params
  const { brand, session } = await requireBrand(brandId)

  const tool = brand.tools.find((candidate) => candidate.id === BRAIN_TOOL_ID)
  if (!tool) notFound()

  const base = `/${brand.id}/tools/${BRAIN_TOOL_ID}`

  // The book leads, and it is the only one every member reaches:
  // rules_select_member_approved admits the whole tenant to the approved rules.
  //
  // The other three are owner-only, matching the routes they point at, which in
  // turn match what the database allows: every policy behind them requires the
  // owner role. Showing a staff member a link to a page that will 404 for them
  // reads as a broken app rather than as a permission boundary.
  const book = {
    href: `${base}/book`,
    label: 'ספר החוקים',
    note: 'הידע המאושר, ודירוג שלו',
    icon: '/brands/minene/icons/brain.png',
    cardColor: '#f4f7fb',
  }

  const entries = session.role === 'owner'
    ? [
        book,
        {
          href: `${base}/lobby`,
          label: 'לובי אושר',
          note: 'חוקים הממתינים לאישור',
          icon: '/brands/minene/icons/tasks.png',
          cardColor: '#fef2f6',
        },
        {
          href: `${base}/extract`,
          label: 'חילוץ חוקים',
          note: 'העלאת PDF וחילוץ חוקים',
          icon: '/brands/minene/icons/training.png',
          cardColor: '#f8f6fc',
        },
        {
          href: `${base}/admin`,
          label: 'נתוני המוח',
          note: 'היסטוריית החוקים',
          icon: '/brands/minene/icons/results.png',
          cardColor: '#f9f9fc',
        },
      ]
    : [book]

  return (
    <div className="brain-screen">
      <nav className="brain-entries" aria-label="כלי מוח ארגוני">
        {entries.map((entry) => (
          <Link
            className="brain-entry"
            href={entry.href}
            key={entry.href}
            style={{ '--card-color': entry.cardColor } as CSSProperties & { '--card-color': string }}
          >
            <span className="brain-entry__text">
              <span className="brain-entry__label">{entry.label}</span>
              <span className="brain-entry__note">{entry.note}</span>
            </span>
            <img className="brain-entry__icon" src={entry.icon} alt="" />
          </Link>
        ))}
      </nav>

      <ToolScreen tool={tool} />
    </div>
  )
}
