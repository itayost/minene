import Link from 'next/link'
import type { CSSProperties } from 'react'
import { requireBrand } from '../../src/auth/require-brand'
import { COCKPIT_ACTIONS } from '../../src/cockpit/actions'
import { MentorBar } from './cockpit/mentor-bar'

type BrandHomeParams = { params: Promise<{ brandId: string }> }

type CardStyle = CSSProperties & { '--card-color': string; '--card-accent': string }

export default async function BrandHomePage({ params }: BrandHomeParams) {
  const { brandId } = await params
  const { brand } = await requireBrand(brandId)

  return (
    <div className="cockpit" dir="rtl">
      {/* Hidden, not removed. Without it the screen has no heading at all, so
          the document outline and every screen reader see an unnamed grid of
          eight links. ToolScreen does the same thing for the same reason. */}
      <h2 className="visually-hidden">הקוקפיט שלך כמנהלת חנות</h2>

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
                // Not a link. Without a flow behind it there is nowhere to go,
                // and linking to a route that 404s is worse than not linking at
                // all. It stays visually dimmed so an unbuilt card is not
                // indistinguishable from a working one.
                <div className="cockpit-card cockpit-card--soon" style={style}>
                  {body}
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
