import type { ReactElement, ReactNode } from 'react'

/**
 * Every row on every brain surface. A rule in the book, a rule in the queue, a
 * rule in the history and a document in the list are the same object with
 * different content, and before this they were four card treatments introduced
 * in a single week.
 *
 * Each slot is omitted rather than rendered empty: an empty head still occupies
 * its gap in the grid, which reads as a card that failed to load.
 */
export function BrainCard({ head, children, meta, actions, as = 'div' }: {
  head?: ReactNode
  children: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  as?: 'li' | 'div'
}): ReactElement {
  const Tag = as
  return (
    <Tag className="brain-card">
      {head ? <p className="brain-card__head">{head}</p> : null}
      <div className="brain-card__body">{children}</div>
      {meta ? <p className="brain-card__meta">{meta}</p> : null}
      {actions ? <div className="brain-card__actions">{actions}</div> : null}
    </Tag>
  )
}
