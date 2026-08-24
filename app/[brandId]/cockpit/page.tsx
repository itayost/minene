import Link from 'next/link'
import type { CSSProperties } from 'react'
import { requireBrand } from '../../../src/auth/require-brand'
import { COCKPIT_ACTIONS } from '../../../src/cockpit/actions'
import { MentorBar } from './mentor-bar'

type CockpitParams = { params: Promise<{ brandId: string }> }

export const metadata = { title: 'Brain Co-Manager' }

type CardStyle = CSSProperties & { '--card-color': string; '--card-accent': string }

export default async function CockpitPage({ params }: CockpitParams) {
  const { brandId } = await params
  const { brand } = await requireBrand(brandId)

  return (
    <div className="cockpit" dir="rtl">
      <header className="cockpit__intro">
        <h2 className="cockpit__title">הקוקפיט שלך כמנהלת חנות</h2>
        <p className="cockpit__tagline">כל מה שאת צריכה – במקום אחד</p>
      </header>

      <ul className="cockpit__grid" role="list">
        {COCKPIT_ACTIONS.map((action) => {
          const style = { '--card-color': action.cardColor, '--card-accent': action.accent } as CardStyle
          const body = (
            <>
              {/* Headline and icon only, matching the home grid's density. The
                  description is the action's own copy and belongs on its screen,
                  not crowded onto a card the reader is scanning. */}
              <span className="cockpit-card__text">
                <span className="cockpit-card__title">{action.title}</span>
                <span className="cockpit-card__subtitle">{action.subtitle}</span>
              </span>
              <img alt="" className="cockpit-card__icon" src={action.icon} />
            </>
          )

          return (
            <li key={action.number}>
              {action.slug ? (
                <Link
                  className="cockpit-card"
                  href={`/${brand.id}/cockpit/${action.slug}`}
                  style={style}
                >
                  {body}
                </Link>
              ) : (
                // Rendered as plain content, not a link. A card that looks
                // tappable and then goes nowhere reads as a broken app, so an
                // unbuilt flow says so instead of pretending.
                <div className="cockpit-card cockpit-card--soon" style={style}>
                  {body}
                  <span className="cockpit-card__soon">בקרוב</span>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <MentorBar />
    </div>
  )
}
