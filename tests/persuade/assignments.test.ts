import { describe, expect, test } from 'vitest'
import type { ConversationState } from '../../src/persuade/engine/types'
import { recordAsked, recordExecution } from '../../src/persuade/lib/assignments'
import { createFakeSupabase } from './fake-supabase'

const ASSIGNMENT = '11111111-0000-4000-8000-00000000000a'

const state = (overrides: Partial<ConversationState> = {}): ConversationState => ({
  interaction: 4,
  rung: 3,
  blockers: [],
  signals: { motivatedBy: [], energy: 'unknown', autonomyNeed: 'unknown', respondsToNumbers: null },
  fatigue: 0.2,
  outcome: 'agreed',
  askStated: true,
  identityStated: true,
  startTimeSet: true,
  followUpAnnounced: true,
  ...overrides,
})

const seedOpen = (db: { assignments: Record<string, unknown>[] }) => {
  db.assignments.push({ id: ASSIGNMENT, status: 'open', settled_at: null })
}

describe('recordAsked: agreement is not execution', () => {
  test('an agreed conversation leaves the assignment open', async () => {
    // This is the whole point of the module. A conversation ending in
    // "סגור, אני עושה את זה" has produced a commitment and nothing else.
    const { client, db } = createFakeSupabase()
    seedOpen(db)

    await recordAsked(client, ASSIGNMENT, state({ outcome: 'agreed' }))

    expect(db.assignments[0]?.status).toBe('open')
  })

  test('records the ask as coming from the bot, never as a person report', async () => {
    // settle_assignment on the other side cannot produce source='bot', and this
    // cannot produce 'self' -- so neither can be mistaken for the other.
    const { client, db } = createFakeSupabase()

    await recordAsked(client, ASSIGNMENT, state())

    expect(db.assignment_events[0]).toMatchObject({
      assignment_id: ASSIGNMENT,
      kind: 'asked',
      source: 'bot',
    })
  })

  test('the note carries the outcome, so the trail reads without joining back', async () => {
    const { client, db } = createFakeSupabase()

    await recordAsked(client, ASSIGNMENT, state({ outcome: 'refused', interaction: 2, rung: 1 }))

    expect(db.assignment_events[0]?.note).toContain('refused')
    expect(db.assignment_events[0]?.note).toContain('2 אינטראקציות')
  })

  test('a refused conversation also leaves the assignment open', async () => {
    // Refusing in conversation is not the same as the work not happening, and
    // the assignment is about the work.
    const { client, db } = createFakeSupabase()
    seedOpen(db)

    await recordAsked(client, ASSIGNMENT, state({ outcome: 'refused' }))

    expect(db.assignments[0]?.status).toBe('open')
  })

  test('a failed write raises rather than resolving quietly', async () => {
    const { client, db } = createFakeSupabase()
    db.failNext = 'connection refused'

    await expect(recordAsked(client, ASSIGNMENT, state())).rejects.toThrow(
      /רישום השיחה במשימה נכשל/,
    )
  })
})

describe('recordExecution: the only path that may settle', () => {
  test('a yes settles the assignment as done', async () => {
    const { client, db } = createFakeSupabase()
    seedOpen(db)

    await recordExecution(client, ASSIGNMENT, {
      executed: 'yes',
      timesDone: 5,
      whatHappened: 'עשיתי כל בוקר',
    })

    expect(db.assignments[0]?.status).toBe('done')
    expect(db.assignment_events[0]).toMatchObject({ kind: 'reported_done', source: 'bot' })
  })

  test('a partial settles as not_done, with the nuance in the note', async () => {
    // The ask was a daily briefing. Recording "twice out of five" as done would
    // let the measurement drift upward one generous rounding at a time.
    const { client, db } = createFakeSupabase()
    seedOpen(db)

    await recordExecution(client, ASSIGNMENT, {
      executed: 'partial',
      timesDone: 2,
      whatHappened: 'יצא לי פעמיים',
    })

    expect(db.assignments[0]?.status).toBe('not_done')
    expect(db.assignment_events[0]?.note).toContain('2 פעמים')
  })

  test('a no settles as not_done', async () => {
    const { client, db } = createFakeSupabase()
    seedOpen(db)

    await recordExecution(client, ASSIGNMENT, {
      executed: 'no',
      timesDone: null,
      whatHappened: 'לא יצא לי',
    })

    expect(db.assignments[0]?.status).toBe('not_done')
    expect(db.assignment_events[0]?.note).toBe('לא יצא לי')
  })

  test('does not overwrite an assignment somebody already settled', async () => {
    // A race with a person's own self-report resolves in the person's favour:
    // a second answer is a second assignment, not an edit of the first.
    const { client, db } = createFakeSupabase()
    db.assignments.push({ id: ASSIGNMENT, status: 'done', settled_at: 'earlier' })

    await recordExecution(client, ASSIGNMENT, {
      executed: 'no',
      timesDone: 0,
      whatHappened: 'לא יצא לי',
    })

    expect(db.assignments[0]?.status).toBe('done')
    expect(db.assignments[0]?.settled_at).toBe('earlier')
  })

  test('still records the event even when the status guard refuses the update', async () => {
    // The report is a fact about what the person said, and it stays in the
    // trail whether or not it moved the status.
    const { client, db } = createFakeSupabase()
    db.assignments.push({ id: ASSIGNMENT, status: 'done', settled_at: 'earlier' })

    await recordExecution(client, ASSIGNMENT, {
      executed: 'no',
      timesDone: 0,
      whatHappened: 'לא יצא לי',
    })

    expect(db.assignment_events).toHaveLength(1)
  })
})
