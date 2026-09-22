import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Counters } from '../../src/persuade/Counters'
import { startOfUtcDay } from '../../src/persuade/use-live-counts'

describe('the day boundary', () => {
  it('is UTC midnight, matching what the cap counts', () => {
    // worker.ts's attemptsToday does setUTCHours(0,0,0,0) on simulation_jobs.
    // A screen counting a local day would report a number the cap does not use.
    expect(startOfUtcDay(new Date('2026-09-22T03:00:00Z'))).toBe('2026-09-22T00:00:00.000Z')
  })
})

describe('the counters', () => {
  const counts = { total: 168, today: 0, attemptsToday: 12 }

  it('shows the cumulative total', () => {
    render(
      <Counters
        counts={counts}
        dailyCap={1000}
        lastOk={new Date()}
        onRefresh={() => {}}
        stale={false}
      />,
    )

    expect(screen.getByText('168')).toBeInTheDocument()
  })

  it('shows attempts against the cap as capacity, not as achievement', () => {
    render(
      <Counters
        counts={counts}
        dailyCap={1000}
        lastOk={new Date()}
        onRefresh={() => {}}
        stale={false}
      />,
    )

    expect(screen.getByText(/12 מתוך 1,000/)).toBeInTheDocument()
  })

  it('reports runs added and attempts made as separate numbers', () => {
    // 249 of 413 jobs have failed. Showing runs-added against a cap that bounds
    // attempts would understate the spend every time one does.
    render(
      <Counters
        counts={counts}
        dailyCap={1000}
        lastOk={new Date()}
        onRefresh={() => {}}
        stale={false}
      />,
    )

    expect(screen.getByText(/נוספו היום/)).toBeInTheDocument()
    expect(screen.getByText(/ניסיונות היום/)).toBeInTheDocument()
  })

  it('says so when the feed has gone stale rather than showing the numbers as current', () => {
    render(
      <Counters
        counts={counts}
        dailyCap={1000}
        lastOk={new Date('2026-09-22T09:00:00Z')}
        onRefresh={() => {}}
        stale
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(/לא מתעדכן/)
    expect(screen.getByRole('button', { name: /רענון/ })).toBeInTheDocument()
  })

  it('renders without numbers before the first read lands', () => {
    render(
      <Counters counts={null} dailyCap={1000} lastOk={null} onRefresh={() => {}} stale={false} />,
    )

    expect(screen.getByText(/טוען/)).toBeInTheDocument()
  })
})
