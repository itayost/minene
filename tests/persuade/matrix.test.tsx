import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Matrix, type MatrixCell } from '../../src/persuade/Matrix'

const cell = (over: Partial<MatrixCell> = {}): MatrixCell => ({
  industry: 'אופנה',
  industryLabel: 'אופנה',
  roleSlug: 'r1',
  roleLabel: 'מנהלת חנות',
  runs: 42,
  persuasionRate: 81,
  ...over,
})

describe('the matrix', () => {
  it('is a real grid, so it can be read a row at a time', () => {
    render(<Matrix cells={[cell()]} onSelect={vi.fn()} selected={null} />)

    expect(screen.getByRole('grid', { name: /שיעור שכנוע/ })).toBeVisible()
  })

  it('renders a cell with no runs as unmeasured, never as zero', () => {
    render(
      <Matrix
        cells={[cell({ runs: 0, persuasionRate: null })]}
        onSelect={vi.fn()}
        selected={null}
      />,
    )

    // "Nobody has run this cell" and "everybody refused here" are opposite
    // facts. 0% claims the second when the first is true, and the heat ramp
    // would paint it as the palest measured value rather than as no value.
    const found = screen.getByRole('gridcell')
    expect(found).toHaveAttribute('data-heat', 'none')
    expect(found).not.toHaveTextContent('0%')
    expect(within(found).getByText(/אין ריצות/)).toBeVisible()
  })

  it('carries the denominator with the rate', () => {
    render(
      <Matrix
        cells={[cell({ persuasionRate: 81, runs: 42 })]}
        onSelect={vi.fn()}
        selected={null}
      />,
    )

    // 81% off four runs and 81% off forty support different decisions.
    expect(screen.getByText('42 ריצות')).toBeVisible()
  })

  it('steps the heat by magnitude, so a stronger cell is never lighter', () => {
    render(
      <Matrix
        cells={[
          cell({ roleSlug: 'a', persuasionRate: 24 }),
          cell({ roleSlug: 'b', persuasionRate: 81 }),
        ]}
        onSelect={vi.fn()}
        selected={null}
      />,
    )

    const cells = screen.getAllByRole('gridcell')
    const heat = cells.map((c) => Number(c.getAttribute('data-heat')))
    expect(heat[0]).toBeLessThan(heat[1] as number)
  })

  it('names each cell for what it is, not just its number', () => {
    render(<Matrix cells={[cell()]} onSelect={vi.fn()} selected={null} />)

    // The row and column headers are off-screen for a screen reader moving cell
    // to cell, so the cell has to say where it is.
    expect(screen.getByRole('gridcell', { name: /אופנה.*מנהלת חנות.*81/ })).toBeVisible()
  })

  it('reports which cell was chosen', async () => {
    const onSelect = vi.fn()
    const { default: userEvent } = await import('@testing-library/user-event')
    render(<Matrix cells={[cell()]} onSelect={onSelect} selected={null} />)

    await userEvent.setup().click(screen.getByRole('gridcell'))

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ industry: 'אופנה', roleSlug: 'r1' }),
    )
  })

  it('marks a role that does not exist in an industry as absent, not as unrun', () => {
    // Two industries, one role each, no role shared between them -- the
    // cross-product the table builds has a second cell with nowhere to look
    // it up, which is the case this token exists for.
    render(
      <Matrix
        cells={[
          cell({ industry: 'a', industryLabel: 'א', roleSlug: 'x', roleLabel: 'X' }),
          cell({ industry: 'b', industryLabel: 'ב', roleSlug: 'y', roleLabel: 'Y' }),
        ]}
        onSelect={vi.fn()}
        selected={null}
      />,
    )

    const cells = screen.getAllByRole('gridcell')
    const absent = cells.find((c) => c.getAttribute('data-heat') === 'absent')
    expect(absent).toBeDefined()
    // Distinct from a real, unrun cell: "אין ריצות" would claim a run could
    // have happened here and simply has not.
    expect(absent).not.toHaveAttribute('data-heat', 'none')
    expect(absent?.getAttribute('aria-label')).not.toMatch(/אין ריצות/)
  })

  it('does not let an absent cell be selected', async () => {
    const onSelect = vi.fn()
    const { default: userEvent } = await import('@testing-library/user-event')
    render(
      <Matrix
        cells={[
          cell({ industry: 'a', industryLabel: 'א', roleSlug: 'x', roleLabel: 'X' }),
          cell({ industry: 'b', industryLabel: 'ב', roleSlug: 'y', roleLabel: 'Y' }),
        ]}
        onSelect={onSelect}
        selected={null}
      />,
    )

    const absent = screen
      .getAllByRole('gridcell')
      .find((c) => c.getAttribute('data-heat') === 'absent')
    await userEvent.setup().click(absent as HTMLElement)

    expect(onSelect).not.toHaveBeenCalled()
  })
})
