import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrainCard } from '../../src/brain/BrainCard'

describe('the one card', () => {
  it('renders as a list item when it is one of many', () => {
    render(
      <ul>
        <BrainCard as="li">לחייך</BrainCard>
      </ul>,
    )

    expect(screen.getByRole('listitem')).toHaveTextContent('לחייך')
  })

  it('renders as a plain box when it stands alone', () => {
    render(<BrainCard>לחייך</BrainCard>)

    expect(screen.queryByRole('listitem')).toBeNull()
    expect(screen.getByText('לחייך')).toBeVisible()
  })

  it('omits the head and meta rows entirely when it has none', () => {
    const { container } = render(<BrainCard>לחייך</BrainCard>)

    // An empty head still occupies its gap in the grid, which reads as a card
    // that failed to load its own metadata.
    expect(container.querySelector('.brain-card__head')).toBeNull()
    expect(container.querySelector('.brain-card__meta')).toBeNull()
  })

  it('keeps the head, the body, the meta and the actions in reading order', () => {
    const { container } = render(
      <BrainCard
        actions={<button type="button">אישור</button>}
        head={<span>#12</span>}
        meta={<span>טיפ</span>}
      >
        לחייך
      </BrainCard>,
    )

    const classes = [...(container.firstElementChild?.children ?? [])].map(
      (child) => child.className,
    )
    expect(classes).toEqual([
      'brain-card__head',
      'brain-card__body',
      'brain-card__meta',
      'brain-card__actions',
    ])
  })
})
