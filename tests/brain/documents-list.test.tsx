import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DocumentsList } from '../../src/brain/DocumentsList'
import type { BrainDocument, DocumentSourceType } from '../../src/brain/types'

const doc = (overrides: Partial<BrainDocument> = {}): BrainDocument => ({
  id: 'doc-1',
  topic_id: 'store',
  filename: 'נהלי פתיחה.pdf',
  status: 'ready',
  error: null,
  created_at: '2026-08-26T10:00:00Z',
  source_type: 'pdf',
  ...overrides,
})

const listing = (rows: BrainDocument[]) => ({
  listRecentDocuments: async () => ({ rows, hasMore: false }),
} as never)

const render_ = (rows: BrainDocument[]) =>
  render(<DocumentsList documentsApi={listing(rows)} onError={vi.fn()} reloadToken={0} />)

describe('a list that now holds two kinds of thing', () => {
  it('says which rows are uploads and which are pasted threads', async () => {
    render_([
      doc({ id: 'a', filename: 'נהלי פתיחה', source_type: 'pdf' }),
      doc({ id: 'b', filename: 'החזרות', source_type: 'conversation' }),
    ])

    // Before conversations existed every row was a PDF and the column would have
    // been noise. Now a titled paste and an uploaded file are indistinguishable
    // by name alone.
    const rows = await screen.findAllByRole('listitem')
    expect(within(rows[0] as HTMLElement).getByText('קובץ')).toBeVisible()
    expect(within(rows[1] as HTMLElement).getByText('שיחה')).toBeVisible()
  })

  it('names an unfamiliar source rather than rendering a blank cell', async () => {
    render_([doc({ source_type: 'audio' as DocumentSourceType })])

    // The same fallback the topic and status cells already use: a row with an
    // unknown value is still a real row, and a blank reads as a bug.
    expect(await screen.findByText('audio')).toBeVisible()
  })
})
