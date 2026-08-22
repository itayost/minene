import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SubjectMenu } from '../src/components/SubjectMenu'
import '../src/styles.css'
import { demoBrand } from './fixtures/demo-brand'

const subject = demoBrand.subjects.find((candidate) => candidate.id === 'multiple')!

function renderSubjectMenu(direction: 'ltr' | 'rtl') {
  return render(
    <div dir={direction}>
      <SubjectMenu subject={subject} onGroup={vi.fn()} />
    </div>,
  )
}

describe('SubjectMenu', () => {
  it('uses logical icon-label-chevron order and mirrors the chevron in RTL', () => {
    renderSubjectMenu('rtl')

    const card = screen.getByRole('button', { name: 'Group one' })
    const children = Array.from(card.children)

    expect(children[0]).toHaveClass('group-card__icon-wrap')
    expect(children[1]).toHaveClass('group-card__label')
    expect(children[2]).toHaveClass('group-card__arrow')
    expect(children[2]?.querySelector('svg')).not.toBeNull()
    expect(getComputedStyle(children[1]!)).toHaveProperty('text-align', 'start')
    expect(getComputedStyle(children[2]!)).toHaveProperty('transform', 'scaleX(-1)')
  })

  it('clips heading and row artwork into deliberate circular badges', () => {
    const { container } = renderSubjectMenu('rtl')

    const headingIcon = container.querySelector<HTMLElement>('.subject-menu__mark')!
    const rowIconWrap = container.querySelector<HTMLElement>('.group-card__icon-wrap')!
    const rowIcon = container.querySelector<HTMLElement>('.group-card__icon')!
    const headingStyle = getComputedStyle(headingIcon)
    const rowWrapStyle = getComputedStyle(rowIconWrap)
    const rowIconStyle = getComputedStyle(rowIcon)

    expect(headingStyle.width).toBe(headingStyle.height)
    expect(headingStyle.borderRadius).toBe('50%')
    expect(headingStyle.objectFit).toBe('cover')
    expect(rowWrapStyle.overflow).toBe('hidden')
    expect(rowIconStyle.width).toBe('100%')
    expect(rowIconStyle.height).toBe('100%')
    expect(rowIconStyle.borderRadius).toBe('50%')
    expect(rowIconStyle.objectFit).toBe('cover')
  })
})
